// tests/signaling-reconnect.test.js
// Regression: a device that reconnected must stay callable when its old socket closes late.
const assert = require('assert');
const WebSocket = require('ws');
const { SignalingServer } = require('../server/signaling-server');

const open = (url) => new Promise((resolve, reject) => {
  const ws = new WebSocket(url);
  const inbox = [];
  ws.on('message', (m) => inbox.push(JSON.parse(m.toString())));
  ws.next = (type) => new Promise((res, rej) => {
    const timer = setTimeout(() => rej(new Error(`timed out waiting for ${type}`)), 3000);
    const check = () => {
      const i = inbox.findIndex((m) => m.type === type);
      if (i === -1) return setTimeout(check, 10);
      clearTimeout(timer);
      res(inbox.splice(i, 1)[0]);
    };
    check();
  });
  ws.on('open', () => resolve(ws));
  ws.on('error', reject);
});

(async () => {
  const server = new SignalingServer(0);
  await server.start();
  const url = `ws://127.0.0.1:${server.httpServer.address().port}`;

  // Host registers, then reconnects on a second socket with the same ID and token
  const first = await open(url);
  first.send(JSON.stringify({ type: 'register', deviceName: 'Host' }));
  const { deviceId, token } = await first.next('registered');
  const second = await open(url);
  second.send(JSON.stringify({ type: 'register', deviceId, token, deviceName: 'Host' }));
  assert.strictEqual((await second.next('registered')).restored, true);

  // The old socket closes after the reconnect (server terminates it; a late network close behaves the same)
  first.terminate();
  await new Promise((r) => (first.readyState === WebSocket.CLOSED ? r() : first.on('close', r)));
  await new Promise((r) => setTimeout(r, 50));

  const caller = await open(url);
  caller.send(JSON.stringify({ type: 'register', deviceName: 'Caller' }));
  const callerId = (await caller.next('registered')).deviceId;
  caller.send(JSON.stringify({ type: 'call_request', fromId: callerId, targetId: deviceId }));
  const call = await second.next('incoming_call');
  assert.strictEqual(call.callerId, callerId);

  [second, caller].forEach((ws) => ws.close());
  await server.stop();
  console.log('[PASS] reconnected device stays callable after its old socket closes');
})().catch((err) => {
  console.error('[FAIL]', err.message);
  process.exit(1);
});
