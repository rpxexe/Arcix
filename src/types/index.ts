// src/types/index.ts

export type ConnectionState =
  | 'disconnected'
  | 'registering'
  | 'idle'
  | 'calling'
  | 'ringing'
  | 'connecting'
  | 'connected'
  | 'reconnecting'
  | 'error';

export type SessionRole = 'idle' | 'viewer' | 'host';

export interface SessionPermissions {
  view: boolean;
  input: boolean;
  clipboard: boolean;
  fileTransfer: boolean;
}

export type QualityPreset = 'balanced' | 'quality' | 'speed';

export interface RecentSession {
  id: string;
  deviceId: string;
  deviceName: string;
  timestamp: string;
  durationSeconds: number;
}

export interface SavedDevice {
  id: string;
  deviceId: string;
  alias: string;
  favorite: boolean;
}

export interface IncomingCallData {
  callerId: string;
  callerName: string;
  requestedPermissions: SessionPermissions;
  password?: string;
}

export interface ActiveSessionData {
  peerId: string;
  peerName: string;
  role: 'viewer' | 'host';
  permissions: SessionPermissions;
  startTime: number;
  durationSeconds: number;
  quality: QualityPreset;
  rttMs: number;
  fps: number;
  bitrateKbps: number;
  isFullscreen: boolean;
  fitToWindow: boolean;
}

export interface RemoteInputEvent {
  type: 'mouse_move' | 'mouse_down' | 'mouse_up' | 'mouse_wheel' | 'key_down' | 'key_up' | 'unicode_text';
  x?: number;
  y?: number;
  screen_w?: number;
  screen_h?: number;
  button?: 'left' | 'right' | 'middle';
  delta_y?: number;
  vk?: number;
  text?: string;
  // Mouse moves travel on an unordered channel; the host drops any move older than the last one applied
  seq?: number;
}

export interface FileTransferItem {
  id: string;
  direction: 'send' | 'receive';
  fileName: string;
  totalBytes: number;
  transferredBytes: number;
  startedAt: number;
  status: 'queued' | 'active' | 'done' | 'error' | 'cancelled';
  error?: string;
  savedPath?: string;
}

export interface FileTransferMeta {
  transferId: string;
  fileName: string;
  fileSize: number;
  mimeType: string;
  totalChunks: number;
}

export interface FileChunk {
  transferId: string;
  chunkIndex: number;
  dataBase64: string;
}
