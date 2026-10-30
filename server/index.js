// server/index.js
const http = require('http');
const { SignalingServer } = require('./signaling-server');

const PORT = parseInt(process.env.PORT || '7070', 10);

function checkExistingServer(port) {
  return new Promise((resolve) => {
    const req = http.get(`http://localhost:${port}/health`, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        try {
          const parsed = JSON.parse(data);
          if (parsed && parsed.service && parsed.service.includes('Arcix')) {
            return resolve(true);
          }
        } catch (_) {}
        resolve(false);
      });
    });

    req.on('error', () => resolve(false));
    req.setTimeout(1000, () => {
      req.destroy();
      resolve(false);
    });
  });
}

async function main() {
  const isAlreadyActive = await checkExistingServer(PORT);
  if (isAlreadyActive) {
    console.log(`===============================================`);
    console.log(` [Arcix] Existing Signaling Server detected on :${PORT}`);
    console.log(` Reusing active instance at ws://localhost:${PORT}`);
    console.log(`===============================================`);
    // Keep process alive so concurrent orchestrators (like concurrently in npm run dev) stay running
    setInterval(() => {}, 60000);
    return;
  }

  const server = new SignalingServer(PORT);
  server.start().then((port) => {
    console.log(`===============================================`);
    console.log(` Arcix Signaling Server running on :${port}`);
    console.log(` WebRTC Signaling: ws://localhost:${port}`);
    console.log(` Health Check URL: http://localhost:${port}/health`);
    console.log(`===============================================`);
  });

  process.on('SIGINT', async () => {
    console.log('Shutting down signaling server...');
    await server.stop();
    process.exit(0);
  });
}

main();
