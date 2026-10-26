// api/turn.js
const crypto = require('crypto');

module.exports = (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Content-Type', 'application/json');

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  // Generates timed TURN credentials or returns configured STUN/TURN list
  const turnSecret = process.env.TURN_SECRET;
  const turnDomain = process.env.TURN_DOMAIN || 'turn.aerodesk.net';

  const defaultIceServers = [
    { urls: 'stun:stun.l.google.com:19302' },
    { urls: 'stun:stun1.l.google.com:19302' },
    { urls: 'stun:stun2.l.google.com:19302' }
  ];

  if (turnSecret) {
    const timestamp = Math.floor(Date.now() / 1000) + 24 * 3600; // 24 hours
    const username = `${timestamp}:aerodesk`;
    const hmac = crypto.createHmac('sha1', turnSecret);
    hmac.setEncoding('base64');
    hmac.write(username);
    hmac.end();
    const password = hmac.read();

    defaultIceServers.push({
      urls: [
        `turn:${turnDomain}:3478?transport=udp`,
        `turn:${turnDomain}:3478?transport=tcp`,
        `turns:${turnDomain}:5349?transport=tcp`
      ],
      username,
      credential: password
    });
  }

  res.status(200).json({
    iceServers: defaultIceServers,
    expiresIn: 86400
  });
};
