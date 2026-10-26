// electron/preload.ts
import { contextBridge, ipcRenderer } from 'electron';

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

export interface NativeInputCommand {
  action: 'mouse_move' | 'mouse_down' | 'mouse_up' | 'mouse_click' | 'mouse_wheel' | 'key_down' | 'key_up' | 'key_press' | 'unicode_text' | 'ping';
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

  // Clipboard
  readClipboard: (): Promise<string> => {
    return ipcRenderer.invoke('clipboard:read-text');
  },

  writeClipboard: (text: string): Promise<boolean> => {
    return ipcRenderer.invoke('clipboard:write-text', text);
  },

  // Audit Logs
  appendAuditLog: (entry: AuditLogEntry): Promise<boolean> => {
    return ipcRenderer.invoke('audit-log:append', entry);
  },

  getAuditLogs: (limit?: number): Promise<AuditLogEntry[]> => {
    return ipcRenderer.invoke('audit-log:get', limit);
  },

  // System Details
  getSystemInfo: (): Promise<{ platform: string; hostname: string; arch: string }> => {
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
  }
};

contextBridge.exposeInMainWorld('aeroDeskApi', aeroDeskApi);

declare global {
  interface Window {
    aeroDeskApi?: typeof aeroDeskApi;
  }
}
