// tests/e2e-electron.js — real-app E2E: signaling server + 2 Electron instances (host, viewer) driven over CDP.
// Requires a built app (npm run build) and an interactive desktop (screen capture). Uses the real clipboard (restored) and Downloads folder (cleaned up).
const path = require('path');
const fs = require('fs');
const os = require('os');
const http = require('http');
const { spawn } = require('child_process');
const ROOT = path.join(__dirname, '..');
const WebSocket = require(path.join(ROOT, 'node_modules', 'ws'));
const ELECTRON = path.join(ROOT, 'node_modules', 'electron', 'dist', 'electron.exe');
const PORT = 7071;
const SIG = `ws://localhost:${PORT}`;

delete process.env.ELECTRON_RUN_AS_NODE;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const procs = [];
let pass = 0, fail = 0;
const check = (cond, msg) => { cond ? pass++ : fail++; console.log(`  [${cond ? 'PASS' : 'FAIL'}] ${msg}`); };

const getJson = (url) => new Promise((res, rej) => http.get(url, (r) => { let d = ''; r.on('data', (c) => d += c); r.on('end', () => { try { res(JSON.parse(d)); } catch (e) { rej(e); } }); }).on('error', rej));

async function attach(port, match = (t) => /index\.html/.test(t.url)) {
  let target;
  for (let i = 0; i < 60 && !target; i++) {
    try { target = (await getJson(`http://127.0.0.1:${port}/json`)).find((t) => t.type === 'page' && match(t)); } catch {}
    if (!target) await sleep(500);
  }
  if (!target) throw new Error('no page target on ' + port);
  const ws = new WebSocket(target.webSocketDebuggerUrl);
  await new Promise((r) => ws.once('open', r));
  let id = 0; const pending = new Map();
  ws.on('message', (raw) => { const m = JSON.parse(raw); if (m.method === 'Runtime.consoleAPICalled' && /WebRTC|DataChannel|Error|error/.test(JSON.stringify(m.params.args))) console.log(`    [${port}] ${m.params.args.map((a) => a.value ?? a.description).join(' ').slice(0, 200)}`); if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); } });
  const send = (method, params = {}) => new Promise((r) => { const i = ++id; pending.set(i, r); ws.send(JSON.stringify({ id: i, method, params })); });
  const ev = async (expr) => {
    const r = await send('Runtime.evaluate', { expression: expr, awaitPromise: true, returnByValue: true });
    if (r.result?.exceptionDetails) throw new Error(r.result.exceptionDetails.exception?.description || 'eval error');
    return r.result?.result?.value;
  };
  if (process.env.E2E_CONSOLE) send('Runtime.enable');
  const until = async (expr, ms = 15000) => { const t = Date.now(); while (Date.now() - t < ms) { try { if (await ev(expr)) return true; } catch {} await sleep(250); } return false; };
  const helpers = async () => ev(`(() => {
    window.__alerts = window.__alerts || [];
    window.alert = (m) => window.__alerts.push(String(m));
    window.__set = (sel, v) => { const el = document.querySelector(sel); Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(el, v); el.dispatchEvent(new Event('input', { bubbles: true })); };
    window.__btn = (text) => [...document.querySelectorAll('button')].find((b) => b.textContent.includes(text));
    window.__modalSeen = false;
    if (!window.__pcs) { const O = RTCPeerConnection; window.__pcs = []; window.RTCPeerConnection = function (...a) { const p = new O(...a); window.__pcs.push(p); return p; }; window.RTCPeerConnection.prototype = O.prototype; }
    new MutationObserver(() => { if (document.querySelector('#incoming-call-modal')) window.__modalSeen = true; }).observe(document.body, { childList: true, subtree: true });
    return true; })()`);
  const setFile = async (selector, filePath) => {
    const { result: { root } } = await send('DOM.getDocument');
    const { result: { nodeId } } = await send('DOM.querySelector', { nodeId: root.nodeId, selector });
    await send('DOM.setFileInputFiles', { nodeId, files: [filePath] });
  };
  return { ev, until, helpers, setFile, close: () => ws.close() };
}

function launch(name, dbgPort) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), `aerodesk-${name}-`));
  const p = spawn(ELECTRON, ['.', `--remote-debugging-port=${dbgPort}`, `--user-data-dir=${dir}`], { cwd: ROOT, env: { ...process.env, NODE_ENV: 'production' } });
  p.stdout.on('data', (d) => process.env.E2E_VERBOSE && process.stdout.write(`[${name}] ${d}`));
  p.stderr.on('data', (d) => process.env.E2E_VERBOSE && process.stdout.write(`[${name}!] ${d}`));
  procs.push(p);
}

async function setup(app, deviceName) {
  await app.until('document.readyState === "complete"');
  await app.ev(`localStorage.setItem('aerodesk_signaling_url', '${SIG}'); localStorage.setItem('aerodesk_device_name', ${JSON.stringify(deviceName)}); location.reload(); true`);
  await sleep(1500);
  await app.until('document.readyState === "complete"');
  await app.helpers();
}

const myId = (app) => app.ev(`document.querySelector('#this-device-id-display')?.textContent.replace(/\\D/g, '')`);
const onDashboard = '!!document.querySelector("#remote-device-id-input")';
const viewerHasVideo = '(() => { const v = document.querySelector("#remote-desktop-video"); return !!v && v.videoWidth > 0; })()';
const hostInSession = '!!(document.querySelector("#host-disconnect-btn") || document.querySelector("#host-session-card-collapsed"))';

async function dial(viewer, id, password = '') {
  await viewer.ev(`__set('#remote-device-id-input', '${id}'); __set('#remote-password-input', ${JSON.stringify(password)}); true`);
  await sleep(100);
  await viewer.ev(`document.querySelector('#connect-remote-btn').click(); true`);
}

async function setUnattended(host, enabled, password) {
  await host.ev(`document.querySelector('#dashboard-settings-btn').click(); true`);
  await host.until('!!document.querySelector("#settings-modal")', 5000);
  await host.ev(`(() => {
    const cb = [...document.querySelectorAll('#settings-modal label')].find((l) => l.textContent.includes('Unattended')).querySelector('input');
    if (cb.checked !== ${enabled}) cb.click();
    return true; })()`);
  await sleep(200);
  if (password) await host.ev(`__set('input[placeholder="Enter access passphrase"]', ${JSON.stringify(password)}); true`);
  await sleep(100);
  await host.ev(`__btn('Save Preferences').click(); true`);
  await sleep(1500); // PBKDF2 210k iterations
  await host.ev(`document.querySelector('#close-settings-btn').click(); true`);
  await sleep(300);
}

// Read (or with x, y: set) the real OS cursor position, in primary-screen coordinates
const CURSOR_PS1 = path.join(os.tmpdir(), 'aerodesk-e2e-cursor.ps1');
fs.writeFileSync(CURSOR_PS1, [
  'param([int]$x = -1, [int]$y = -1)',
  'Add-Type -AssemblyName System.Windows.Forms, System.Drawing',
  'if ($x -ge 0) { [Windows.Forms.Cursor]::Position = New-Object Drawing.Point($x, $y) }',
  '$p = [Windows.Forms.Cursor]::Position; $b = [Windows.Forms.Screen]::PrimaryScreen.Bounds',
  '"$($p.X) $($p.Y) $($b.Width) $($b.Height)"'
].join('\n'));
const cursor = (...set) => {
  const out = require('child_process').execFileSync('powershell', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', CURSOR_PS1, ...set.map(String)]).toString();
  const [x, y, w, h] = out.trim().split(' ').map(Number);
  return { x, y, w, h };
};
const near = (c, fx, fy) => Math.abs(c.x / c.w - fx) < 0.03 && Math.abs(c.y / c.h - fy) < 0.03;

// Hover the viewer's video at a fraction of the rendered (letterboxed) picture
const hover = (viewer, fx, fy) => viewer.ev(`(() => {
  const v = document.querySelector('#remote-desktop-video'); const r = v.getBoundingClientRect();
  const s = Math.min(r.width / v.videoWidth, r.height / v.videoHeight);
  const ox = (r.width - v.videoWidth * s) / 2, oy = (r.height - v.videoHeight * s) / 2;
  v.dispatchEvent(new MouseEvent('mousemove', { bubbles: true, clientX: r.left + ox + ${fx} * v.videoWidth * s, clientY: r.top + oy + ${fy} * v.videoHeight * s }));
  return true; })()`);

const isOverlay = (t) => t.url.startsWith('data:') && decodeURIComponent(t.url).includes('btn-revoke');

async function resetFlags(...apps) { for (const a of apps) await a.ev('window.__modalSeen = false; window.__alerts = []; true'); }

async function main() {
  const server = spawn(process.execPath, ['server/index.js'], { cwd: ROOT, env: { ...process.env, PORT: String(PORT) } });
  procs.push(server);
  await sleep(1000);
  launch('host', 9301);
  launch('viewer', 9302);
  const host = await attach(9301);
  const viewer = await attach(9302);
  // Viewer's device name is markup: host windows must render it as text
  await setup(host, 'E2E Host'); await setup(viewer, '<b id="injected">Evil</b> Viewer');

  console.log('\n--- 1. Registration ---');
  check(await host.until(`/^\\d{9}$/.test(document.querySelector('#this-device-id-display')?.textContent.replace(/\\D/g, '') || '')`), 'host registered with 9-digit ID');
  check(await viewer.until(`/^\\d{9}$/.test(document.querySelector('#this-device-id-display')?.textContent.replace(/\\D/g, '') || '')`), 'viewer registered with 9-digit ID');
  const hostId = await myId(host), viewerId = await myId(viewer);
  check(hostId !== viewerId, `IDs are distinct (${hostId} vs ${viewerId})`);

  console.log('\n--- 2. Call offline ID ---');
  await dial(viewer, hostId === '111111111' ? '222222222' : '111111111');
  check(await viewer.until(`__alerts.some((a) => /offline/i.test(a))`, 5000), 'viewer told target is offline');
  check(await viewer.until(`!document.querySelector('#connect-remote-btn').textContent.includes('Calling')`, 3000), 'connect button resets after failure');

  console.log('\n--- 3. Attended call, host rejects ---');
  await resetFlags(host, viewer);
  await dial(viewer, hostId);
  check(await host.until('!!document.querySelector("#incoming-call-modal")'), 'host shows approval prompt');
  await sleep(800);
  const hostPages = (await getJson('http://127.0.0.1:9301/json')).filter((t) => t.type === 'page');
  check(hostPages.length === 1, `exactly one approval dialog (host has ${hostPages.length} window(s))`);
  await host.ev(`document.querySelector('#reject-call-btn').click(); true`);
  check(await viewer.until(`__alerts.some((a) => /rejected/i.test(a))`, 5000), 'viewer told call was rejected');
  check(await host.until('!document.querySelector("#incoming-call-modal")', 3000), 'host prompt dismissed');

  console.log('\n--- 3b. Caller cancels while ringing ---');
  await resetFlags(host, viewer);
  await dial(viewer, hostId);
  check(await host.until('!!document.querySelector("#incoming-call-modal")'), 'host shows approval prompt');
  check(await viewer.until('!!document.querySelector("#cancel-call-btn")', 3000), 'viewer sees Cancel while ringing');
  await viewer.ev(`document.querySelector('#cancel-call-btn').click(); true`);
  check(await host.until('!document.querySelector("#incoming-call-modal")', 5000), 'host prompt dismissed when caller cancels');
  check(await viewer.until('!!document.querySelector("#connect-remote-btn")', 3000), 'viewer back to Connect button');
  check(!(await viewer.ev('__alerts.length')), 'no error alert shown on cancel');

  console.log('\n--- 4. Attended call, host accepts, screen streams ---');
  await resetFlags(host, viewer);
  await dial(viewer, hostId);
  check(await host.until('!!document.querySelector("#incoming-call-modal")'), 'host shows approval prompt');
  await host.ev(`document.querySelector('#accept-call-btn').click(); true`);
  check(await host.until(hostInSession), 'host enters session view');
  check(await viewer.until(viewerHasVideo, 20000), 'viewer receives live screen video');
  check(await host.until(`/[^s]connected$/i.test(document.querySelector('#app-titlebar').textContent.trim())`, 5000), 'host title bar shows Connected during session');
  check(await host.until(`/[1-9]\\d* FPS/.test(document.body.innerText)`, 8000), 'host telemetry shows real FPS');
  console.log('\n--- 4a. Latency tuning ---');
  check(await viewer.ev(`__pcs.at(-1).getReceivers().find((r) => r.track.kind === 'video').jitterBufferTarget === 0`), 'viewer jitter buffer target is 0 (show frames immediately)');
  check(await host.until(`__pcs.at(-1)?.getSenders().find((s) => s.track?.kind === 'video')?.getParameters().degradationPreference === 'maintain-framerate'`, 5000), 'host keeps frame rate under pressure (balanced preset)');
  // A/B in one session: average time frames sit in the jitter buffer, browser default vs our 0 target
  const jitterMs = (target) => viewer.ev(`(async () => {
    const pc = __pcs.at(-1); pc.getReceivers().find((r) => r.track.kind === 'video').jitterBufferTarget = ${target};
    const read = async () => [...(await pc.getStats()).values()].find((x) => x.type === 'inbound-rtp' && x.kind === 'video');
    await new Promise((r) => setTimeout(r, 1500));
    const a = await read(); await new Promise((r) => setTimeout(r, 3000)); const b = await read();
    return Math.round(((b.jitterBufferDelay - a.jitterBufferDelay) / (b.jitterBufferEmittedCount - a.jitterBufferEmittedCount)) * 1000);
  })()`);
  const jbDefault = await jitterMs('null'), jbZero = await jitterMs(0);
  console.log(`    avg jitter-buffer delay: browser default ${jbDefault} ms -> tuned ${jbZero} ms`);
  check(jbZero <= jbDefault + 2, 'tuned jitter buffer is not slower than default');
  const overlay4 = await attach(9301, isOverlay);
  check(await overlay4.ev('!document.querySelector("#injected") && document.body.textContent.includes("<b id")'), 'overlay renders hostile device name as text');
  overlay4.close();
  check(await viewer.until('!!document.querySelector("#sync-clipboard-btn")', 3000), 'clipboard control available');
  const savedClip = await viewer.ev('aeroDeskApi.readClipboard()');
  await viewer.ev(`aeroDeskApi.writeClipboard(''); true`);
  await viewer.ev(`document.querySelector('#sync-clipboard-btn').click(); true`);
  check(await viewer.until(`document.querySelector('#sync-clipboard-btn').textContent.includes('empty')`, 3000), 'empty clipboard reports "empty"');
  await sleep(2200);
  await viewer.ev(`aeroDeskApi.writeClipboard('aerodesk-e2e-clip'); true`);
  await viewer.ev(`document.querySelector('#sync-clipboard-btn').click(); true`);
  check(await viewer.until(`document.querySelector('#sync-clipboard-btn').textContent.includes('synced')`, 3000), 'clipboard text synced to host');
  await viewer.ev(`aeroDeskApi.writeClipboard(${JSON.stringify(savedClip || '')}); true`);

  console.log('\n--- 4b. File transfer viewer -> host ---');
  const fileName = `aerodesk-e2e-${Date.now()}.bin`;
  const srcFile = path.join(os.tmpdir(), fileName);
  const payload = require('crypto').randomBytes(3 * 1024 * 1024 + 123); // multi-chunk, exercises backpressure
  fs.writeFileSync(srcFile, payload);
  const downloads = path.join(os.homedir(), 'Downloads');
  await viewer.ev(`document.querySelector('#open-file-transfer-btn').click(); true`);
  await viewer.until('!!document.querySelector("#file-transfer-input")', 3000);
  await viewer.setFile('#file-transfer-input', srcFile);
  await viewer.until('!document.querySelector("#start-upload-btn")?.disabled', 3000);
  await viewer.ev(`document.querySelector('#start-upload-btn').click(); true`);
  const savedFile = path.join(downloads, fileName);
  let arrived = false;
  const t0 = Date.now();
  let sentAt = 0, firstSeen = 0;
  for (let i = 0; i < 480 && !arrived; i++) { if (!sentAt && await viewer.ev(`document.querySelector("#file-transfer-modal")?.innerText.includes("100%")`)) sentAt = Date.now() - t0; if (!firstSeen && fs.existsSync(savedFile)) firstSeen = Date.now() - t0; arrived = fs.existsSync(savedFile) && fs.statSync(savedFile).size === payload.length; if (!arrived) await sleep(250); }
  console.log(`    sender 100% at ${sentAt} ms, file first seen at ${firstSeen} ms`);
  console.log(`    transfer took ${Date.now() - t0} ms`);
  if (!arrived) console.log('    modal:', await viewer.ev(`document.querySelector('#file-transfer-modal')?.innerText.replace(/\\s+/g, ' ')`), '| exists:', fs.existsSync(savedFile));
  check(arrived && fs.readFileSync(savedFile).equals(payload), 'host saved byte-identical file to Downloads');
  try { fs.unlinkSync(savedFile); } catch {} fs.unlinkSync(srcFile);
  await viewer.ev(`document.querySelector('#close-file-transfer-btn')?.click(); true`);

  console.log('\n--- 4c. Hostile file name is contained ---');
  const evilPath = await host.ev(`aeroDeskApi.saveReceivedFile('..\\\\..\\\\aerodesk-evil.txt', new Uint8Array([1,2,3]))`);
  check(path.dirname(evilPath) === downloads && !evilPath.includes('..'), `traversal name saved inside Downloads (${path.basename(evilPath)})`);
  try { fs.unlinkSync(evilPath); } catch {}

  console.log('\n--- 4d. Third party calling a busy host ---');
  const busy = await new Promise((resolve) => {
    const c = new WebSocket(SIG);
    c.on('message', (raw) => {
      const m = JSON.parse(raw);
      if (m.type === 'welcome') c.send(JSON.stringify({ type: 'register', deviceName: 'intruder' }));
      if (m.type === 'registered') c.send(JSON.stringify({ type: 'call_request', fromId: m.deviceId, targetId: hostId, requestedPermissions: { view: true } }));
      if (m.type === 'call_failed') { c.close(); resolve(m.reason); }
    });
    setTimeout(() => { c.close(); resolve(null); }, 5000);
  });
  check(/busy/i.test(busy || ''), `busy host refuses second caller (${busy})`);

  await viewer.ev(`document.querySelector('#disconnect-session-btn').click(); true`);
  check(await viewer.until(onDashboard, 5000), 'viewer returns to dashboard after disconnect');
  check(await host.until(onDashboard, 5000), 'host returns to dashboard when viewer disconnects');

  console.log('\n--- 5. Unattended: wrong password falls back to prompt ---');
  await setUnattended(host, true, 'Secr3t-pass!');
  const stored = await host.ev('JSON.stringify(localStorage)');
  check(!stored.includes('Secr3t-pass!') && !stored.includes(Buffer.from('Secr3t-pass!').toString('base64')), 'password not stored in plaintext or base64');
  check(stored.includes('aerodesk_unattended_pbkdf2'), 'salted hash stored');
  await resetFlags(host, viewer);
  await dial(viewer, hostId, 'wrong-password');
  check(await host.until('!!document.querySelector("#incoming-call-modal")'), 'wrong password -> host shows prompt');
  await host.ev(`document.querySelector('#reject-call-btn').click(); true`);
  await viewer.until(`__alerts.some((a) => /rejected/i.test(a))`, 5000);

  console.log('\n--- 6. Unattended: correct password auto-accepts ---');
  await resetFlags(host, viewer);
  await dial(viewer, hostId, 'Secr3t-pass!');
  check(await host.until(hostInSession), 'host enters session automatically');
  check(!(await host.ev('window.__modalSeen')), 'no approval prompt was shown');
  check(await viewer.until(viewerHasVideo, 20000), 'viewer receives live screen video');
  check(!(await viewer.ev(`document.querySelector('#remote-password-input')?.value || ''`)), 'viewer password field cleared');

  console.log('\n--- 6b. Remote mouse input (moves only; cursor restored) ---');
  check(await viewer.ev(`getComputedStyle(document.querySelector('#remote-desktop-video')).cursor`) === 'none', 'local cursor hidden over remote screen while controlling (single cursor)');
  const origCursor = cursor();
  // Same machine: the injected real cursor lands on the viewer window and would feed back as a native mousemove.
  // pointer-events:none blocks native events only; our synthetic dispatches still reach the handler.
  await viewer.ev(`document.querySelector('#remote-desktop-video').style.pointerEvents = 'none'; true`);
  await hover(viewer, 0.1, 0.1); await sleep(400);
  const c1 = cursor();
  check(near(c1, 0.1, 0.1), `cursor lands at 10%,10% of host screen (${c1.x},${c1.y} of ${c1.w}x${c1.h})`);
  await hover(viewer, 0.9, 0.8); await sleep(400);
  const c2 = cursor();
  check(near(c2, 0.9, 0.8), `cursor lands at 90%,80% of host screen (${c2.x},${c2.y})`);

  console.log('\n--- 6c. Host overlay: collapse, expand, revoke, disconnect ---');
  const ov = await attach(9301, isOverlay);
  check(await ov.ev('window.outerWidth') > 400, 'overlay starts expanded');
  await ov.ev(`document.querySelector('.btn-collapse').click(); true`);
  check(await ov.until('window.outerWidth < 80', 3000), 'collapse shrinks overlay to a dot');
  check(await ov.ev('getComputedStyle(document.querySelector(".pill")).display !== "none"'), 'collapsed dot is visible');
  await ov.ev(`document.querySelector('.pill').click(); true`);
  check(await ov.until('window.outerWidth > 400', 3000), 'clicking the dot expands overlay');
  await ov.ev(`document.querySelector('.btn-revoke').click(); true`);
  await sleep(500);
  await hover(viewer, 0.5, 0.5); await sleep(500);
  const c3 = cursor();
  check(Math.abs(c3.x - c2.x) < 3 && Math.abs(c3.y - c2.y) < 3, 'after Revoke Control the viewer can no longer move the cursor');
  cursor(origCursor.x, origCursor.y);
  await ov.ev(`document.querySelector('.btn-disconnect').click(); true`);
  ov.close();
  check(await host.until(onDashboard, 5000), 'overlay Disconnect ends session on host');
  check(await viewer.until(onDashboard, 5000), 'viewer returns to dashboard when host disconnects');

  console.log('\n--- 7. Unattended disabled: correct password still needs prompt ---');
  await setUnattended(host, false);
  await resetFlags(host, viewer);
  await dial(viewer, hostId, 'Secr3t-pass!');
  check(await host.until('!!document.querySelector("#incoming-call-modal")'), 'disabled -> host shows prompt');
  await host.ev(`document.querySelector('#reject-call-btn').click(); true`);
  check(await viewer.until(`__alerts.some((a) => /rejected/i.test(a))`, 5000), 'viewer told call was rejected');

  console.log('\n--- 8. Recent sessions recorded ---');
  check(await viewer.until(`document.body.textContent.includes('Recent Sessions (1)')`, 3000), 'viewer lists host in recent sessions');

  host.close(); viewer.close();
}

main()
  .catch((e) => { fail++; console.error('E2E crashed:', e.message); })
  .finally(() => {
    console.log(`\n${fail ? 'FAILED' : 'ALL PASSED'}: ${pass} passed, ${fail} failed`);
    procs.forEach((p) => { try { spawn('taskkill', ['/pid', String(p.pid), '/T', '/F']); } catch {} });
    setTimeout(() => process.exit(fail ? 1 : 0), 1500);
  });
