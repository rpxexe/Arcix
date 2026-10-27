// electron/main.ts
import { app, BrowserWindow, ipcMain, desktopCapturer, globalShortcut, clipboard, screen } from 'electron';
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
      sandbox: false,
      // Host keeps streaming and answering while minimized or behind other windows
      backgroundThrottling: false
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
  });
}

// Remote-supplied strings (device names/IDs) go into data: URL HTML in windows that have the preload API
const escapeHtml = (s: unknown) => String(s ?? '').replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);

const OVERLAY_EXPANDED = { width: 520, height: 64 };
const OVERLAY_COLLAPSED = { width: 52, height: 52 };

// Anchor the overlay to the bottom-right of the primary work area (above the taskbar)
function overlayBounds(size: { width: number; height: number }) {
  const area = screen.getPrimaryDisplay().workArea;
  return { ...size, x: area.x + area.width - size.width - 24, y: area.y + area.height - size.height - 24 };
}

function createHostOverlayWindow(info: { peerId: string; peerName: string; permissions: any }) {
  if (overlayWindow) {
    overlayWindow.close();
  }

  // Floating banner on bottom-right of host screen above taskbar; collapsible to a pulsing dot
  overlayWindow = new BrowserWindow({
    ...overlayBounds(OVERLAY_EXPANDED),
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
        html, body { margin: 0; height: 100%; background: transparent; overflow: hidden; }
        body {
          font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
          color: white;
          user-select: none;
        }
        .panel {
          box-sizing: border-box;
          height: 62px;
          background: rgba(15, 23, 42, 0.92);
          border: 1px solid rgba(239, 68, 68, 0.4);
          border-radius: 12px;
          display: flex;
          align-items: center;
          justify-content: space-between;
          gap: 10px;
          padding: 0 12px 0 16px;
        }
        .info { display: flex; align-items: center; gap: 10px; min-width: 0; }
        .dot {
          flex: none;
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
        .text { font-size: 13px; display: flex; align-items: baseline; gap: 8px; min-width: 0; white-space: nowrap; }
        .text strong { color: #f87171; flex: none; font-variant-numeric: tabular-nums; }
        .text .name { color: #cbd5e1; overflow: hidden; text-overflow: ellipsis; min-width: 0; }
        .actions { display: flex; gap: 8px; flex: none; }
        button {
          padding: 6px 12px;
          font-size: 12px;
          font-weight: 600;
          border-radius: 6px;
          cursor: pointer;
          border: none;
          transition: background 0.15s ease;
        }
        button:focus-visible { outline: 2px solid #38bdf8; outline-offset: 2px; }
        .btn-revoke { background: #334155; color: #e2e8f0; }
        .btn-revoke:hover { background: #475569; }
        .btn-disconnect { background: #dc2626; color: white; }
        .btn-disconnect:hover { background: #b91c1c; }
        .btn-collapse { background: transparent; color: #94a3b8; padding: 6px 8px; font-size: 14px; line-height: 1; }
        .btn-collapse:hover { background: #334155; color: #fff; }
        .pill {
          display: none;
          box-sizing: border-box;
          width: 50px;
          height: 50px;
          border-radius: 50%;
          background: rgba(15, 23, 42, 0.92);
          border: 1px solid rgba(239, 68, 68, 0.5);
          align-items: center;
          justify-content: center;
          padding: 0;
        }
        .pill .dot { width: 14px; height: 14px; }
        body.collapsed .panel { display: none; }
        body.collapsed .pill { display: flex; }
      </style>
    </head>
    <body>
      <div class="panel">
        <div class="info">
          <div class="dot"></div>
          <div class="text" title="Active remote session: ${escapeHtml(info.peerId)} (${escapeHtml(info.peerName || 'Remote')})">
            <strong>${escapeHtml(info.peerId)}</strong>
            <span class="name">${escapeHtml(info.peerName || 'Remote')}</span>
          </div>
        </div>
        <div class="actions">
          <button class="btn-revoke" onclick="window.aeroDeskApi.hostOverlayAction('revoke')">Revoke Control</button>
          <button class="btn-disconnect" onclick="window.aeroDeskApi.hostOverlayAction('disconnect')">Disconnect</button>
          <button class="btn-collapse" title="Collapse" aria-label="Collapse session banner" onclick="document.body.classList.add('collapsed'); window.aeroDeskApi.hostOverlayAction('collapse')">&#8212;</button>
        </div>
      </div>
      <button class="pill" title="Active remote session: ${escapeHtml(info.peerId)} — click to expand" aria-label="Expand session banner" onclick="window.aeroDeskApi.hostOverlayAction('expand'); document.body.classList.remove('collapsed')"><span class="dot"></span></button>
    </body>
    </html>
  `;

  overlayWindow.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(html)}`);
}

// IPC Handlers
// Incoming call: one approval dialog only (in-app, with permission toggles). Bring the main
// window to the front and keep it on top until the call is answered, so it can't be missed.
ipcMain.handle('incoming-call:notify', () => {
  if (mainWindow && !mainWindow.isDestroyed()) {
    if (mainWindow.isMinimized()) mainWindow.restore();
    mainWindow.setAlwaysOnTop(true);
    mainWindow.show();
    mainWindow.focus();
    mainWindow.flashFrame(true);
  }
  return true;
});

ipcMain.handle('incoming-call:clear-alert', () => {
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.setAlwaysOnTop(false);
    mainWindow.flashFrame(false);
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

ipcMain.on('host-overlay:action', (_event, action: string) => {
  if (action === 'revoke') mainWindow?.webContents.send('session:emergency-revoke');
  else if (action === 'disconnect') mainWindow?.webContents.send('session:host-disconnect');
  else if (action === 'collapse') overlayWindow?.setBounds(overlayBounds(OVERLAY_COLLAPSED));
  else if (action === 'expand') overlayWindow?.setBounds(overlayBounds(OVERLAY_EXPANDED));
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

ipcMain.handle('file:save-received', (_event, fileName: string, data: Uint8Array) => {
  // Name comes from the remote peer: strip any path and reserved characters before touching disk
  const safe = path.basename(String(fileName)).replace(/[<>:"/\\|?*\x00-\x1f]/g, '_').replace(/^\.+/, '') || 'received-file';
  if (data.byteLength > 100 * 1024 * 1024) throw new Error('File exceeds 100 MB limit');
  const dir = app.getPath('downloads');
  const ext = path.extname(safe);
  let target = path.join(dir, safe);
  for (let i = 1; fs.existsSync(target); i++) target = path.join(dir, `${path.basename(safe, ext)} (${i})${ext}`);
  fs.writeFileSync(target, data, { flag: 'wx' });
  return target;
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
    release: os.release(),
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
