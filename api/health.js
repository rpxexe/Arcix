// api/health.js
module.exports = (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Content-Type', 'application/json');

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  res.status(200).json({
    status: 'online',
    service: 'AeroDesk Serverless Gateway (Vercel)',
    version: '1.0.0',
    capabilities: [
      'device_registration',
      'session_broker',
      'turn_discovery',
      'webrtc_stun'
    ],
    stunServers: [
      'stun:stun.l.google.com:19302',
      'stun:stun1.l.google.com:19302'
    ],
    timestamp: new Date().toISOString()
  });
};
