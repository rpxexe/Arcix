// electron/main.ts
import { app, BrowserWindow, ipcMain, desktopCapturer, globalShortcut, clipboard, screen } from 'electron';
import * as path from 'path';
import * as fs from 'fs';
import * as os from 'os';
import { spawn, ChildProcessWithoutNullStreams } from 'child_process';

let mainWindow: BrowserWindow | null = null;
let overlayWindow: BrowserWindow | null = null;
let callPopoverWindow: BrowserWindow | null = null;
let inputInjectorProcess: ChildProcessWithoutNullStreams | null = null;
let inputInjectorReady = false;

const LOGS_DIR = path.join(app.getPath('userData'), 'logs');
const AUDIT_LOG_FILE = path.join(LOGS_DIR, 'audit.jsonl');

// Ensure log directory exists
if (!fs.existsSync(LOGS_DIR)) {
  fs.mkdirSync(LOGS_DIR, { recursive: true });
}

function startNativeInputInjector() {
  const possiblePaths = [
    path.join(__dirname, '..', 'native-input', 'InputInjector.exe'),
    path.join(process.cwd(), 'native-input', 'InputInjector.exe'),
    path.join(__dirname, 'native-input', 'InputInjector.exe'),
    path.join(process.resourcesPath, 'native-input', 'InputInjector.exe'),
    path.join(process.resourcesPath, 'app.asar.unpacked', 'native-input', 'InputInjector.exe'),
    path.join(app.getAppPath(), 'native-input', 'InputInjector.exe')
  ];

  const exePath = possiblePaths.find(p => fs.existsSync(p));
  if (!exePath) {
    console.warn('[InputInjector] Executable not found. Native input injection will be disabled until compiled.');
    return;
  }

  try {
    inputInjectorProcess = spawn(exePath);
    console.log(`[InputInjector] Started native process: ${exePath}`);

    inputInjectorProcess.stdout.on('data', (data) => {
      const line = data.toString().trim();
      if (line.includes('"status":"ready"')) {
        inputInjectorReady = true;
        console.log('[InputInjector] Native input injection service is ready');
      }
    });

    inputInjectorProcess.stderr.on('data', (err) => {
      console.error(`[InputInjector Error] ${err.toString()}`);
    });

    inputInjectorProcess.on('exit', (code) => {
      console.log(`[InputInjector] Exited with code ${code}`);
      inputInjectorReady = false;
      inputInjectorProcess = null;
    });
  } catch (err: any) {
    console.error(`[InputInjector] Failed to launch: ${err.message}`);
  }
}

function sendCommandToInjector(cmd: any): Promise<{ status: string; message?: string }> {
  return new Promise((resolve) => {
    if (!inputInjectorProcess || !inputInjectorReady) {
      return resolve({ status: 'unavailable', message: 'Native input injector is not running' });
    }

    const payload = JSON.stringify(cmd) + '\n';
    try {
      inputInjectorProcess.stdin.write(payload, 'utf8', (err) => {
        if (err) {
          resolve({ status: 'error', message: err.message });
        } else {
          resolve({ status: 'ok' });
        }
      });
    } catch (err: any) {
      resolve({ status: 'error', message: err.message });
    }
  });
}

function createMainWindow() {
  mainWindow = new BrowserWindow({
    width: 1200,
    height: 800,
    minWidth: 920,
    minHeight: 640,
    frame: false, // Frameless for rich custom AnyDesk titlebar
    backgroundColor: '#0d1117',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false
    }
  });

  const devUrl = process.env.VITE_DEV_SERVER_URL || 'http://localhost:5173';
  if (process.env.NODE_ENV === 'development' && !app.isPackaged) {
    mainWindow.loadURL(devUrl).catch(() => {
      setTimeout(() => mainWindow?.loadURL(devUrl), 1000);
    });
  } else {
    const distPath = path.join(app.getAppPath(), 'dist', 'index.html');
    if (fs.existsSync(distPath)) {
      mainWindow.loadFile(distPath);
    } else {
      mainWindow.loadFile(path.join(__dirname, '..', 'dist', 'index.html'));
    }
  }

  mainWindow.on('closed', () => {
    mainWindow = null;
    if (overlayWindow) {
      overlayWindow.close();
      overlayWindow = null;
    }
    if (callPopoverWindow) {
      callPopoverWindow.close();
      callPopoverWindow = null;
    }
  });
}

function createHostOverlayWindow(info: { peerId: string; peerName: string; permissions: any }) {
  if (overlayWindow) {
    overlayWindow.close();
  }

  const primaryDisplay = screen.getPrimaryDisplay();
  const { width, height } = primaryDisplay.workAreaSize;
  const overlayWidth = 480;
  const overlayHeight = 64;
  const x = Math.max(0, width - overlayWidth - 24);
  const y = Math.max(0, height - overlayHeight - 24);

  // Floating banner on bottom-right of host screen above taskbar
  overlayWindow = new BrowserWindow({
    width: overlayWidth,
    height: overlayHeight,
    x,
    y,
    frame: false,
    transparent: true,
    alwaysOnTop: true,
    skipTaskbar: true,
    resizable: false,
    focusable: false,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false
    }
  });

  const html = `
    <!DOCTYPE html>
    <html>
    <head>
      <meta charset="utf-8">
      <style>
        body {
          margin: 0;
          font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
          background: rgba(15, 23, 42, 0.92);
          backdrop-filter: blur(12px);
          border: 1px solid rgba(239, 68, 68, 0.4);
          border-radius: 12px;
          color: white;
          display: flex;
          align-items: center;
          justify-content: space-between;
          padding: 0 16px;
          height: 62px;
          box-shadow: 0 10px 25px -5px rgba(0, 0, 0, 0.5), 0 0 15px rgba(239, 68, 68, 0.2);
          user-select: none;
        }
        .info {
          display: flex;
          align-items: center;
          gap: 10px;
        }
        .dot {
          width: 10px;
          height: 10px;
          border-radius: 50%;
          background: #ef4444;
          box-shadow: 0 0 8px #ef4444;
          animation: pulse 1.5s infinite;
        }
        @keyframes pulse {
          0%, 100% { opacity: 1; transform: scale(1); }
          50% { opacity: 0.5; transform: scale(0.85); }
        }
        .text {
          font-size: 13px;
        }
        .text strong {
          color: #f87171;
        }
        .actions {
          display: flex;
          gap: 8px;
        }
        button {
          padding: 6px 12px;
          font-size: 12px;
          font-weight: 600;
          border-radius: 6px;
          cursor: pointer;
          border: none;
          transition: all 0.15s ease;
        }
        .btn-revoke {
          background: #334155;
          color: #e2e8f0;
        }
        .btn-revoke:hover {
          background: #475569;
        }
        .btn-disconnect {
          background: #dc2626;
          color: white;
        }
        .btn-disconnect:hover {
          background: #b91c1c;
        }
      </style>
    </head>
    <body>
      <div class="info">
        <div class="dot"></div>
        <div class="text">
          Active Remote Session: <strong>${info.peerId}</strong> (${info.peerName || 'Remote'})
        </div>
      </div>
      <div class="actions">
        <button class="btn-revoke" onclick="window.aeroDeskApi.onEmergencyRevoke()">Revoke Control</button>
        <button class="btn-disconnect" onclick="window.aeroDeskApi.onHostDisconnect()">Disconnect</button>
      </div>
    </body>
    </html>
  `;

  overlayWindow.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(html)}`);
}

function createIncomingCallPopoverWindow(callData: { callerId: string; callerName: string; requestedPermissions: any }) {
  if (callPopoverWindow) {
    callPopoverWindow.close();
    callPopoverWindow = null;
  }

  // Restore and focus main window when call arrives, flash taskbar
  if (mainWindow) {
    if (mainWindow.isMinimized()) {
      mainWindow.restore();
    }
    mainWindow.show();
    mainWindow.focus();
    mainWindow.flashFrame(true);
  }

  const primaryDisplay = screen.getPrimaryDisplay();
  const { width, height } = primaryDisplay.workAreaSize;
  const popoverWidth = 460;
  const popoverHeight = 310;
  const x = Math.round((width - popoverWidth) / 2);
  const y = Math.round((height - popoverHeight) / 3);

  callPopoverWindow = new BrowserWindow({
    width: popoverWidth,
    height: popoverHeight,
    x,
    y,
    frame: false,
    transparent: true,
    alwaysOnTop: true,
    resizable: false,
    skipTaskbar: false,
    title: 'AeroDesk - Incoming Connection Request',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false
    }
  });

  const perms = callData.requestedPermissions || {};
  const permsHtml = `
    <div style="display:flex; flex-wrap:wrap; gap:6px; margin: 12px 0;">
      <span style="font-size:11px; padding:3px 8px; border-radius:4px; background:rgba(6,182,212,0.15); color:#38bdf8; border:1px solid rgba(6,182,212,0.3)">Screen Viewing</span>
      <span style="font-size:11px; padding:3px 8px; border-radius:4px; background:${perms.input ? 'rgba(16,185,129,0.15)' : 'rgba(255,255,255,0.05)'}; color:${perms.input ? '#10b981' : '#94a3b8'}; border:1px solid ${perms.input ? 'rgba(16,185,129,0.3)' : 'rgba(255,255,255,0.1)'}">Input Control: ${perms.input ? 'Requested' : 'No'}</span>
      <span style="font-size:11px; padding:3px 8px; border-radius:4px; background:${perms.clipboard ? 'rgba(16,185,129,0.15)' : 'rgba(255,255,255,0.05)'}; color:${perms.clipboard ? '#10b981' : '#94a3b8'}; border:1px solid ${perms.clipboard ? 'rgba(16,185,129,0.3)' : 'rgba(255,255,255,0.1)'}">Clipboard: ${perms.clipboard ? 'Requested' : 'No'}</span>
      <span style="font-size:11px; padding:3px 8px; border-radius:4px; background:${perms.fileTransfer ? 'rgba(16,185,129,0.15)' : 'rgba(255,255,255,0.05)'}; color:${perms.fileTransfer ? '#10b981' : '#94a3b8'}; border:1px solid ${perms.fileTransfer ? 'rgba(16,185,129,0.3)' : 'rgba(255,255,255,0.1)'}">Files: ${perms.fileTransfer ? 'Requested' : 'No'}</span>
    </div>
  `;

  const html = `
    <!DOCTYPE html>
    <html>
    <head>
      <meta charset="utf-8">
      <style>
        * { box-sizing: border-box; }
        body {
          margin: 0;
          padding: 20px;
          font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
          background: rgba(15, 23, 42, 0.96);
          backdrop-filter: blur(24px);
          border: 1px solid rgba(6, 182, 212, 0.4);
          border-radius: 16px;
          color: white;
          height: 100vh;
          display: flex;
          flex-direction: column;
          justify-content: space-between;
          box-shadow: 0 25px 60px rgba(0, 0, 0, 0.8), 0 0 35px rgba(6, 182, 212, 0.25);
          user-select: none;
        }
        .header {
          display: flex;
          align-items: center;
          justify-content: space-between;
          border-bottom: 1px solid rgba(255, 255, 255, 0.08);
          padding-bottom: 12px;
        }
        .brand {
          display: flex;
          align-items: center;
          gap: 8px;
          font-size: 13px;
          font-weight: 700;
          letter-spacing: 0.05em;
          color: #38bdf8;
        }
        .pulse {
          width: 8px;
          height: 8px;
          border-radius: 50%;
          background: #f59e0b;
          box-shadow: 0 0 10px #f59e0b;
          animation: pulse 1.2s infinite;
        }
        @keyframes pulse {
          0%, 100% { opacity: 1; transform: scale(1); }
          50% { opacity: 0.4; transform: scale(0.8); }
        }
        .close-btn {
          background: transparent;
          border: none;
          color: #94a3b8;
          font-size: 16px;
          cursor: pointer;
          padding: 2px 6px;
          border-radius: 4px;
        }
        .close-btn:hover { color: white; background: rgba(255, 255, 255, 0.1); }
        .body-content {
          padding: 6px 0;
        }
        .title {
          font-size: 16px;
          font-weight: 700;
          color: #fff;
          margin: 0 0 4px 0;
        }
        .subtitle {
          font-size: 12px;
          color: #94a3b8;
          margin: 0 0 10px 0;
        }
        .peer-box {
          background: rgba(7, 9, 14, 0.6);
          border: 1px solid rgba(255, 255, 255, 0.08);
          border-radius: 10px;
          padding: 10px 14px;
          display: flex;
          align-items: center;
          justify-content: space-between;
        }
        .peer-id {
          font-size: 17px;
          font-weight: 700;
          color: #38bdf8;
          font-family: monospace;
        }
        .peer-name {
          font-size: 12px;
          color: #cbd5e1;
        }
        .actions {
          display: flex;
          gap: 12px;
          margin-top: 12px;
        }
        button.action-btn {
          flex: 1;
          padding: 11px 16px;
          font-size: 13px;
          font-weight: 600;
          border-radius: 8px;
          cursor: pointer;
          border: none;
          transition: all 0.15s ease;
        }
        .btn-accept {
          background: linear-gradient(135deg, #10b981 0%, #059669 100%);
          color: white;
          box-shadow: 0 4px 15px rgba(16, 185, 129, 0.3);
        }
        .btn-accept:hover {
          filter: brightness(1.1);
          transform: translateY(-1px);
        }
        .btn-reject {
          background: rgba(239, 68, 68, 0.15);
          color: #f87171;
          border: 1px solid rgba(239, 68, 68, 0.3) !important;
        }
        .btn-reject:hover {
          background: rgba(239, 68, 68, 0.25);
        }
      </style>
    </head>
    <body>
      <div class="header">
        <div class="brand">
          <div class="pulse"></div>
          <span>AERODESK APPROVAL</span>
        </div>
        <button class="close-btn" onclick="window.aeroDeskApi.respondFromPopover(false)">✕</button>
      </div>

      <div class="body-content">
        <h3 class="title">Incoming Connection Request</h3>
        <p class="subtitle">A remote operator wants to connect to this computer:</p>

        <div class="peer-box">
          <div>
            <div class="peer-name">${callData.callerName || 'Remote Device'}</div>
            <div style="font-size: 11px; color: #64748b;">AeroDesk ID</div>
          </div>
          <div class="peer-id">${callData.callerId}</div>
        </div>

        ${permsHtml}
      </div>

      <div class="actions">
        <button class="action-btn btn-reject" onclick="window.aeroDeskApi.respondFromPopover(false)">
          Decline
        </button>
        <button class="action-btn btn-accept" onclick="window.aeroDeskApi.respondFromPopover(true)">
          Accept & Connect
        </button>
      </div>
    </body>
    </html>
  `;

  callPopoverWindow.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(html)}`);
}

// IPC Handlers
ipcMain.handle('incoming-call:notify', (_event, callData) => {
  createIncomingCallPopoverWindow(callData);
  return true;
});

ipcMain.handle('incoming-call:close-popover', () => {
  if (callPopoverWindow) {
    callPopoverWindow.close();
    callPopoverWindow = null;
  }
  return true;
});

ipcMain.handle('incoming-call:popover-response', (_event, accepted: boolean, permissions?: any) => {
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send('session:popover-decision', { accepted, permissions });
  }
  if (callPopoverWindow) {
    callPopoverWindow.close();
    callPopoverWindow = null;
  }
  return true;
});
ipcMain.handle('desktop-capturer:get-sources', async () => {
  const sources = await desktopCapturer.getSources({
    types: ['screen', 'window'],
    thumbnailSize: { width: 320, height: 180 },
    fetchWindowIcons: true
  });

  return sources.map(s => ({
    id: s.id,
    name: s.name,
    thumbnail: s.thumbnail.toDataURL(),
    display_id: s.display_id
  }));
});

ipcMain.handle('native-input:inject', async (_event, cmd) => {
  return await sendCommandToInjector(cmd);
});

ipcMain.handle('native-input:status', () => {
  return {
    available: !!inputInjectorProcess,
    ready: inputInjectorReady
  };
});

ipcMain.handle('host-overlay:show', (_event, info) => {
  createHostOverlayWindow(info);
  return true;
});

ipcMain.handle('host-overlay:hide', () => {
  if (overlayWindow) {
    overlayWindow.close();
    overlayWindow = null;
  }
  return true;
});

ipcMain.handle('clipboard:read-text', () => {
  return clipboard.readText();
});

ipcMain.handle('clipboard:write-text', (_event, text: string) => {
  clipboard.writeText(text);
  return true;
});

ipcMain.handle('audit-log:append', (_event, entry) => {
  try {
    const line = JSON.stringify(entry) + '\n';
    fs.appendFileSync(AUDIT_LOG_FILE, line, 'utf8');
    return true;
  } catch (err) {
    console.error('[Audit Log] Failed to append entry:', err);
    return false;
  }
});

ipcMain.handle('audit-log:get', (_event, limit = 50) => {
  try {
    if (!fs.existsSync(AUDIT_LOG_FILE)) return [];
    const content = fs.readFileSync(AUDIT_LOG_FILE, 'utf8');
    const lines = content.trim().split('\n').filter(Boolean);
    const records = lines.slice(-limit).map(l => JSON.parse(l)).reverse();
    return records;
  } catch (err) {
    console.error('[Audit Log] Failed to read entries:', err);
    return [];
  }
});

ipcMain.handle('system:get-info', () => {
  return {
    platform: os.platform(),
    hostname: os.hostname(),
    arch: os.arch()
  };
});

// Window controls
ipcMain.on('window:minimize', () => mainWindow?.minimize());
ipcMain.on('window:maximize', () => {
  if (mainWindow?.isMaximized()) {
    mainWindow.unmaximize();
  } else {
    mainWindow?.maximize();
  }
});
ipcMain.on('window:close', () => mainWindow?.close());

app.whenReady().then(() => {
  startNativeInputInjector();
  createMainWindow();

  // Register Global Emergency Disconnect Shortcut (Ctrl+Alt+Shift+Escape)
  globalShortcut.register('CommandOrControl+Alt+Shift+Escape', () => {
    console.log('[Emergency Disconnect] Global shortcut triggered!');
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('session:emergency-revoke');
      mainWindow.webContents.send('session:host-disconnect');
    }
  });

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createMainWindow();
    }
  });
});

app.on('will-quit', () => {
  globalShortcut.unregisterAll();
  if (inputInjectorProcess) {
    try {
      inputInjectorProcess.stdin.write('exit\n');
      inputInjectorProcess.kill();
    } catch (_) {}
  }
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});
