// electron/main.ts
import { app, BrowserWindow, ipcMain, desktopCapturer, globalShortcut, clipboard, screen, Menu } from 'electron';
import * as path from 'path';
import * as fs from 'fs';
import * as os from 'os';
import * as crypto from 'crypto';
import { spawn, ChildProcessWithoutNullStreams } from 'child_process';
import { setupLanShare, downloadTarget } from './lan-share';

// Renamed from AeroDesk: keep the old profile folder (device ID, saved sessions, unattended password, logs).
// Must run before anything reads userData. Windows paths are case-insensitive, so this covers dev and packaged.
const legacyUserData = path.join(app.getPath('appData'), 'AeroDesk');
if (fs.existsSync(legacyUserData)) app.setPath('userData', legacyUserData);

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

    // Output is newline-delimited JSON; a chunk can hold several lines or end mid-line
    let pending = '';
    inputInjectorProcess.stdout.on('data', (data) => {
      const lines = (pending + data.toString()).split('\n');
      pending = lines.pop() || '';
      for (const line of lines) {
        if (line.includes('"status":"ready"')) {
          inputInjectorReady = true;
          console.log('[InputInjector] Native input injection service is ready');
        } else if (line.includes('"event":"key"')) {
          // System shortcut (Win, Alt+Tab, ...) captured by the keyboard hook while a viewer session is focused
          try {
            mainWindow?.webContents.send('native-input:captured-key', JSON.parse(line));
          } catch (_) {}
        }
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

const DEV_ICON = path.join(__dirname, '..', 'build', 'icon.ico');

function createMainWindow() {
  mainWindow = new BrowserWindow({
    width: 1200,
    height: 800,
    minWidth: 920,
    minHeight: 640,
    frame: false, // Frameless for rich custom AnyDesk titlebar
    backgroundColor: '#0d1117',
    // Taskbar icon in dev; a packaged build uses the icon electron-builder embeds from build/icon.ico
    icon: fs.existsSync(DEV_ICON) ? DEV_ICON : undefined,
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

  // A file dropped outside a drop zone would navigate the app to it and drop the session
  mainWindow.webContents.on('will-navigate', (event) => event.preventDefault());

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
const OVERLAY_WITH_TRANSFER = { width: 520, height: 122 };
const OVERLAY_COLLAPSED = { width: 52, height: 52 };

// Overlay state: a transfer pops a collapsed banner open, and it folds back once the message is gone
let overlayCollapsed = false;
let overlayAutoExpanded = false;
let overlayTransfer: unknown = null;

function refreshOverlay() {
  if (!overlayWindow || overlayWindow.isDestroyed()) return;
  overlayWindow.setBounds(overlayBounds(overlayCollapsed ? OVERLAY_COLLAPSED : overlayTransfer ? OVERLAY_WITH_TRANSFER : OVERLAY_EXPANDED));
  overlayWindow.webContents.send('host-overlay:transfer', { transfer: overlayTransfer, collapsed: overlayCollapsed });
}

// Anchor the overlay to the bottom-right of the primary work area (above the taskbar)
function overlayBounds(size: { width: number; height: number }) {
  const area = screen.getPrimaryDisplay().workArea;
  return { ...size, x: area.x + area.width - size.width - 24, y: area.y + area.height - size.height - 24 };
}

function createHostOverlayWindow(info: { peerId: string; peerName: string; permissions: any }) {
  if (overlayWindow) {
    overlayWindow.close();
  }
  overlayCollapsed = false;
  overlayAutoExpanded = false;
  overlayTransfer = null;

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
        .transfer {
          display: none;
          box-sizing: border-box;
          margin-top: 6px;
          height: 52px;
          padding: 8px 14px;
          background: rgba(15, 23, 42, 0.92);
          border: 1px solid rgba(6, 182, 212, 0.4);
          border-radius: 12px;
          font-size: 12px;
        }
        body.has-transfer:not(.collapsed) .transfer { display: block; }
        .t-row { display: flex; gap: 10px; align-items: baseline; white-space: nowrap; }
        .t-title { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; font-weight: 600; }
        .t-pct { flex: none; font-variant-numeric: tabular-nums; color: #22d3ee; font-weight: 600; }
        .t-bar { height: 4px; margin: 5px 0 4px; background: rgba(255, 255, 255, 0.12); border-radius: 2px; overflow: hidden; }
        .t-fill { height: 100%; width: 0; background: #06b6d4; transition: width 0.15s linear; }
        .t-detail { color: #94a3b8; font-size: 11px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
        .transfer.done .t-fill { background: #10b981; }
        .transfer.done .t-pct { color: #10b981; }
        .transfer.error .t-fill { background: #f43f5e; }
        .transfer.error .t-pct { color: #f43f5e; }
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
      <div class="transfer" role="status" aria-live="polite">
        <div class="t-row"><span class="t-title"></span><span class="t-pct"></span></div>
        <div class="t-bar"><div class="t-fill"></div></div>
        <div class="t-detail"></div>
      </div>
      <script>
        // File names come from the remote peer: only ever assigned through textContent
        const box = document.querySelector('.transfer');
        window.aeroDeskApi.onHostOverlayTransfer(({ transfer, collapsed }) => {
          document.body.classList.toggle('collapsed', collapsed);
          document.body.classList.toggle('has-transfer', !!transfer);
          if (!transfer) return;
          box.className = 'transfer ' + (transfer.status === 'done' ? 'done' : transfer.status === 'error' || transfer.status === 'cancelled' ? 'error' : '');
          box.querySelector('.t-title').textContent = transfer.title;
          box.querySelector('.t-title').title = transfer.title;
          box.querySelector('.t-pct').textContent = transfer.status === 'done' ? '\\u2713' : transfer.percent + '%';
          box.querySelector('.t-fill').style.width = transfer.percent + '%';
          box.querySelector('.t-detail').textContent = transfer.detail;
          box.querySelector('.t-detail').title = transfer.detail;
        });
      </script>
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
  else if (action === 'collapse' || action === 'expand') {
    overlayCollapsed = action === 'collapse';
    overlayAutoExpanded = false; // the user chose; don't fold it back on them
    refreshOverlay();
  }
});

// Current file transfer for the banner (null clears it)
ipcMain.on('host-overlay:transfer', (_event, transfer: unknown) => {
  if (transfer && !overlayTransfer && overlayCollapsed) {
    overlayCollapsed = false;
    overlayAutoExpanded = true;
  } else if (!transfer && overlayAutoExpanded) {
    overlayCollapsed = true;
    overlayAutoExpanded = false;
  }
  overlayTransfer = transfer || null;
  refreshOverlay();
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

// Received files stream into a .part file in Downloads and are renamed only once complete,
// so an interrupted transfer never leaves a truncated file under the real name
const receivingFiles = new Map<string, { fileName: string; partPath: string; handle: fs.promises.FileHandle }>();

ipcMain.handle('file:receive-start', async (_event, fileName: string) => {
  const id = crypto.randomUUID();
  // Name comes from the remote peer: downloadTarget strips any path and reserved characters
  const partPath = `${downloadTarget(fileName)}.${id.slice(0, 8)}.part`;
  receivingFiles.set(id, { fileName, partPath, handle: await fs.promises.open(partPath, 'wx') });
  return id;
});

ipcMain.handle('file:receive-chunk', async (_event, id: string, data: Uint8Array) => {
  const file = receivingFiles.get(id);
  if (!file) throw new Error('Transfer was cancelled');
  await file.handle.write(data);
});

ipcMain.handle('file:receive-finish', async (_event, id: string) => {
  const file = receivingFiles.get(id);
  if (!file) throw new Error('Transfer was cancelled');
  receivingFiles.delete(id);
  await file.handle.close();
  const target = downloadTarget(file.fileName);
  await fs.promises.rename(file.partPath, target);
  return target;
});

async function abortReceive(id: string) {
  const file = receivingFiles.get(id);
  if (!file) return;
  receivingFiles.delete(id);
  await file.handle.close().catch(() => {});
  await fs.promises.rm(file.partPath, { force: true });
}

ipcMain.handle('file:receive-abort', (_event, id: string) => abortReceive(id));

// Viewer session focus: let the injector's keyboard hook capture Win/Alt+Tab/etc. for this window only
ipcMain.handle('native-input:key-capture', (_event, enabled: boolean) => {
  return sendCommandToInjector({ action: 'key_capture', enabled: !!enabled, pid: process.pid });
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
  // The default menu's hidden accelerators (Ctrl+R reload, Ctrl+W close, Ctrl+Shift+I, zoom...) would fire
  // locally instead of reaching the remote PC, reloading or closing the app mid-session
  Menu.setApplicationMenu(null);
  startNativeInputInjector();
  setupLanShare();
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
  receivingFiles.forEach((_file, id) => abortReceive(id));
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
