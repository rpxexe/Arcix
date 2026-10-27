// src/services/webrtc-manager.ts
import { QualityPreset, RemoteInputEvent, SessionPermissions } from '../types';
import { SignalingClient } from './signaling-client';

const CHUNK_SIZE = 64 * 1024; // binary file chunks; well under Chromium's 256 KB message limit
const BUFFER_HIGH_WATER = 4 * 1024 * 1024;
const MAX_FILE_BYTES = 100 * 1024 * 1024;

export interface WebRTCStats {
  rttMs: number;
  fps: number;
  bitrateKbps: number;
}

export type WebRTCEvents = {
  onRemoteStream?: (stream: MediaStream) => void;
  onStatsUpdate?: (stats: WebRTCStats) => void;
  onDataChannelReady?: () => void;
  onFileTransferProgress?: (fileName: string, progressPercent: number) => void;
  onFileTransferComplete?: (fileName: string, blob: Blob) => void;
  onClipboardReceived?: (text: string) => void;
  onConnectionStateChange?: (state: RTCPeerConnectionState) => void;
};

export class WebRTCManager {
  private pc: RTCPeerConnection | null = null;
  private inputChannel: RTCDataChannel | null = null;
  private controlChannel: RTCDataChannel | null = null;
  private localStream: MediaStream | null = null;
  private remoteStream: MediaStream | null = null;

  private signaling: SignalingClient;
  private peerId: string = '';
  private role: 'viewer' | 'host' = 'viewer';
  private permissions: SessionPermissions = { view: true, input: false, clipboard: false, fileTransfer: false };
  private events: WebRTCEvents = {};

  private statsTimer: any = null;
  private lastBytes: number = 0;
  private lastStatsTimestamp: number = 0;

  // File reception state
  private incomingFile: {
    fileName: string;
    fileSize: number;
    receivedBytes: number;
    parts: ArrayBuffer[];
  } | null = null;

  // ICE candidates arriving before remote description is set
  private pendingCandidates: RTCIceCandidateInit[] = [];
  private hostReady: Promise<void> | null = null;
  private quality: QualityPreset = 'balanced';

  constructor(signaling: SignalingClient) {
    this.signaling = signaling;
  }

  public getRemoteStream(): MediaStream | null {
    return this.remoteStream;
  }

  public setEvents(events: WebRTCEvents) {
    this.events = { ...this.events, ...events };
  }

  public setPermissions(perms: SessionPermissions) {
    this.permissions = perms;
  }

  public async startAsHost(viewerId: string, permissions: SessionPermissions, sourceId?: string): Promise<void> {
    this.role = 'host';
    this.peerId = viewerId;
    this.permissions = permissions;

    this.createPeerConnection();

    // Host listens for data channels created by viewer
    this.pc!.ondatachannel = (event) => {
      this.setupDataChannel(event.channel);
    };

    // Setup screen capture stream; the viewer's offer waits on this so the answer includes the video track
    this.hostReady = (async () => {
      this.localStream = await this.acquireScreenStream(sourceId);
      console.log('[WebRTC Host] Acquired screen stream, track count:', this.localStream.getTracks().length);
      this.localStream.getTracks().forEach((track) => {
        this.pc?.addTrack(track, this.localStream!);
      });
    })();

    try {
      await this.hostReady;
    } catch (err) {
      console.error('[WebRTC Host] Failed to capture screen:', err);
      throw err;
    }

    this.startStatsMonitoring();
  }

  public async startAsViewer(hostId: string, permissions: SessionPermissions, quality: QualityPreset = 'balanced'): Promise<void> {
    this.role = 'viewer';
    this.quality = quality;
    this.peerId = hostId;
    this.permissions = permissions;

    this.createPeerConnection();

    // Input must be reliable and ordered: a dropped mouse_up/key_up leaves buttons or keys stuck on the host
    this.inputChannel = this.pc!.createDataChannel('input', {
      ordered: true
    });
    this.setupDataChannel(this.inputChannel);

    // Reliable ordered control channel
    this.controlChannel = this.pc!.createDataChannel('control', {
      ordered: true
    });
    this.setupDataChannel(this.controlChannel);

    // Remote track listener
    this.remoteStream = new MediaStream();
    this.pc!.ontrack = (event) => {
      console.log('[WebRTC Viewer] Received remote video track:', event.track.kind);
      // Remote control: show frames as soon as they decode instead of buffering for smoothness
      event.receiver.jitterBufferTarget = 0;
      if (event.streams && event.streams[0]) {
        this.remoteStream = event.streams[0];
      } else {
        if (!this.remoteStream) {
          this.remoteStream = new MediaStream();
        }
        this.remoteStream.addTrack(event.track);
      }
      this.events.onRemoteStream?.(this.remoteStream);
    };

    // Viewer initiates the WebRTC offer
    const offer = await this.pc!.createOffer({
      offerToReceiveVideo: true,
      offerToReceiveAudio: false
    });
    await this.pc!.setLocalDescription(offer);
    this.signaling.sendWebRTCOffer(this.peerId, offer);

    this.startStatsMonitoring();
  }

  private createPeerConnection() {
    const config: RTCConfiguration = {
      iceServers: [
        { urls: 'stun:stun.l.google.com:19302' },
        { urls: 'stun:stun1.l.google.com:19302' }
      ]
    };

    this.pc = new RTCPeerConnection(config);

    this.pc.onicecandidate = (event) => {
      if (event.candidate) {
        this.signaling.sendIceCandidate(this.peerId, event.candidate.toJSON());
      }
    };

    this.pc.onconnectionstatechange = () => {
      const state = this.pc?.connectionState || 'closed';
      console.log(`[WebRTC] PeerConnection State changed: ${state}`);
      this.events.onConnectionStateChange?.(state);
    };
  }

  public async handleRemoteOffer(offer: RTCSessionDescriptionInit): Promise<void> {
    if (!this.pc) return;
    await this.hostReady;
    if (!this.pc) return; // closed while capturing
    await this.pc.setRemoteDescription(new RTCSessionDescription(offer));
    await this.drainPendingCandidates();
    const answer = await this.pc.createAnswer();
    await this.pc.setLocalDescription(answer);
    this.signaling.sendWebRTCAnswer(this.peerId, answer);
  }

  public async handleRemoteAnswer(answer: RTCSessionDescriptionInit): Promise<void> {
    if (!this.pc) return;
    await this.pc.setRemoteDescription(new RTCSessionDescription(answer));
    await this.drainPendingCandidates();
  }

  public async handleRemoteIceCandidate(candidate: RTCIceCandidateInit): Promise<void> {
    if (!this.pc) return;
    if (!this.pc.remoteDescription || !this.pc.remoteDescription.type) {
      console.log('[WebRTC] Queuing ICE candidate until remote description is set');
      this.pendingCandidates.push(candidate);
      return;
    }

    try {
      await this.pc.addIceCandidate(new RTCIceCandidate(candidate));
    } catch (err) {
      console.warn('[WebRTC] Failed to add ICE candidate', err);
    }
  }

  private async drainPendingCandidates(): Promise<void> {
    if (!this.pc) return;
    while (this.pendingCandidates.length > 0) {
      const candidate = this.pendingCandidates.shift();
      if (candidate) {
        try {
          await this.pc.addIceCandidate(new RTCIceCandidate(candidate));
        } catch (err) {
          console.warn('[WebRTC] Failed to add drained candidate', err);
        }
      }
    }
  }

  private setupDataChannel(channel: RTCDataChannel) {
    if (channel.label === 'input') {
      this.inputChannel = channel;
    } else if (channel.label === 'control') {
      this.controlChannel = channel;
    }

    channel.onopen = () => {
      // Viewer picks quality, host owns the encoder: tell it once the control channel is up
      if (channel.label === 'control' && this.role === 'viewer') {
        channel.send(JSON.stringify({ type: 'quality_preset', preset: this.quality }));
      }
      console.log(`[DataChannel] Channel '${channel.label}' opened`);
      this.events.onDataChannelReady?.();
    };

    channel.binaryType = 'arraybuffer';
    channel.onmessage = (event) => {
      this.handleChannelMessage(channel.label, event.data);
    };

    channel.onerror = (err) => {
      console.error(`[DataChannel Error] ${channel.label}:`, err);
    };
  }

  private handleChannelMessage(label: string, data: any) {
    if (label === 'input' && this.role === 'host') {
      // Check if input control is allowed
      if (!this.permissions.input) {
        return; // Host revoked or rejected input control
      }

      try {
        const inputEvent = JSON.parse(data) as RemoteInputEvent;
        // Forward directly to native Windows input injector
        if (window.aeroDeskApi) {
          window.aeroDeskApi.injectNativeInput({
            action: inputEvent.type as any,
            x: inputEvent.x,
            y: inputEvent.y,
            screen_w: inputEvent.screen_w,
            screen_h: inputEvent.screen_h,
            button: inputEvent.button,
            delta_y: inputEvent.delta_y,
            vk: inputEvent.vk,
            text: inputEvent.text
          });
        }
      } catch (err) {
        console.warn('[Input Dispatch] Invalid input packet', err);
      }
    } else if (label === 'control') {
      // Binary frames are file chunks; the channel is ordered + reliable, so arrival order is file order
      if (typeof data !== 'string') {
        const file = this.incomingFile;
        if (!file) return;
        file.parts.push(data);
        file.receivedBytes += data.byteLength;
        if (file.receivedBytes > file.fileSize) {
          console.warn('[File Transfer] Peer sent more bytes than announced; dropping transfer');
          this.incomingFile = null;
          return;
        }
        this.events.onFileTransferProgress?.(file.fileName, Math.round((file.receivedBytes / file.fileSize) * 100));
        if (file.receivedBytes === file.fileSize) {
          this.incomingFile = null;
          this.events.onFileTransferComplete?.(file.fileName, new Blob(file.parts));
        }
        return;
      }
      try {
        const msg = JSON.parse(data);
        if (msg.type === 'quality_preset' && this.role === 'host' && ['speed', 'balanced', 'quality'].includes(msg.preset)) {
          this.applyQualityPreset(msg.preset);
        } else if (msg.type === 'clipboard_sync' && this.permissions.clipboard) {
          if (window.aeroDeskApi) {
            window.aeroDeskApi.writeClipboard(msg.text);
          }
          this.events.onClipboardReceived?.(msg.text);
        } else if (msg.type === 'file_meta' && this.permissions.fileTransfer) {
          // Peer-supplied size: reject anything invalid or over the 100 MB cap
          if (!Number.isInteger(msg.fileSize) || msg.fileSize < 0 || msg.fileSize > MAX_FILE_BYTES) {
            console.warn('[File Transfer] Rejected invalid file metadata');
            return;
          }
          if (msg.fileSize === 0) {
            this.events.onFileTransferComplete?.(String(msg.fileName), new Blob([]));
            return;
          }
          this.incomingFile = {
            fileName: String(msg.fileName),
            fileSize: msg.fileSize,
            receivedBytes: 0,
            parts: []
          };
          this.events.onFileTransferProgress?.(this.incomingFile.fileName, 0);
        }
      } catch (err) {
        console.warn('[Control Message Error]', err);
      }
    }
  }

  public sendInputEvent(event: RemoteInputEvent) {
    if (this.role === 'viewer' && this.inputChannel && this.inputChannel.readyState === 'open') {
      this.inputChannel.send(JSON.stringify(event));
    }
  }

  public sendClipboardText(text: string): boolean {
    if (this.permissions.clipboard && this.controlChannel && this.controlChannel.readyState === 'open') {
      this.controlChannel.send(JSON.stringify({
        type: 'clipboard_sync',
        text
      }));
      return true;
    }
    return false;
  }

  public async sendFile(file: File) {
    const channel = this.controlChannel;
    if (!this.permissions.fileTransfer || !channel || channel.readyState !== 'open') {
      throw new Error('File transfer is not permitted or control channel is closed');
    }

    // Wait until the outgoing buffer drops to `threshold`; event-driven since timers get throttled in background windows
    const drain = (threshold: number) => new Promise<void>((resolve) => {
      if (channel.bufferedAmount <= threshold) return resolve();
      channel.bufferedAmountLowThreshold = threshold;
      channel.addEventListener('bufferedamountlow', () => resolve(), { once: true });
      channel.addEventListener('close', () => resolve(), { once: true }); // send() then throws instead of hanging
    });

    channel.send(JSON.stringify({
      type: 'file_meta',
      fileName: file.name,
      fileSize: file.size
    }));

    const buffer = await file.arrayBuffer();
    for (let offset = 0; offset < file.size; offset += CHUNK_SIZE) {
      // Backpressure: send() throws once the outgoing buffer overflows on large files
      await drain(BUFFER_HIGH_WATER);
      channel.send(buffer.slice(offset, offset + CHUNK_SIZE));
      // Progress counts bytes that actually left this machine, not bytes queued
      const delivered = Math.min(file.size, offset + CHUNK_SIZE) - channel.bufferedAmount;
      this.events.onFileTransferProgress?.(file.name, Math.max(0, Math.min(99, Math.floor((delivered / file.size) * 100))));
    }
    await drain(0);
    if (channel.readyState !== 'open') {
      throw new Error('Connection closed before the file was fully sent');
    }
    this.events.onFileTransferProgress?.(file.name, 100);
  }

  private async acquireScreenStream(preferredSourceId?: string): Promise<MediaStream> {
    if (window.aeroDeskApi) {
      try {
        const sources = await window.aeroDeskApi.getDesktopSources();
        console.log('[WebRTC Host] Available desktop sources:', sources.map(s => ({ id: s.id, name: s.name })));
        const targetSource = preferredSourceId
          ? sources.find(s => s.id === preferredSourceId)
          : sources.find(s => s.id.startsWith('screen:')) || sources[0];

        if (targetSource) {
          try {
            return await (navigator.mediaDevices as any).getUserMedia({
              audio: false,
              video: {
                mandatory: {
                  chromeMediaSource: 'desktop',
                  chromeMediaSourceId: targetSource.id,
                  maxWidth: 1920,
                  maxHeight: 1080,
                  maxFrameRate: 60
                }
              }
            });
          } catch (resErr) {
            console.warn('[WebRTC Host] Optimal screen capture failed, retrying minimal constraints:', resErr);
            return await (navigator.mediaDevices as any).getUserMedia({
              audio: false,
              video: {
                mandatory: {
                  chromeMediaSource: 'desktop',
                  chromeMediaSourceId: targetSource.id
                }
              }
            });
          }
        }
      } catch (electronErr) {
        console.warn('[WebRTC Host] DesktopCapturer getUserMedia failed, attempting getDisplayMedia fallback:', electronErr);
      }
    }

    // Standard fallback (getDisplayMedia)
    return await navigator.mediaDevices.getDisplayMedia({
      video: { frameRate: { ideal: 60 } },
      audio: false
    });
  }

  public applyQualityPreset(preset: QualityPreset) {
    if (!this.pc) return;
    const senders = this.pc.getSenders();
    const videoSender = senders.find(s => s.track && s.track.kind === 'video');
    if (!videoSender) return;

    // Screen content: 'detail' keeps text crisp, 'motion' favors smooth frame rate
    videoSender.track!.contentHint = preset === 'speed' ? 'motion' : 'detail';

    const params = videoSender.getParameters();
    if (!params.encodings || params.encodings.length === 0) {
      params.encodings = [{}];
    }

    if (preset === 'speed') {
      params.encodings[0].maxBitrate = 1500000; // 1.5 Mbps
      params.encodings[0].maxFramerate = 60;
    } else if (preset === 'quality') {
      params.encodings[0].maxBitrate = 8000000; // 8 Mbps
      params.encodings[0].maxFramerate = 60;
    } else {
      params.encodings[0].maxBitrate = 3500000; // 3.5 Mbps Balanced
      params.encodings[0].maxFramerate = 45;
    }

    // Under CPU/bandwidth pressure, only "quality" may drop frames; frame drops make the cursor stutter
    (params as any).degradationPreference = preset === 'quality' ? 'maintain-resolution' : 'maintain-framerate';

    videoSender.setParameters(params).catch(err => {
      console.warn('[WebRTC Quality] Failed to adjust sender bitrate:', err);
    });
  }

  private startStatsMonitoring() {
    this.stopStatsMonitoring();
    this.statsTimer = setInterval(async () => {
      if (!this.pc) return;
      try {
        const stats = await this.pc.getStats();
        let rtt = 0;
        let fps = 0;
        let bitrate = 0;

        stats.forEach((report) => {
          if (report.type === 'candidate-pair' && report.currentRoundTripTime) {
            rtt = Math.round(report.currentRoundTripTime * 1000);
          }
          if (report.type === (this.role === 'host' ? 'outbound-rtp' : 'inbound-rtp') && report.kind === 'video') {
            const bytes = this.role === 'host' ? report.bytesSent : report.bytesReceived;
            if (report.framesPerSecond) fps = Math.round(report.framesPerSecond);
            if (bytes && this.lastStatsTimestamp) {
              const deltaTime = (report.timestamp - this.lastStatsTimestamp) / 1000;
              bitrate = Math.round(((bytes - this.lastBytes) * 8) / (deltaTime * 1000)); // kbps
            }
            this.lastBytes = bytes || 0;
            this.lastStatsTimestamp = report.timestamp;
          }
        });

        this.events.onStatsUpdate?.({ rttMs: rtt, fps, bitrateKbps: bitrate });
      } catch (_) {}
    }, 1000);
  }

  private stopStatsMonitoring() {
    if (this.statsTimer) {
      clearInterval(this.statsTimer);
      this.statsTimer = null;
    }
  }

  public close() {
    this.stopStatsMonitoring();
    if (this.localStream) {
      this.localStream.getTracks().forEach(t => t.stop());
      this.localStream = null;
    }
    if (this.inputChannel) {
      this.inputChannel.close();
      this.inputChannel = null;
    }
    if (this.controlChannel) {
      this.controlChannel.close();
      this.controlChannel = null;
    }
    if (this.pc) {
      this.pc.close();
      this.pc = null;
    }
    this.remoteStream = null;
    this.pendingCandidates = [];
    this.hostReady = null;
  }
}
