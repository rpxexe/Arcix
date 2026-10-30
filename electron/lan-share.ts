// electron/lan-share.ts
// Read-only LAN folder sharing: the chosen folder is served over HTTP and announced by UDP broadcast;
// other AeroDesk instances on the same network discover it and can browse/download its files.
import { app, dialog, ipcMain } from 'electron';
import * as http from 'http';
import * as dgram from 'dgram';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import * as crypto from 'crypto';
import { Readable } from 'stream';
import { pipeline } from 'stream/promises';

const DISCOVERY_PORT = 47801;
const ANNOUNCE_MS = 3000;
const PEER_TTL_MS = 10000;
const instanceId = crypto.randomUUID();

let sharedDir: string | null = null;
let server: http.Server | null = null;
let announceTimer: NodeJS.Timeout | null = null;
const peers = new Map<string, { id: string; name: string; folder: string; host: string; port: number; lastSeen: number }>();

// Resolves a client-supplied relative path inside root; null if it escapes (.., absolute paths, symlinks out)
export function resolveInside(root: string, rel: string): string | null {
  const target = path.resolve(root, '.' + path.sep + String(rel || ''));
  try {
    const real = fs.realpathSync(target);
    const relative = path.relative(fs.realpathSync(root), real);
    return relative.startsWith('..') || path.isAbsolute(relative) ? null : real;
  } catch {
    return null;
  }
}

// Remote-supplied file name -> unique path in Downloads (no path parts or reserved characters)
export function downloadTarget(fileName: string): string {
  const safe = path.basename(String(fileName)).replace(/[<>:"/\\|?*\x00-\x1f]/g, '_').replace(/^\.+/, '') || 'received-file';
  const dir = app.getPath('downloads');
  const ext = path.extname(safe);
  let target = path.join(dir, safe);
  for (let i = 1; fs.existsSync(target); i++) target = path.join(dir, `${path.basename(safe, ext)} (${i})${ext}`);
  return target;
}

function handleRequest(req: http.IncomingMessage, res: http.ServerResponse) {
  const url = new URL(req.url || '/', 'http://x');
  const target = sharedDir && resolveInside(sharedDir, url.searchParams.get('path') || '');
  if (req.method !== 'GET' || !target) {
    res.writeHead(404).end();
    return;
  }
  try {
    const stat = fs.statSync(target);
    if (url.pathname === '/list' && stat.isDirectory()) {
      const entries = fs.readdirSync(target, { withFileTypes: true }).flatMap((e) => {
        try {
          const s = fs.statSync(path.join(target, e.name));
          return [{ name: e.name, dir: s.isDirectory(), size: s.size }];
        } catch {
          return []; // unreadable entry (locked/system file)
        }
      });
      res.writeHead(200, { 'Content-Type': 'application/json' }).end(JSON.stringify(entries));
    } else if (url.pathname === '/file' && stat.isFile()) {
      res.writeHead(200, { 'Content-Type': 'application/octet-stream', 'Content-Length': stat.size });
      fs.createReadStream(target).on('error', () => res.destroy()).pipe(res);
    } else {
      res.writeHead(404).end();
    }
  } catch {
    res.writeHead(500).end();
  }
}

// Directed broadcast address of every non-internal IPv4 interface
function broadcastAddresses(): string[] {
  return Object.values(os.networkInterfaces()).flat()
    .filter((i): i is os.NetworkInterfaceInfo => !!i && i.family === 'IPv4' && !i.internal)
    .map((i) => {
      const mask = i.netmask.split('.').map(Number);
      return i.address.split('.').map((o, k) => (Number(o) | (~mask[k] & 255))).join('.');
    });
}

function startSharing(dir: string, socket: dgram.Socket) {
  stopSharing();
  sharedDir = dir;
  server = http.createServer(handleRequest);
  server.listen(0, () => {
    const port = (server!.address() as { port: number }).port;
    const msg = Buffer.from(JSON.stringify({ app: 'aerodesk-share', id: instanceId, name: os.hostname(), folder: path.basename(dir) || dir, port }));
    const announce = () => broadcastAddresses().forEach((addr) => socket.send(msg, DISCOVERY_PORT, addr, () => {}));
    announce();
    announceTimer = setInterval(announce, ANNOUNCE_MS);
  });
}

function stopSharing() {
  if (announceTimer) clearInterval(announceTimer);
  announceTimer = null;
  server?.close();
  server = null;
  sharedDir = null;
}

function getPeer(id: string) {
  const peer = peers.get(id);
  if (!peer || Date.now() - peer.lastSeen > PEER_TTL_MS) throw new Error('That PC is no longer sharing');
  return peer;
}

export function setupLanShare() {
  const socket = dgram.createSocket({ type: 'udp4', reuseAddr: true });
  socket.on('error', (err) => console.error('[LAN Share] Discovery socket error:', err.message));
  socket.on('message', (buf, rinfo) => {
    try {
      const m = JSON.parse(buf.toString());
      if (m.app !== 'aerodesk-share' || m.id === instanceId || !Number.isInteger(m.port)) return;
      peers.set(m.id, { id: m.id, name: String(m.name), folder: String(m.folder), host: rinfo.address, port: m.port, lastSeen: Date.now() });
    } catch {
      // not ours
    }
  });
  socket.bind(DISCOVERY_PORT, () => socket.setBroadcast(true));

  ipcMain.handle('lan-share:pick-folder', async () => {
    const result = await dialog.showOpenDialog({ properties: ['openDirectory'] });
    if (result.canceled || !result.filePaths[0]) return sharedDir;
    startSharing(result.filePaths[0], socket);
    return sharedDir;
  });

  ipcMain.handle('lan-share:stop', () => {
    stopSharing();
    return true;
  });

  ipcMain.handle('lan-share:status', () => sharedDir);

  ipcMain.handle('lan-share:peers', () => {
    const now = Date.now();
    return [...peers.values()].filter((p) => now - p.lastSeen <= PEER_TTL_MS).map(({ id, name, folder, host }) => ({ id, name, folder, host }));
  });

  // Peer is looked up by id so the renderer can only reach discovered peers, never arbitrary URLs
  ipcMain.handle('lan-share:list', async (_event, peerId: string, rel: string) => {
    const peer = getPeer(peerId);
    const res = await fetch(`http://${peer.host}:${peer.port}/list?path=${encodeURIComponent(rel)}`);
    if (!res.ok) throw new Error(`Folder not available (${res.status})`);
    return res.json();
  });

  ipcMain.handle('lan-share:download', async (_event, peerId: string, rel: string) => {
    const peer = getPeer(peerId);
    const res = await fetch(`http://${peer.host}:${peer.port}/file?path=${encodeURIComponent(rel)}`);
    if (!res.ok || !res.body) throw new Error(`File not available (${res.status})`);
    const target = downloadTarget(rel.split('/').pop() || '');
    try {
      await pipeline(Readable.fromWeb(res.body as any), fs.createWriteStream(target, { flags: 'wx' }));
    } catch (err) {
      fs.rmSync(target, { force: true }); // don't leave a truncated file behind
      throw err;
    }
    return target;
  });

  app.on('will-quit', () => {
    stopSharing();
    socket.close();
  });
}
