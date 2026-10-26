// server/index.js
const { SignalingServer } = require('./signaling-server');

const PORT = process.env.PORT || 7070;
const server = new SignalingServer(PORT);

server.start().then((port) => {
  console.log(`===============================================`);
  console.log(` AeroDesk Signaling Server running on :${port}`);
  console.log(` WebRTC Signaling: ws://localhost:${port}`);
  console.log(` Health Check URL: http://localhost:${port}/health`);
  console.log(`===============================================`);
});

process.on('SIGINT', async () => {
  console.log('Shutting down signaling server...');
  await server.stop();
  process.exit(0);
});
