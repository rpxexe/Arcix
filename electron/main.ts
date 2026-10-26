// electron/main.ts
import { app, BrowserWindow, ipcMain, desktopCapturer, globalShortcut, clipboard } from 'electron';
import * as path from 'path';
import * as fs from 'fs';
import * as os from 'os';
import { spawn, ChildProcessWithoutNullStreams } from 'child_process';

let mainWindow: BrowserWindow | null = null;
let overlayWindow: BrowserWindow | null = null;
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
    path.join(__dirname, 'native-input', 'InputInjector.exe')
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
  if (process.env.NODE_ENV === 'development' || !app.isPackaged) {
    mainWindow.loadURL(devUrl).catch(() => {
      setTimeout(() => mainWindow?.loadURL(devUrl), 1000);
    });
  } else {
    mainWindow.loadFile(path.join(__dirname, '..', 'dist', 'index.html'));
  }

  mainWindow.on('closed', () => {
    mainWindow = null;
    if (overlayWindow) {
      overlayWindow.close();
      overlayWindow = null;
    }
  });
}

function createHostOverlayWindow(info: { peerId: string; peerName: string; permissions: any }) {
  if (overlayWindow) {
    overlayWindow.close();
  }

  // Floating top banner on host screen
  overlayWindow = new BrowserWindow({
    width: 480,
    height: 64,
    x: 40,
    y: 20,
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

// IPC Handlers
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
