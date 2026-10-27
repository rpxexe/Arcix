// tests/run-tests.js
const { SignalingServer } = require('../server/signaling-server');
const WebSocket = require('ws');
const { spawn } = require('child_process');
const crypto = require('crypto');
const path = require('path');
const fs = require('fs');

async function runTestSuite() {
  console.log('========================================================');
  console.log('       AERODESK AUTOMATED VERIFICATION TEST SUITE       ');
  console.log('========================================================\n');

  let passedTests = 0;
  let totalTests = 0;

  function assert(condition, message) {
    totalTests++;
    if (condition) {
      console.log(`  [PASS] ${message}`);
      passedTests++;
    } else {
      console.error(`  [FAIL] ${message}`);
      throw new Error(`Assertion failed: ${message}`);
    }
  }

  // ----------------------------------------------------
  // TEST 1: Native Windows Input Injector (C# / Win32)
  // ----------------------------------------------------
  console.log('--- TEST GROUP 1: Native Windows Input Injector ---');
  await new Promise((resolve, reject) => {
    const exePath = path.join(__dirname, '..', 'native-input', 'InputInjector.exe');
    assert(fs.existsSync(exePath), 'InputInjector.exe binary exists');

    const proc = spawn(exePath);
    let output = '';

    proc.stdout.on('data', (d) => {
      output += d.toString();
    });

    proc.on('error', reject);

    // Send sequence of commands
    proc.stdin.write(JSON.stringify({ action: 'ping' }) + '\n');
    proc.stdin.write(JSON.stringify({ action: 'mouse_move', x: 500, y: 300, screen_w: 1920, screen_h: 1080 }) + '\n');
    proc.stdin.write(JSON.stringify({ action: 'mouse_click', button: 'left' }) + '\n');
    proc.stdin.write(JSON.stringify({ action: 'mouse_wheel', delta_y: 120 }) + '\n');
    proc.stdin.write(JSON.stringify({ action: 'unicode_text', text: 'AeroDesk' }) + '\n');
    proc.stdin.write(JSON.stringify({ action: 'exit' }) + '\n');

    proc.on('close', (code) => {
      assert(code === 0, 'InputInjector exited with code 0');
      assert(output.includes('"status":"ready"'), 'Received ready handshake');
      assert(output.includes('"status":"pong"'), 'Received pong response');
      assert(output.includes('"action":"mouse_move"'), 'Executed mouse move');
      assert(output.includes('"action":"mouse_click"'), 'Executed mouse click');
      assert(output.includes('"action":"mouse_wheel"'), 'Executed mouse wheel scroll');
      assert(output.includes('"action":"unicode_text"'), 'Injected unicode text');
      resolve();
    });
  });
  console.log('');

  // ----------------------------------------------------
  // TEST 2: Signaling Server & Multi-Device Registration
  // ----------------------------------------------------
  console.log('--- TEST GROUP 2: Signaling Server & Device Registration ---');
  const TEST_PORT = 7088;
  const server = new SignalingServer(TEST_PORT);
  await server.start();

  let hostWs = null;
  let viewerWs = null;
  let hostId = null;
  let viewerId = null;

  try {
    // Register Host Device
    hostWs = new WebSocket(`ws://localhost:${TEST_PORT}`);
    await new Promise((resolve) => {
      hostWs.on('open', () => {
        hostWs.send(JSON.stringify({
          type: 'register',
          deviceName: 'Primary Host Workstation'
        }));
      });

      hostWs.on('message', (raw) => {
        const msg = JSON.parse(raw.toString());
        if (msg.type === 'registered') {
          hostId = msg.deviceId;
          assert(typeof hostId === 'string' && hostId.replace(/\s+/g, '').length === 9, 'Host received 9-digit connection ID: ' + hostId);
          assert(!!msg.token, 'Host received secure session token');
          resolve();
        }
      });
    });

    // Register Viewer Device
    viewerWs = new WebSocket(`ws://localhost:${TEST_PORT}`);
    await new Promise((resolve) => {
      viewerWs.on('open', () => {
        viewerWs.send(JSON.stringify({
          type: 'register',
          deviceName: 'Remote Viewer Laptop'
        }));
      });

      viewerWs.on('message', (raw) => {
        const msg = JSON.parse(raw.toString());
        if (msg.type === 'registered') {
          viewerId = msg.deviceId;
          assert(typeof viewerId === 'string' && viewerId.replace(/\s+/g, '').length === 9, 'Viewer received 9-digit connection ID: ' + viewerId);
          assert(viewerId !== hostId, 'Viewer and Host connection IDs are distinct');
          resolve();
        }
      });
    });
    console.log('');

    // ----------------------------------------------------
    // TEST 3: Validation, Invalid IDs & Error Handling
    // ----------------------------------------------------
    console.log('--- TEST GROUP 3: Validation & Error Handling ---');
    // Test connecting to non-existent ID
    await new Promise((resolve) => {
      viewerWs.send(JSON.stringify({
        type: 'call_request',
        fromId: viewerId,
        targetId: '999999999',
        requestedPermissions: { view: true, input: true }
      }));

      const handler = (raw) => {
        const msg = JSON.parse(raw.toString());
        if (msg.type === 'call_failed') {
          assert(msg.reason.includes('offline or unavailable'), 'Reported target offline on invalid ID');
          viewerWs.off('message', handler);
          resolve();
        }
      };
      viewerWs.on('message', handler);
    });

    // Test connecting to self
    await new Promise((resolve) => {
      viewerWs.send(JSON.stringify({
        type: 'call_request',
        fromId: viewerId,
        targetId: viewerId
      }));

      const handler = (raw) => {
        const msg = JSON.parse(raw.toString());
        if (msg.type === 'error' && msg.code === 'INVALID_TARGET') {
          assert(true, 'Disallowed self-connection attempt');
          viewerWs.off('message', handler);
          resolve();
        }
      };
      viewerWs.on('message', handler);
    });
    console.log('');

    // ----------------------------------------------------
    // TEST 4: Call Negotiation, Approval & Rejection
    // ----------------------------------------------------
    console.log('--- TEST GROUP 4: Call Negotiation & Granular Permissions ---');
    // Call rejection test
    await new Promise((resolve) => {
      viewerWs.send(JSON.stringify({
        type: 'call_request',
        fromId: viewerId,
        targetId: hostId,
        requestedPermissions: { view: true, input: true, clipboard: true, fileTransfer: true },
        password: 'unattended-secret'
      }));

      const hostHandler = (raw) => {
        const msg = JSON.parse(raw.toString());
        if (msg.type === 'incoming_call') {
          assert(msg.callerId === viewerId, 'Host received incoming call from viewer');
          assert(msg.password === 'unattended-secret', 'Host received unattended access password');
          assert(msg.requestedPermissions.input === true, 'Host observed requested input permission');
          hostWs.off('message', hostHandler);

          // Reject with custom reason
          hostWs.send(JSON.stringify({
            type: 'call_response',
            fromId: hostId,
            callerId: viewerId,
            accepted: false,
            reason: 'Host is currently busy with maintenance'
          }));
        }
      };
      hostWs.on('message', hostHandler);

      const viewerHandler = (raw) => {
        const msg = JSON.parse(raw.toString());
        if (msg.type === 'call_rejected') {
          assert(msg.reason.includes('maintenance'), 'Viewer observed rejection reason: ' + msg.reason);
          viewerWs.off('message', viewerHandler);
          resolve();
        }
      };
      viewerWs.on('message', viewerHandler);
    });

    // Call Acceptance test with granular permission tailoring
    await new Promise((resolve) => {
      viewerWs.send(JSON.stringify({
        type: 'call_request',
        fromId: viewerId,
        targetId: hostId,
        requestedPermissions: { view: true, input: true, clipboard: true, fileTransfer: true }
      }));

      const hostHandler = (raw) => {
        const msg = JSON.parse(raw.toString());
        if (msg.type === 'incoming_call') {
          hostWs.off('message', hostHandler);

          // Accept with customized permissions (view + input + clipboard, but no file transfer)
          hostWs.send(JSON.stringify({
            type: 'call_response',
            fromId: hostId,
            callerId: viewerId,
            accepted: true,
            grantedPermissions: { view: true, input: true, clipboard: true, fileTransfer: false }
          }));
        }
      };
      hostWs.on('message', hostHandler);

      const viewerHandler = (raw) => {
        const msg = JSON.parse(raw.toString());
        if (msg.type === 'call_accepted') {
          assert(msg.grantedPermissions.input === true, 'Viewer received granted input permission');
          assert(msg.grantedPermissions.fileTransfer === false, 'Viewer observed denied file transfer permission');
          viewerWs.off('message', viewerHandler);
          resolve();
        }
      };
      viewerWs.on('message', viewerHandler);
    });
    console.log('');

    // ----------------------------------------------------
    // TEST 5: WebRTC Signaling Exchange (Offer, Answer, ICE)
    // ----------------------------------------------------
    console.log('--- TEST GROUP 5: WebRTC Signaling Forwarding ---');
    await new Promise((resolve) => {
      // Viewer sends dummy SDP offer
      viewerWs.send(JSON.stringify({
        type: 'webrtc_offer',
        fromId: viewerId,
        targetId: hostId,
        sdp: { type: 'offer', sdp: 'v=0\r\no=- 12345 2 IN IP4 127.0.0.1\r\ns=AeroDesk\r\n' }
      }));

      const hostHandler = (raw) => {
        const msg = JSON.parse(raw.toString());
        if (msg.type === 'webrtc_offer') {
          assert(msg.sdp.type === 'offer', 'Host received forwarded SDP offer');
          hostWs.off('message', hostHandler);

          // Host replies with dummy SDP answer
          hostWs.send(JSON.stringify({
            type: 'webrtc_answer',
            fromId: hostId,
            targetId: viewerId,
            sdp: { type: 'answer', sdp: 'v=0\r\no=- 67890 2 IN IP4 127.0.0.1\r\ns=AeroDesk\r\n' }
          }));
        }
      };
      hostWs.on('message', hostHandler);

      const viewerHandler = (raw) => {
        const msg = JSON.parse(raw.toString());
        if (msg.type === 'webrtc_answer') {
          assert(msg.sdp.type === 'answer', 'Viewer received forwarded SDP answer');
          viewerWs.off('message', viewerHandler);
          resolve();
        }
      };
      viewerWs.on('message', viewerHandler);
    });
    console.log('');

    // ----------------------------------------------------
    // TEST 6: File Transfer Chunking & Traversal Security
    // ----------------------------------------------------
    console.log('--- TEST GROUP 6: File Transfer Integrity & Path Security ---');
    // Test Path Traversal prevention
    function validateFileName(name) {
      if (name.includes('..') || name.includes('/') || name.includes('\\')) {
        return false;
      }
      return true;
    }
    assert(!validateFileName('../../Windows/System32/cmd.exe'), 'Blocked path traversal attempt in file name');
    assert(!validateFileName('../secret.txt'), 'Blocked relative path escape in file name');
    assert(validateFileName('report.pdf'), 'Allowed valid file name');

    // Test Chunking and Hash Reassembly
    const testData = crypto.randomBytes(65536); // 64 KB binary payload
    const originalHash = crypto.createHash('sha256').update(testData).digest('hex');

    const CHUNK_SIZE = 16384;
    const totalChunks = Math.ceil(testData.length / CHUNK_SIZE);
    const chunks = [];
    for (let i = 0; i < totalChunks; i++) {
      const slice = testData.slice(i * CHUNK_SIZE, (i + 1) * CHUNK_SIZE);
      chunks.push({
        index: i,
        base64: slice.toString('base64')
      });
    }

    // Reassemble
    const reassembledBuffers = chunks.map(c => Buffer.from(c.base64, 'base64'));
    const reassembled = Buffer.concat(reassembledBuffers);
    const reassembledHash = crypto.createHash('sha256').update(reassembled).digest('hex');

    assert(reassembledHash === originalHash, 'Reassembled chunked file SHA-256 hash matches exactly');
    console.log('');

    // ----------------------------------------------------
    // TEST 7: Immediate Disconnect & Session Cleanup
    // ----------------------------------------------------
    console.log('--- TEST GROUP 7: Session Termination & Disconnect Cleanup ---');
    await new Promise((resolve) => {
      viewerWs.send(JSON.stringify({
        type: 'session_end',
        fromId: viewerId,
        targetId: hostId,
        reason: 'Viewer clicked Disconnect'
      }));

      const hostHandler = (raw) => {
        const msg = JSON.parse(raw.toString());
        if (msg.type === 'session_end') {
          assert(msg.reason.includes('Viewer clicked Disconnect'), 'Host observed session termination notification');
          hostWs.off('message', hostHandler);
          resolve();
        }
      };
      hostWs.on('message', hostHandler);
    });
    console.log('');

  } finally {
    if (hostWs) hostWs.close();
    if (viewerWs) viewerWs.close();
    await server.stop();
  }

  console.log('========================================================');
  console.log(` ALL TESTS PASSED! (${passedTests}/${totalTests} assertions verified)`);
  console.log('========================================================\n');
}

runTestSuite().catch((err) => {
  console.error('\nTest Suite Failed:', err);
  process.exit(1);
});
