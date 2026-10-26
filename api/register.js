// api/register.js
const crypto = require('crypto');

function formatId(id) {
  const clean = id.toString().replace(/\s+/g, '');
  if (clean.length === 9) {
    return `${clean.slice(0, 3)} ${clean.slice(3, 6)} ${clean.slice(6, 9)}`;
  }
  return clean;
}

module.exports = (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  res.setHeader('Content-Type', 'application/json');

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  const body = req.body || {};
  let deviceId = body.deviceId;
  let token = body.token;

  if (!deviceId) {
    // Generate fresh 9-digit AnyDesk-style ID
    deviceId = Math.floor(100000000 + Math.random() * 900000000).toString();
    token = crypto.randomBytes(16).toString('hex');
  }

  res.status(200).json({
    type: 'registered',
    deviceId: formatId(deviceId),
    token: token || crypto.randomBytes(16).toString('hex'),
    gateway: 'AeroDesk Vercel Edge',
    iceServers: [
      { urls: 'stun:stun.l.google.com:19302' },
      { urls: 'stun:stun1.l.google.com:19302' }
    ]
  });
};
