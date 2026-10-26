// server/signaling-server.js
const http = require('http');
const { WebSocketServer, WebSocket } = require('ws');
const crypto = require('crypto');

class SignalingServer {
  constructor(port = 7070) {
    this.port = port;
    this.devices = new Map(); // deviceId -> { ws, deviceId, deviceName, token, registeredAt, activeSessionWith }
    this.rateLimits = new Map(); // ip -> { attempts, lastAttempt }
    this.httpServer = null;
    this.wss = null;
  }

  start() {
    return new Promise((resolve) => {
      this.httpServer = http.createServer((req, res) => {
        // Simple health and audit metrics check
        res.setHeader('Access-Control-Allow-Origin', '*');
        res.setHeader('Content-Type', 'application/json');

        if (req.url === '/health' || req.url === '/status') {
          res.writeHead(200);
          res.end(JSON.stringify({
            status: 'online',
            service: 'AeroDesk Signaling Hub',
            activeDevices: this.devices.size,
            uptime: process.uptime(),
            timestamp: new Date().toISOString()
          }));
        } else {
          res.writeHead(404);
          res.end(JSON.stringify({ error: 'Not Found' }));
        }
      });

      this.wss = new WebSocketServer({ server: this.httpServer });

      this.wss.on('connection', (ws, req) => {
        const clientIp = req.socket.remoteAddress;
        let registeredDeviceId = null;

        ws.on('message', (messageRaw) => {
          try {
            const data = JSON.parse(messageRaw.toString());
            this.handleMessage(ws, data, clientIp, (id) => {
              registeredDeviceId = id;
            });
          } catch (err) {
            this.sendError(ws, 'INVALID_JSON', 'Malformed JSON payload received');
          }
        });

        ws.on('close', () => {
          if (registeredDeviceId) {
            const device = this.devices.get(registeredDeviceId);
            if (device && device.activeSessionWith) {
              const peer = this.devices.get(device.activeSessionWith);
              if (peer && peer.ws.readyState === WebSocket.OPEN) {
                this.send(peer.ws, {
                  type: 'session_end',
                  peerId: registeredDeviceId,
                  reason: 'Peer disconnected unexpectedly'
                });
                peer.activeSessionWith = null;
              }
            }
            this.devices.delete(registeredDeviceId);
          }
        });

        ws.on('error', (err) => {
          console.error(`[WebSocket Error] ${err.message}`);
        });

        // Send welcome banner
        this.send(ws, {
          type: 'welcome',
          message: 'Connected to AeroDesk Signaling Gateway',
          version: '1.0.0'
        });
      });

      this.httpServer.on('error', (err) => {
        if (err.code === 'EADDRINUSE') {
          console.warn(`[AeroDesk Signaling Server] Warning: Port ${this.port} is already in use.`);
        } else {
          console.error(`[AeroDesk Signaling Server] HTTP Server Error:`, err);
        }
      });

      this.httpServer.listen(this.port, () => {
        console.log(`[AeroDesk Signaling Server] Listening on port ${this.port}`);
        resolve(this.port);
      });
    });
  }

  handleMessage(ws, msg, clientIp, setDeviceId) {
    switch (msg.type) {
      case 'register':
        this.handleRegister(ws, msg, setDeviceId);
        break;

      case 'call_request':
        this.handleCallRequest(ws, msg, clientIp);
        break;

      case 'call_response':
        this.handleCallResponse(ws, msg);
        break;

      case 'webrtc_offer':
      case 'webrtc_answer':
      case 'ice_candidate':
        this.forwardWebRTCSignaling(ws, msg);
        break;

      case 'session_end':
        this.handleSessionEnd(ws, msg);
        break;

      case 'permission_update':
        this.handlePermissionUpdate(ws, msg);
        break;

      case 'ping':
        this.send(ws, { type: 'pong', timestamp: Date.now() });
        break;

      default:
        this.sendError(ws, 'UNKNOWN_MESSAGE_TYPE', `Type '${msg.type}' is unrecognized`);
    }
  }

  handleRegister(ws, msg, setDeviceId) {
    let deviceId = msg.deviceId ? this.normalizeId(msg.deviceId) : null;
    let token = msg.token;

    // If device exists and token matches, re-attach ws
    if (deviceId && this.devices.has(deviceId)) {
      const existing = this.devices.get(deviceId);
      if (token && existing.token === token) {
        existing.ws = ws;
        existing.deviceName = msg.deviceName || existing.deviceName;
        setDeviceId(deviceId);
        this.send(ws, {
          type: 'registered',
          deviceId: this.formatId(deviceId),
          token: existing.token,
          restored: true
        });
        return;
      }
    }

    // Generate new unique 9-digit ID if not provided or conflict
    if (!deviceId || this.devices.has(deviceId)) {
      deviceId = this.generateUniqueId();
      token = crypto.randomBytes(16).toString('hex');
    }

    setDeviceId(deviceId);
    this.devices.set(deviceId, {
      ws,
      deviceId,
      deviceName: msg.deviceName || 'Windows Device',
      token,
      registeredAt: Date.now(),
      activeSessionWith: null
    });

    this.send(ws, {
      type: 'registered',
      deviceId: this.formatId(deviceId),
      token,
      restored: false
    });
  }

  handleCallRequest(ws, msg, clientIp) {
    const fromId = this.normalizeId(msg.fromId);
    const targetId = this.normalizeId(msg.targetId);

    if (!fromId || !targetId) {
      return this.sendError(ws, 'MISSING_PARAMS', 'fromId and targetId are required');
    }

    if (fromId === targetId) {
      return this.sendError(ws, 'INVALID_TARGET', 'Cannot connect to self');
    }

    const targetDevice = this.devices.get(targetId);
    if (!targetDevice || targetDevice.ws.readyState !== WebSocket.OPEN) {
      return this.send(ws, {
        type: 'call_failed',
        targetId: this.formatId(targetId),
        reason: 'Target device is offline or unavailable'
      });
    }

    if (targetDevice.activeSessionWith) {
      return this.send(ws, {
        type: 'call_failed',
        targetId: this.formatId(targetId),
        reason: 'Target device is currently busy in another session'
      });
    }

    // Forward request to target host
    const callerDevice = this.devices.get(fromId);
    this.send(targetDevice.ws, {
      type: 'incoming_call',
      callerId: this.formatId(fromId),
      callerName: callerDevice ? callerDevice.deviceName : 'Remote Viewer',
      requestedPermissions: msg.requestedPermissions || {
        view: true,
        input: true,
        clipboard: true,
        fileTransfer: true
      }
    });

    this.send(ws, {
      type: 'calling',
      targetId: this.formatId(targetId),
      status: 'ringing'
    });
  }

  handleCallResponse(ws, msg) {
    const fromId = this.normalizeId(msg.fromId); // Target host responding
    const callerId = this.normalizeId(msg.callerId); // Caller waiting

    const callerDevice = this.devices.get(callerId);
    const hostDevice = this.devices.get(fromId);

    if (!callerDevice || callerDevice.ws.readyState !== WebSocket.OPEN) {
      return this.sendError(ws, 'CALLER_UNAVAILABLE', 'Caller disconnected before response');
    }

    if (msg.accepted) {
      if (hostDevice) hostDevice.activeSessionWith = callerId;
      if (callerDevice) callerDevice.activeSessionWith = fromId;

      this.send(callerDevice.ws, {
        type: 'call_accepted',
        hostId: this.formatId(fromId),
        hostName: hostDevice ? hostDevice.deviceName : 'Remote Host',
        grantedPermissions: msg.grantedPermissions || { view: true, input: false, clipboard: false, fileTransfer: false }
      });

      this.send(ws, {
        type: 'session_started',
        peerId: this.formatId(callerId),
        grantedPermissions: msg.grantedPermissions
      });
    } else {
      this.send(callerDevice.ws, {
        type: 'call_rejected',
        hostId: this.formatId(fromId),
        reason: msg.reason || 'Host rejected the connection request'
      });
    }
  }

  forwardWebRTCSignaling(ws, msg) {
    const targetId = this.normalizeId(msg.targetId);
    const fromId = this.normalizeId(msg.fromId);

    const target = this.devices.get(targetId);
    if (target && target.ws.readyState === WebSocket.OPEN) {
      this.send(target.ws, {
        ...msg,
        fromId: this.formatId(fromId),
        targetId: this.formatId(targetId)
      });
    } else {
      this.sendError(ws, 'PEER_OFFLINE', `Peer ${msg.targetId} is not connected`);
    }
  }

  handleSessionEnd(ws, msg) {
    const fromId = this.normalizeId(msg.fromId);
    const targetId = this.normalizeId(msg.targetId);

    const fromDevice = this.devices.get(fromId);
    if (fromDevice) fromDevice.activeSessionWith = null;

    const targetDevice = this.devices.get(targetId);
    if (targetDevice) {
      targetDevice.activeSessionWith = null;
      if (targetDevice.ws.readyState === WebSocket.OPEN) {
        this.send(targetDevice.ws, {
          type: 'session_end',
          peerId: this.formatId(fromId),
          reason: msg.reason || 'Remote peer ended the session'
        });
      }
    }
  }

  handlePermissionUpdate(ws, msg) {
    const targetId = this.normalizeId(msg.targetId);
    const targetDevice = this.devices.get(targetId);
    if (targetDevice && targetDevice.ws.readyState === WebSocket.OPEN) {
      this.send(targetDevice.ws, {
        type: 'permission_update',
        permissions: msg.permissions,
        fromId: msg.fromId
      });
    }
  }

  send(ws, data) {
    if (ws && ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify(data));
    }
  }

  sendError(ws, code, message) {
    this.send(ws, { type: 'error', code, message });
  }

  generateUniqueId() {
    let id;
    do {
      // 9 digits between 100 000 000 and 999 999 999
      id = Math.floor(100000000 + Math.random() * 900000000).toString();
    } while (this.devices.has(id));
    return id;
  }

  normalizeId(id) {
    if (!id) return '';
    return id.toString().replace(/\s+/g, '');
  }

  formatId(id) {
    const clean = this.normalizeId(id);
    if (clean.length === 9) {
      return `${clean.slice(0, 3)} ${clean.slice(3, 6)} ${clean.slice(6, 9)}`;
    }
    return clean;
  }

  stop() {
    return new Promise((resolve) => {
      if (this.wss) {
        this.wss.close(() => {
          if (this.httpServer) {
            this.httpServer.close(() => resolve());
          } else {
            resolve();
          }
        });
      } else if (this.httpServer) {
        this.httpServer.close(() => resolve());
      } else {
        resolve();
      }
    });
  }
}

module.exports = { SignalingServer };
