"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
// electron/preload.ts
const electron_1 = require("electron");
const aeroDeskApi = {
    // Screen Sources
    getDesktopSources: () => {
        return electron_1.ipcRenderer.invoke('desktop-capturer:get-sources');
    },
    // Native Windows Input
    injectNativeInput: (cmd) => {
        return electron_1.ipcRenderer.invoke('native-input:inject', cmd);
    },
    getInputInjectorStatus: () => {
        return electron_1.ipcRenderer.invoke('native-input:status');
    },
    // Host Indicator Overlay
    showHostOverlay: (info) => {
        return electron_1.ipcRenderer.invoke('host-overlay:show', info);
    },
    hideHostOverlay: () => {
        return electron_1.ipcRenderer.invoke('host-overlay:hide');
    },
    // Clipboard
    readClipboard: () => {
        return electron_1.ipcRenderer.invoke('clipboard:read-text');
    },
    writeClipboard: (text) => {
        return electron_1.ipcRenderer.invoke('clipboard:write-text', text);
    },
    // Audit Logs
    appendAuditLog: (entry) => {
        return electron_1.ipcRenderer.invoke('audit-log:append', entry);
    },
    getAuditLogs: (limit) => {
        return electron_1.ipcRenderer.invoke('audit-log:get', limit);
    },
    // System Details
    getSystemInfo: () => {
        return electron_1.ipcRenderer.invoke('system:get-info');
    },
    // Window Controls
    minimizeWindow: () => electron_1.ipcRenderer.send('window:minimize'),
    maximizeWindow: () => electron_1.ipcRenderer.send('window:maximize'),
    closeWindow: () => electron_1.ipcRenderer.send('window:close'),
    // Event Listeners from Host Overlay / Global Shortcuts
    onEmergencyRevoke: (callback) => {
        const listener = () => callback();
        electron_1.ipcRenderer.on('session:emergency-revoke', listener);
        return () => electron_1.ipcRenderer.removeListener('session:emergency-revoke', listener);
    },
    onHostDisconnect: (callback) => {
        const listener = () => callback();
        electron_1.ipcRenderer.on('session:host-disconnect', listener);
        return () => electron_1.ipcRenderer.removeListener('session:host-disconnect', listener);
    }
};
electron_1.contextBridge.exposeInMainWorld('aeroDeskApi', aeroDeskApi);
