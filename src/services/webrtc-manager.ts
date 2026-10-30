// src/services/webrtc-manager.ts
import { FileTransferItem, QualityPreset, RemoteInputEvent, SessionPermissions } from '../types';
import { SignalingClient } from './signaling-client';

const CHUNK_SIZE = 64 * 1024; // binary file chunks; well under Chromium's 256 KB message limit
const READ_BLOCK = 1024 * 1024; // sender reads the file in 1 MB slices, never the whole file
const BUFFER_HIGH_WATER = 4 * 1024 * 1024;
const DISK_FLUSH_BYTES = 4 * 1024 * 1024; // receiver writes to disk in 4 MB batches
const MAX_FILE_BYTES = 10 * 1024 * 1024 * 1024;
const PROGRESS_INTERVAL_MS = 100;

const concatParts = (parts: ArrayBuffer[], size: number) => {
  const out = new Uint8Array(size);
  let offset = 0;
  for (const p of parts) {
    out.set(new Uint8Array(p), offset);
    offset += p.byteLength;
  }
  return out;
};

export interface WebRTCStats {
  rttMs: number;
  fps: number;
  bitrateKbps: number;
}

export type WebRTCEvents = {
  onRemoteStream?: (stream: MediaStream) => void;
  onStatsUpdate?: (stats: WebRTCStats) => void;
  onDataChannelReady?: () => void;
  onTransferUpdate?: (transfer: FileTransferItem) => void;
  onClipboardReceived?: (text: string) => void;
  onConnectionStateChange?: (state: RTCPeerConnectionState) => void;
};

export class WebRTCManager {
  private pc: RTCPeerConnection | null = null;
  private inputChannel: RTCDataChannel | null = null;
  private mouseChannel: RTCDataChannel | null = null;
  private controlChannel: RTCDataChannel | null = null;
  private moveSeq = 0;
  private lastAppliedMoveSeq = -1;
  // Viewer renders its own cursor and asks the host to hide the system cursor while it has control
  private remoteCursorHidden = false;
  private hostCursorHidden = false;
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

  // File transfers: one outgoing and one incoming file at a time on the ordered control channel
  private transfers = new Map<string, FileTransferItem>();
  private lastProgressEmit = new Map<string, number>();
  private sendQueue: { item: FileTransferItem; file: File }[] = [];
  private sending = false;
  private incoming: {
    item: FileTransferItem;
    parts: ArrayBuffer[];
    bufferedBytes: number;
    handle: Promise<string>;
    writes: Promise<unknown>;
  } | null = null;

  // ICE candidates arriving before remote description is set
  private pendingCandidates: RTCIceCandidateInit[] = [];
  private hostReady: Promise<void> | null = null;
  private quality: QualityPreset = 'balanced';

  // Automatic bidirectional clipboard synchronization
  private clipboardPollTimer: any = null;
  private lastLocalClipboard: string = '';
  private lastReceivedClipboard: string = '';
  private boundOnWindowFocus: (() => void) | null = null;

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
    this.applyHostCursor();
    if (this.permissions.clipboard && this.controlChannel?.readyState === 'open') {
      this.startClipboardSync();
    } else if (!this.permissions.clipboard) {
      this.stopClipboardSync();
    }
  }

  private async readSystemClipboard(): Promise<string> {
    try {
      if (window.aeroDeskApi?.readClipboard) {
        return (await window.aeroDeskApi.readClipboard()) || '';
      } else if (typeof navigator !== 'undefined' && navigator.clipboard?.readText) {
        return (await navigator.clipboard.readText()) || '';
      }
    } catch (_) {}
    return '';
  }

  private async writeSystemClipboard(text: string): Promise<boolean> {
    try {
      if (window.aeroDeskApi?.writeClipboard) {
        await window.aeroDeskApi.writeClipboard(text);
        return true;
      } else if (typeof navigator !== 'undefined' && navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(text);
        return true;
      }
    } catch (err) {
      console.warn('[Clipboard Sync] Failed to write to system clipboard:', err);
    }
    return false;
  }

  public async checkAndSyncClipboard(): Promise<boolean> {
    if (!this.permissions.clipboard || !this.controlChannel || this.controlChannel.readyState !== 'open') {
      return false;
    }
    const currentText = await this.readSystemClipboard();
    if (
      currentText &&
      currentText !== this.lastLocalClipboard &&
      currentText !== this.lastReceivedClipboard &&
      currentText.length <= 1024 * 1024
    ) {
      this.lastLocalClipboard = currentText;
      return this.sendClipboardText(currentText);
    }
    return false;
  }

  private startClipboardSync() {
    this.stopClipboardSync();
    if (!this.permissions.clipboard) return;

    // Prime local clipboard cache so existing contents are not pushed unless newly copied
    this.readSystemClipboard().then((text) => {
      this.lastLocalClipboard = text;
    });

    // 500ms background polling interval for active bidirectional sync
    this.clipboardPollTimer = setInterval(() => {
      this.checkAndSyncClipboard();
    }, 500);

    // Immediate sync on window focus
    if (typeof window !== 'undefined') {
      this.boundOnWindowFocus = () => {
        this.checkAndSyncClipboard();
      };
      window.addEventListener('focus', this.boundOnWindowFocus);
    }
  }

  private stopClipboardSync() {
    if (this.clipboardPollTimer) {
      clearInterval(this.clipboardPollTimer);
      this.clipboardPollTimer = null;
    }
    if (this.boundOnWindowFocus && typeof window !== 'undefined') {
      window.removeEventListener('focus', this.boundOnWindowFocus);
      this.boundOnWindowFocus = null;
    }
  }

  // Host: hide the system cursor only while the viewer controls input and draws its own cursor
  private applyHostCursor() {
    const hide = this.role === 'host' && !!this.pc && this.remoteCursorHidden && this.permissions.input;
    if (hide === this.hostCursorHidden) return;
    this.hostCursorHidden = hide;
    window.aeroDeskApi?.injectNativeInput({ action: hide ? 'cursor_hide' : 'cursor_show' });
  }

  // Viewer: tell the host whether we render the cursor locally (sent again when the channel opens)
  public setRemoteCursorHidden(hidden: boolean) {
    this.remoteCursorHidden = hidden;
    if (this.controlChannel?.readyState === 'open') {
      this.controlChannel.send(JSON.stringify({ type: 'remote_cursor', hidden }));
    }
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

    // Mouse moves: unordered, never retransmitted. A lost move is superseded by the next one instead of
    // stalling everything behind it (head-of-line blocking was the main source of cursor lag under loss)
    this.mouseChannel = this.pc!.createDataChannel('mouse', {
      ordered: false,
      maxRetransmits: 0
    });
    this.setupDataChannel(this.mouseChannel);

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
    } else if (channel.label === 'mouse') {
      this.mouseChannel = channel;
    } else if (channel.label === 'control') {
      this.controlChannel = channel;
      // close() detaches the channel first, so a late close event from an ended session is ignored
      channel.onclose = () => {
        this.stopClipboardSync();
        if (this.controlChannel === channel) this.failTransfers('Connection lost');
      };
    }

    channel.onopen = () => {
      // Viewer picks quality, host owns the encoder: tell it once the control channel is up
      if (channel.label === 'control') {
        if (this.role === 'viewer') {
          channel.send(JSON.stringify({ type: 'quality_preset', preset: this.quality }));
          channel.send(JSON.stringify({ type: 'remote_cursor', hidden: this.remoteCursorHidden }));
        }
        if (this.permissions.clipboard) {
          this.startClipboardSync();
        }
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
    if ((label === 'input' || label === 'mouse') && this.role === 'host') {
      // Check if input control is allowed
      if (!this.permissions.input) {
        return; // Host revoked or rejected input control
      }

      try {
        const inputEvent = JSON.parse(data) as RemoteInputEvent;
        if (inputEvent.seq !== undefined) {
          if (inputEvent.seq <= this.lastAppliedMoveSeq) return; // arrived out of order, a newer move already applied
          this.lastAppliedMoveSeq = inputEvent.seq;
        }
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
        // If user performed Copy/Cut (Ctrl+C / Ctrl+X) on the host, trigger an immediate clipboard check
        if (inputEvent.type === 'key_up' && (inputEvent.vk === 0x43 || inputEvent.vk === 0x58)) {
          setTimeout(() => this.checkAndSyncClipboard(), 150);
        }
      } catch (err) {
        console.warn('[Input Dispatch] Invalid input packet', err);
      }
    } else if (label === 'control') {
      // Binary frames are file chunks; the channel is ordered + reliable, so arrival order is file order
      if (typeof data !== 'string') {
        this.receiveChunk(data);
        return;
      }
      try {
        const msg = JSON.parse(data);
        if (msg.type === 'quality_preset' && this.role === 'host' && ['speed', 'balanced', 'quality'].includes(msg.preset)) {
          this.applyQualityPreset(msg.preset);
        } else if (msg.type === 'remote_cursor' && this.role === 'host') {
          this.remoteCursorHidden = msg.hidden === true;
          this.applyHostCursor();
        } else if (msg.type === 'clipboard_sync' && this.permissions.clipboard) {
          const text = typeof msg.text === 'string' ? msg.text : '';
          if (text && text !== this.lastLocalClipboard) {
            this.lastReceivedClipboard = text;
            this.lastLocalClipboard = text;
            this.writeSystemClipboard(text);
          }
          this.events.onClipboardReceived?.(text);
        } else if (msg.type === 'file_meta' && this.permissions.fileTransfer) {
          this.startReceive(msg);
        } else if (msg.type === 'file_cancel') {
          const item = this.transfers.get(String(msg.id));
          if (item && (item.status === 'active' || item.status === 'queued')) this.endTransfer(item, 'cancelled', 'Cancelled by the other side');
        }
      } catch (err) {
        console.warn('[Control Message Error]', err);
      }
    }
  }

  private emitTransfer(item: FileTransferItem, force = true) {
    const now = performance.now();
    // Chunks arrive hundreds of times a second; cap progress re-renders at ~10/s
    if (!force && now - (this.lastProgressEmit.get(item.id) || 0) < PROGRESS_INTERVAL_MS) return;
    this.lastProgressEmit.set(item.id, now);
    this.events.onTransferUpdate?.({ ...item });
  }

  // Moves a transfer to a final state once; cleans up a partially received file
  private endTransfer(item: FileTransferItem, status: 'done' | 'error' | 'cancelled', error?: string) {
    if (item.status === 'done' || item.status === 'error' || item.status === 'cancelled') return;
    item.status = status;
    item.error = error;
    if (this.incoming?.item === item) {
      const { handle } = this.incoming;
      this.incoming = null;
      if (status !== 'done') handle.then((h) => window.aeroDeskApi?.receiveFileAbort(h)).catch(() => {});
    }
    this.lastProgressEmit.delete(item.id);
    this.emitTransfer(item);
  }

  private failTransfers(reason: string) {
    this.sendQueue = [];
    this.transfers.forEach((item) => this.endTransfer(item, 'error', reason));
  }

  private startReceive(msg: any) {
    const api = window.aeroDeskApi;
    const id = String(msg.id || '');
    // Peer-supplied metadata: reject anything invalid or over the cap
    if (!id || this.transfers.has(id) || !Number.isInteger(msg.fileSize) || msg.fileSize < 0 || msg.fileSize > MAX_FILE_BYTES) {
      console.warn('[File Transfer] Rejected invalid file metadata');
      return;
    }
    if (this.incoming) this.endTransfer(this.incoming.item, 'error', 'Interrupted by a new transfer');

    const item: FileTransferItem = {
      id,
      direction: 'receive',
      fileName: String(msg.fileName),
      totalBytes: msg.fileSize,
      transferredBytes: 0,
      startedAt: Date.now(),
      status: 'active'
    };
    this.transfers.set(id, item);
    if (!api) {
      this.emitTransfer(item);
      this.rejectIncoming(item, 'Receiving files requires the desktop app');
      return;
    }
    const handle = api.receiveFileStart(item.fileName);
    this.incoming = { item, parts: [], bufferedBytes: 0, handle, writes: handle };
    this.emitTransfer(item);
    if (item.totalBytes === 0) this.flushIncoming(true);
  }

  private receiveChunk(data: ArrayBuffer) {
    const incoming = this.incoming;
    if (!incoming) return; // chunks of a transfer we already cancelled
    const { item } = incoming;
    incoming.parts.push(data);
    incoming.bufferedBytes += data.byteLength;
    item.transferredBytes += data.byteLength;
    if (item.transferredBytes > item.totalBytes) {
      this.rejectIncoming(item, 'Peer sent more data than announced');
      return;
    }
    const complete = item.transferredBytes === item.totalBytes;
    if (complete || incoming.bufferedBytes >= DISK_FLUSH_BYTES) this.flushIncoming(complete);
    if (!complete) this.emitTransfer(item, false);
  }

  // Appends buffered chunks to the .part file in order; on the last batch, finalizes it into Downloads
  private flushIncoming(complete: boolean) {
    const incoming = this.incoming!;
    const api = window.aeroDeskApi!;
    const { item, handle } = incoming;
    const data = concatParts(incoming.parts, incoming.bufferedBytes);
    incoming.parts = [];
    incoming.bufferedBytes = 0;
    // The sender starts the next file as soon as this one is sent, possibly before it is on disk
    if (complete) this.incoming = null;
    incoming.writes = incoming.writes
      .then(() => handle)
      .then((h) => (data.byteLength ? api.receiveFileChunk(h, data) : null))
      .then(() => {
        if (!complete) return null;
        if (item.status !== 'active') throw new Error('Cancelled');
        return handle.then((h) => api.receiveFileFinish(h));
      })
      .then((savedPath) => {
        if (!complete) return;
        item.savedPath = savedPath || undefined;
        this.endTransfer(item, 'done');
      })
      .catch((err) => {
        handle.then((h) => api.receiveFileAbort(h)).catch(() => {});
        if (item.status === 'active') this.rejectIncoming(item, err?.message || 'Could not save file');
      });
  }

  // Receiver-side failure or cancel: stop the sender too
  private rejectIncoming(item: FileTransferItem, reason: string, status: 'error' | 'cancelled' = 'error') {
    if (this.controlChannel?.readyState === 'open') {
      this.controlChannel.send(JSON.stringify({ type: 'file_cancel', id: item.id }));
    }
    this.endTransfer(item, status, reason);
  }

  public cancelTransfer(id: string) {
    const item = this.transfers.get(id);
    if (!item || (item.status !== 'active' && item.status !== 'queued')) return;
    if (item.direction === 'receive') {
      this.rejectIncoming(item, 'Cancelled', 'cancelled');
    } else {
      // The send loop sees the status change and tells the receiver
      this.endTransfer(item, 'cancelled', 'Cancelled');
    }
  }

  public sendInputEvent(event: RemoteInputEvent) {
    if (this.role !== 'viewer') return;
    if (event.type === 'mouse_move' && this.mouseChannel?.readyState === 'open') {
      this.mouseChannel.send(JSON.stringify({ ...event, seq: this.moveSeq++ }));
    } else if (this.inputChannel && this.inputChannel.readyState === 'open') {
      this.inputChannel.send(JSON.stringify(event));
    }
  }

  public sendClipboardText(text: string): boolean {
    if (this.permissions.clipboard && this.controlChannel && this.controlChannel.readyState === 'open') {
      this.lastLocalClipboard = text;
      this.controlChannel.send(JSON.stringify({
        type: 'clipboard_sync',
        text
      }));
      return true;
    }
    return false;
  }

  // Queues files; they are sent one after another and reported through onTransferUpdate
  public sendFiles(files: File[]) {
    const channel = this.controlChannel;
    if (!this.permissions.fileTransfer || !channel || channel.readyState !== 'open') {
      throw new Error('File transfer is not permitted or control channel is closed');
    }
    for (const file of files) {
      const item: FileTransferItem = {
        id: crypto.randomUUID(),
        direction: 'send',
        fileName: file.name,
        totalBytes: file.size,
        transferredBytes: 0,
        startedAt: Date.now(),
        status: 'queued'
      };
      this.transfers.set(item.id, item);
      this.sendQueue.push({ item, file });
      this.emitTransfer(item);
    }
    this.pumpSendQueue();
  }

  private async pumpSendQueue() {
    if (this.sending) return;
    this.sending = true;
    try {
      while (this.sendQueue.length > 0) {
        const { item, file } = this.sendQueue.shift()!;
        if (item.status !== 'queued') continue; // cancelled while waiting
        try {
          await this.sendOne(item, file);
        } catch (err: any) {
          this.endTransfer(item, 'error', err?.message || 'File transfer failed');
        }
      }
    } finally {
      this.sending = false;
    }
  }

  private async sendOne(item: FileTransferItem, file: File) {
    const channel = this.controlChannel;
    if (!channel || channel.readyState !== 'open') throw new Error('Connection lost');

    // Wait until the outgoing buffer drops to `threshold`; event-driven since timers get throttled in background windows
    const drain = (threshold: number) => new Promise<void>((resolve) => {
      if (channel.bufferedAmount <= threshold) return resolve();
      channel.bufferedAmountLowThreshold = threshold;
      channel.addEventListener('bufferedamountlow', () => resolve(), { once: true });
      channel.addEventListener('close', () => resolve(), { once: true }); // send() then throws instead of hanging
    });
    const stopped = () => item.status !== 'active';

    item.status = 'active';
    item.startedAt = Date.now();
    this.emitTransfer(item);
    channel.send(JSON.stringify({
      type: 'file_meta',
      id: item.id,
      fileName: file.name,
      fileSize: file.size
    }));

    for (let block = 0; block < file.size && !stopped(); block += READ_BLOCK) {
      const buffer = await file.slice(block, block + READ_BLOCK).arrayBuffer();
      for (let offset = 0; offset < buffer.byteLength && !stopped(); offset += CHUNK_SIZE) {
        // Backpressure: send() throws once the outgoing buffer overflows on large files
        await drain(BUFFER_HIGH_WATER);
        if (stopped()) break;
        channel.send(buffer.slice(offset, offset + CHUNK_SIZE));
        // Progress counts bytes that actually left this machine, not bytes queued
        const queued = Math.min(file.size, block + offset + CHUNK_SIZE);
        item.transferredBytes = Math.max(0, queued - channel.bufferedAmount);
        this.emitTransfer(item, false);
      }
    }
    // Status changes underneath this loop (cancelTransfer / peer cancel), so widen TS's narrowed 'active'
    if ((item.status as FileTransferItem['status']) === 'cancelled') {
      if (channel.readyState === 'open') channel.send(JSON.stringify({ type: 'file_cancel', id: item.id }));
      return;
    }
    if (stopped()) return; // receiver cancelled or connection failed; already reported
    await drain(0);
    if (channel.readyState !== 'open') {
      throw new Error('Connection closed before the file was fully sent');
    }
    item.transferredBytes = file.size;
    this.endTransfer(item, 'done');
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
                },
                optional: [
                  { cursor: 'always' }
                ]
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
                },
                optional: [
                  { cursor: 'always' }
                ]
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
      video: {
        cursor: 'always',
        frameRate: { ideal: 60 }
      },
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
    this.stopClipboardSync();
    this.stopStatsMonitoring();
    this.failTransfers('Session ended');
    this.transfers.clear();
    if (this.localStream) {
      this.localStream.getTracks().forEach(t => t.stop());
      this.localStream = null;
    }
    if (this.inputChannel) {
      this.inputChannel.close();
      this.inputChannel = null;
    }
    if (this.mouseChannel) {
      this.mouseChannel.close();
      this.mouseChannel = null;
    }
    this.moveSeq = 0;
    this.lastAppliedMoveSeq = -1;
    if (this.controlChannel) {
      this.controlChannel.close();
      this.controlChannel = null;
    }
    if (this.pc) {
      this.pc.close();
      this.pc = null;
    }
    this.remoteCursorHidden = false;
    this.applyHostCursor(); // restores the host's system cursor
    this.remoteStream = null;
    this.pendingCandidates = [];
    this.hostReady = null;
  }
}
