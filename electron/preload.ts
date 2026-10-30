// electron/preload.ts
import { contextBridge, ipcRenderer, webUtils } from 'electron';

export interface DesktopSource {
  id: string;
  name: string;
  thumbnail: string;
  display_id?: string;
}

export interface AuditLogEntry {
  id?: string;
  timestamp: string;
  type: 'incoming_connection' | 'outgoing_connection' | 'permission_change' | 'disconnect' | 'input_revocation';
  peerId: string;
  peerName?: string;
  permissions?: {
    view?: boolean;
    input?: boolean;
    clipboard?: boolean;
    fileTransfer?: boolean;
  };
  durationSeconds?: number;
  status: 'accepted' | 'rejected' | 'terminated' | 'active';
  details?: string;
}

export interface LanSharePeer {
  id: string;
  name: string;
  folder: string;
  host: string;
}

export interface LanShareEntry {
  name: string;
  dir: boolean;
  size: number;
}

export interface NativeInputCommand {
  action: 'mouse_move' | 'mouse_down' | 'mouse_up' | 'mouse_click' | 'mouse_wheel' | 'key_down' | 'key_up' | 'key_press' | 'unicode_text' | 'cursor_hide' | 'cursor_show' | 'ping';
  x?: number;
  y?: number;
  screen_w?: number;
  screen_h?: number;
  button?: 'left' | 'right' | 'middle';
  delta_y?: number;
  vk?: number;
  text?: string;
}

const aeroDeskApi = {
  // Screen Sources
  getDesktopSources: (): Promise<DesktopSource[]> => {
    return ipcRenderer.invoke('desktop-capturer:get-sources');
  },

  // Native Windows Input
  injectNativeInput: (cmd: NativeInputCommand): Promise<{ status: string; action?: string; message?: string }> => {
    return ipcRenderer.invoke('native-input:inject', cmd);
  },

  getInputInjectorStatus: (): Promise<{ available: boolean; ready: boolean }> => {
    return ipcRenderer.invoke('native-input:status');
  },

  // Host Indicator Overlay
  showHostOverlay: (info: { peerId: string; peerName: string; permissions: any }): Promise<boolean> => {
    return ipcRenderer.invoke('host-overlay:show', info);
  },

  hideHostOverlay: (): Promise<boolean> => {
    return ipcRenderer.invoke('host-overlay:hide');
  },

  // Host overlay banner buttons (revoke / disconnect / collapse / expand)
  hostOverlayAction: (action: 'revoke' | 'disconnect' | 'collapse' | 'expand') => {
    ipcRenderer.send('host-overlay:action', action);
  },

  // File transfer line in the host banner: main app sends it, the banner window listens
  hostOverlayTransfer: (transfer: { title: string; detail: string; percent: number; status: string } | null) => {
    ipcRenderer.send('host-overlay:transfer', transfer);
  },
  onHostOverlayTransfer: (callback: (state: { transfer: { title: string; detail: string; percent: number; status: string } | null; collapsed: boolean }) => void) => {
    const listener = (_event: unknown, state: any) => callback(state);
    ipcRenderer.on('host-overlay:transfer', listener);
    return () => ipcRenderer.removeListener('host-overlay:transfer', listener);
  },

  // Clipboard
  readClipboard: (): Promise<string> => {
    return ipcRenderer.invoke('clipboard:read-text');
  },

  writeClipboard: (text: string): Promise<boolean> => {
    return ipcRenderer.invoke('clipboard:write-text', text);
  },

  // Received files stream into Downloads: start -> chunk* -> finish (resolves to the saved path) | abort
  receiveFileStart: (fileName: string): Promise<string> => ipcRenderer.invoke('file:receive-start', fileName),
  receiveFileChunk: (id: string, data: Uint8Array): Promise<void> => ipcRenderer.invoke('file:receive-chunk', id, data),
  receiveFileFinish: (id: string): Promise<string> => ipcRenderer.invoke('file:receive-finish', id),
  receiveFileAbort: (id: string): Promise<void> => ipcRenderer.invoke('file:receive-abort', id),

  // Viewer: capture system shortcuts (Win, Alt+Tab, Ctrl+Esc, PrintScreen) while the window is focused
  setKeyCapture: (enabled: boolean): Promise<{ status: string }> => ipcRenderer.invoke('native-input:key-capture', enabled),
  onCapturedKey: (callback: (key: { vk: number; up: boolean }) => void) => {
    const listener = (_event: unknown, key: { vk: number; up: boolean }) => callback(key);
    ipcRenderer.on('native-input:captured-key', listener);
    return () => ipcRenderer.removeListener('native-input:captured-key', listener);
  },

  // Local path of a dropped File (for streaming uploads from the main process)
  getPathForFile: (file: File): string => webUtils.getPathForFile(file),

  // LAN folder sharing: share one folder read-only, browse/download from other PCs on the network
  pickLanShareFolder: (): Promise<string | null> => ipcRenderer.invoke('lan-share:pick-folder'),
  stopLanShare: (): Promise<boolean> => ipcRenderer.invoke('lan-share:stop'),
  getLanShareStatus: (): Promise<string | null> => ipcRenderer.invoke('lan-share:status'),
  getLanSharePeers: (): Promise<LanSharePeer[]> => ipcRenderer.invoke('lan-share:peers'),
  listLanShare: (peerId: string, relPath: string): Promise<LanShareEntry[]> => ipcRenderer.invoke('lan-share:list', peerId, relPath),
  downloadLanShareFile: (peerId: string, relPath: string): Promise<string> => ipcRenderer.invoke('lan-share:download', peerId, relPath),

  // Audit Logs
  appendAuditLog: (entry: AuditLogEntry): Promise<boolean> => {
    return ipcRenderer.invoke('audit-log:append', entry);
  },

  getAuditLogs: (limit?: number): Promise<AuditLogEntry[]> => {
    return ipcRenderer.invoke('audit-log:get', limit);
  },

  // System Details
  getSystemInfo: (): Promise<{ platform: string; release: string; hostname: string; arch: string }> => {
    return ipcRenderer.invoke('system:get-info');
  },

  // Window Controls
  minimizeWindow: () => ipcRenderer.send('window:minimize'),
  maximizeWindow: () => ipcRenderer.send('window:maximize'),
  closeWindow: () => ipcRenderer.send('window:close'),

  // Event Listeners from Host Overlay / Global Shortcuts
  onEmergencyRevoke: (callback: () => void) => {
    const listener = () => callback();
    ipcRenderer.on('session:emergency-revoke', listener);
    return () => ipcRenderer.removeListener('session:emergency-revoke', listener);
  },

  onHostDisconnect: (callback: () => void) => {
    const listener = () => callback();
    ipcRenderer.on('session:host-disconnect', listener);
    return () => ipcRenderer.removeListener('session:host-disconnect', listener);
  },

  // Incoming call: raise the main window (in-app prompt) / release it once answered
  notifyIncomingCall: (callData: any): Promise<boolean> => {
    return ipcRenderer.invoke('incoming-call:notify', callData);
  },

  clearIncomingCallAlert: (): Promise<boolean> => {
    return ipcRenderer.invoke('incoming-call:clear-alert');
  }
};

contextBridge.exposeInMainWorld('aeroDeskApi', aeroDeskApi);

declare global {
  interface Window {
    aeroDeskApi?: typeof aeroDeskApi;
  }
}
