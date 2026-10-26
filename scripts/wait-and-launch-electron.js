// scripts/wait-and-launch-electron.js
const http = require('http');
const { spawn } = require('child_process');

function checkViteReady(url = 'http://localhost:5173') {
  return new Promise((resolve) => {
    http.get(url, (res) => {
      if (res.statusCode === 200 || res.statusCode === 304) {
        resolve(true);
      } else {
        resolve(false);
      }
    }).on('error', () => {
      resolve(false);
    });
  });
}

async function waitAndLaunch() {
  console.log('[Runner] Waiting for Vite development server on :5173...');
  let ready = false;
  for (let i = 0; i < 30; i++) {
    ready = await checkViteReady();
    if (ready) break;
    await new Promise(r => setTimeout(r, 500));
  }

  if (!ready) {
    console.error('[Runner] Timeout waiting for Vite server.');
    process.exit(1);
  }

  console.log('[Runner] Vite is ready! Launching Electron desktop shell...');
  const electronProc = spawn('npx', ['electron', '.'], {
    shell: true,
    stdio: 'inherit',
    env: { ...process.env, NODE_ENV: 'development', VITE_DEV_SERVER_URL: 'http://localhost:5173' }
  });

  electronProc.on('exit', (code) => {
    process.exit(code || 0);
  });
}

waitAndLaunch();
