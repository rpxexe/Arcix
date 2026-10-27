// src/services/webrtc-manager.ts
import { QualityPreset, RemoteInputEvent, SessionPermissions } from '../types';
import { SignalingClient } from './signaling-client';

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
    totalChunks: number;
    receivedChunks: Map<number, Uint8Array>;
  } | null = null;

  // ICE candidates arriving before remote description is set
  private pendingCandidates: RTCIceCandidateInit[] = [];

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

    // Setup screen capture stream
    try {
      this.localStream = await this.acquireScreenStream(sourceId);
      console.log('[WebRTC Host] Acquired screen stream, track count:', this.localStream.getTracks().length);
      this.localStream.getTracks().forEach((track) => {
        this.pc?.addTrack(track, this.localStream!);
      });
    } catch (err) {
      console.error('[WebRTC Host] Failed to capture screen:', err);
      throw err;
    }

    // Host listens for data channels created by viewer
    this.pc!.ondatachannel = (event) => {
      this.setupDataChannel(event.channel);
    };

    this.startStatsMonitoring();
  }

  public async startAsViewer(hostId: string, permissions: SessionPermissions): Promise<void> {
    this.role = 'viewer';
    this.peerId = hostId;
    this.permissions = permissions;

    this.createPeerConnection();

    // Viewer creates ultra-low latency unordered input channel
    this.inputChannel = this.pc!.createDataChannel('input', {
      ordered: false,
      maxRetransmits: 0
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
      console.log(`[DataChannel] Channel '${channel.label}' opened`);
      this.events.onDataChannelReady?.();
    };

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
      try {
        const msg = JSON.parse(data);
        if (msg.type === 'clipboard_sync' && this.permissions.clipboard) {
          if (window.aeroDeskApi) {
            window.aeroDeskApi.writeClipboard(msg.text);
          }
          this.events.onClipboardReceived?.(msg.text);
        } else if (msg.type === 'file_meta' && this.permissions.fileTransfer) {
          this.incomingFile = {
            fileName: msg.fileName,
            fileSize: msg.fileSize,
            totalChunks: msg.totalChunks,
            receivedChunks: new Map()
          };
          this.events.onFileTransferProgress?.(msg.fileName, 0);
        } else if (msg.type === 'file_chunk' && this.incomingFile) {
          const rawBytes = Uint8Array.from(atob(msg.dataBase64), c => c.charCodeAt(0));
          this.incomingFile.receivedChunks.set(msg.chunkIndex, rawBytes);

          const percent = Math.round((this.incomingFile.receivedChunks.size / this.incomingFile.totalChunks) * 100);
          this.events.onFileTransferProgress?.(this.incomingFile.fileName, percent);

          if (this.incomingFile.receivedChunks.size === this.incomingFile.totalChunks) {
            // Reassemble
            const parts: Uint8Array[] = [];
            for (let i = 0; i < this.incomingFile.totalChunks; i++) {
              parts.push(this.incomingFile.receivedChunks.get(i)!);
            }
            const blob = new Blob(parts);
            this.events.onFileTransferComplete?.(this.incomingFile.fileName, blob);
            this.incomingFile = null;
          }
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

  public sendClipboardText(text: string) {
    if (this.permissions.clipboard && this.controlChannel && this.controlChannel.readyState === 'open') {
      this.controlChannel.send(JSON.stringify({
        type: 'clipboard_sync',
        text
      }));
    }
  }

  public async sendFile(file: File) {
    if (!this.permissions.fileTransfer || !this.controlChannel || this.controlChannel.readyState !== 'open') {
      throw new Error('File transfer is not permitted or control channel is closed');
    }

    const CHUNK_SIZE = 16384; // 16 KB chunks
    const totalChunks = Math.ceil(file.size / CHUNK_SIZE);

    // Send meta
    this.controlChannel.send(JSON.stringify({
      type: 'file_meta',
      fileName: file.name,
      fileSize: file.size,
      totalChunks
    }));

    const buffer = await file.arrayBuffer();
    const uint8 = new Uint8Array(buffer);

    for (let i = 0; i < totalChunks; i++) {
      const start = i * CHUNK_SIZE;
      const end = Math.min(start + CHUNK_SIZE, file.size);
      const chunkBytes = uint8.slice(start, end);

      // Convert chunk to base64
      let binary = '';
      for (let j = 0; j < chunkBytes.length; j++) {
        binary += String.fromCharCode(chunkBytes[j]);
      }
      const dataBase64 = btoa(binary);

      this.controlChannel.send(JSON.stringify({
        type: 'file_chunk',
        chunkIndex: i,
        dataBase64
      }));

      const percent = Math.round(((i + 1) / totalChunks) * 100);
      this.events.onFileTransferProgress?.(file.name, percent);
    }
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
        let rtt = 15;
        let fps = 60;
        let bitrate = 0;

        stats.forEach((report) => {
          if (report.type === 'candidate-pair' && report.currentRoundTripTime) {
            rtt = Math.round(report.currentRoundTripTime * 1000);
          }
          if (report.type === 'inbound-rtp' && report.kind === 'video') {
            if (report.framesPerSecond) fps = Math.round(report.framesPerSecond);
            if (report.bytesReceived && this.lastStatsTimestamp) {
              const deltaBytes = report.bytesReceived - this.lastBytes;
              const deltaTime = (report.timestamp - this.lastStatsTimestamp) / 1000;
              bitrate = Math.round((deltaBytes * 8) / (deltaTime * 1000)); // kbps
              this.lastBytes = report.bytesReceived;
            } else {
              this.lastBytes = report.bytesReceived;
            }
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
  }
}
