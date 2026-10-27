// src/services/signaling-client.ts
import { ConnectionState, IncomingCallData, SessionPermissions } from '../types';

export type SignalingEventHandler = {
  onRegistered?: (deviceId: string, token: string) => void;
  onIncomingCall?: (call: IncomingCallData) => void;
  onCallAccepted?: (hostId: string, hostName: string, permissions: SessionPermissions) => void;
  onCallRejected?: (hostId: string, reason: string) => void;
  onCallFailed?: (targetId: string, reason: string) => void;
  onCalling?: (targetId: string, status: string) => void;
  onWebRTCOffer?: (fromId: string, sdp: RTCSessionDescriptionInit) => void;
  onWebRTCAnswer?: (fromId: string, sdp: RTCSessionDescriptionInit) => void;
  onIceCandidate?: (fromId: string, candidate: RTCIceCandidateInit) => void;
  onSessionEnd?: (peerId: string, reason: string) => void;
  onPermissionUpdate?: (permissions: SessionPermissions) => void;
  onStateChange?: (state: ConnectionState) => void;
  onError?: (err: { code: string; message: string }) => void;
};

export class SignalingClient {
  private ws: WebSocket | null = null;
  private url: string;
  private handlers: SignalingEventHandler = {};
  private reconnectTimer: any = null;
  private pingInterval: any = null;
  private state: ConnectionState = 'disconnected';

  public myDeviceId: string = '';
  public myToken: string = '';
  public myDeviceName: string = 'Windows PC';

  constructor(serverUrl: string = 'ws://localhost:7070') {
    this.url = serverUrl;
  }

  public setHandlers(handlers: SignalingEventHandler) {
    this.handlers = { ...this.handlers, ...handlers };
  }

  public connect() {
    if (this.ws && (this.ws.readyState === WebSocket.OPEN || this.ws.readyState === WebSocket.CONNECTING)) {
      return;
    }

    this.setState('registering');

    try {
      this.ws = new WebSocket(this.url);

      this.ws.onopen = () => {
        console.log('[Signaling] WebSocket connection established');
        this.startPing();

        // Restore saved device ID and token if present
        const savedId = localStorage.getItem('aerodesk_device_id');
        const savedToken = localStorage.getItem('aerodesk_token');
        const savedName = localStorage.getItem('aerodesk_device_name') || 'Windows PC';

        this.send({
          type: 'register',
          deviceId: savedId || undefined,
          token: savedToken || undefined,
          deviceName: savedName
        });
      };

      this.ws.onmessage = (event) => {
        try {
          const msg = JSON.parse(event.data);
          this.handleIncomingMessage(msg);
        } catch (err) {
          console.error('[Signaling] Failed to parse message', err);
        }
      };

      this.ws.onclose = () => {
        console.warn('[Signaling] Disconnected from signaling server');
        this.stopPing();
        this.setState('disconnected');
        this.scheduleReconnect();
      };

      this.ws.onerror = (err) => {
        console.error('[Signaling Error]', err);
        this.setState('error');
      };
    } catch (err) {
      console.error('[Signaling] Connection error:', err);
      this.setState('error');
      this.scheduleReconnect();
    }
  }

  private handleIncomingMessage(msg: any) {
    switch (msg.type) {
      case 'registered':
        this.myDeviceId = msg.deviceId;
        this.myToken = msg.token;
        localStorage.setItem('aerodesk_device_id', msg.deviceId);
        localStorage.setItem('aerodesk_token', msg.token);
        this.setState('idle');
        this.handlers.onRegistered?.(msg.deviceId, msg.token);
        break;

      case 'incoming_call':
        this.setState('ringing');
        this.handlers.onIncomingCall?.({
          callerId: msg.callerId,
          callerName: msg.callerName,
          requestedPermissions: msg.requestedPermissions,
          password: msg.password
        });
        break;

      case 'calling':
        this.setState('calling');
        this.handlers.onCalling?.(msg.targetId, msg.status);
        break;

      case 'call_accepted':
        this.setState('connecting');
        this.handlers.onCallAccepted?.(msg.hostId, msg.hostName, msg.grantedPermissions);
        break;

      case 'call_rejected':
        this.setState('idle');
        this.handlers.onCallRejected?.(msg.hostId, msg.reason);
        break;

      case 'call_failed':
        this.setState('idle');
        this.handlers.onCallFailed?.(msg.targetId, msg.reason);
        break;

      case 'webrtc_offer':
        this.handlers.onWebRTCOffer?.(msg.fromId, msg.sdp);
        break;

      case 'webrtc_answer':
        this.handlers.onWebRTCAnswer?.(msg.fromId, msg.sdp);
        break;

      case 'ice_candidate':
        this.handlers.onIceCandidate?.(msg.fromId, msg.candidate);
        break;

      case 'session_end':
        this.setState('idle');
        this.handlers.onSessionEnd?.(msg.peerId, msg.reason);
        break;

      case 'permission_update':
        this.handlers.onPermissionUpdate?.(msg.permissions);
        break;

      case 'error':
        this.handlers.onError?.({ code: msg.code, message: msg.message });
        break;
    }
  }

  public callRemoteDevice(targetId: string, requestedPermissions: SessionPermissions, password?: string) {
    this.send({
      type: 'call_request',
      fromId: this.myDeviceId,
      targetId: targetId.replace(/\s+/g, ''),
      requestedPermissions,
      password: password || undefined
    });
  }

  public respondToIncomingCall(callerId: string, accepted: boolean, grantedPermissions: SessionPermissions, reason?: string) {
    this.send({
      type: 'call_response',
      fromId: this.myDeviceId,
      callerId: callerId.replace(/\s+/g, ''),
      accepted,
      grantedPermissions,
      reason
    });
    if (!accepted) {
      this.setState('idle');
    } else {
      this.setState('connecting');
    }
  }

  public sendWebRTCOffer(targetId: string, sdp: RTCSessionDescriptionInit) {
    this.send({
      type: 'webrtc_offer',
      fromId: this.myDeviceId,
      targetId: targetId.replace(/\s+/g, ''),
      sdp
    });
  }

  public sendWebRTCAnswer(targetId: string, sdp: RTCSessionDescriptionInit) {
    this.send({
      type: 'webrtc_answer',
      fromId: this.myDeviceId,
      targetId: targetId.replace(/\s+/g, ''),
      sdp
    });
  }

  public sendIceCandidate(targetId: string, candidate: RTCIceCandidateInit) {
    this.send({
      type: 'ice_candidate',
      fromId: this.myDeviceId,
      targetId: targetId.replace(/\s+/g, ''),
      candidate
    });
  }

  public endSession(targetId: string, reason: string = 'User disconnected') {
    this.send({
      type: 'session_end',
      fromId: this.myDeviceId,
      targetId: targetId.replace(/\s+/g, ''),
      reason
    });
    this.setState('idle');
  }

  public updatePermissions(targetId: string, permissions: SessionPermissions) {
    this.send({
      type: 'permission_update',
      fromId: this.myDeviceId,
      targetId: targetId.replace(/\s+/g, ''),
      permissions
    });
  }

  private send(data: any) {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify(data));
    }
  }

  private setState(newState: ConnectionState) {
    this.state = newState;
    this.handlers.onStateChange?.(newState);
  }

  public getState(): ConnectionState {
    return this.state;
  }

  private startPing() {
    this.stopPing();
    this.pingInterval = setInterval(() => {
      this.send({ type: 'ping' });
    }, 15000);
  }

  private stopPing() {
    if (this.pingInterval) {
      clearInterval(this.pingInterval);
      this.pingInterval = null;
    }
  }

  private scheduleReconnect() {
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
    this.reconnectTimer = setTimeout(() => {
      console.log('[Signaling] Attempting to reconnect...');
      this.connect();
    }, 3000);
  }

  public disconnect() {
    this.stopPing();
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
    if (this.ws) {
      this.ws.close();
      this.ws = null;
    }
    this.setState('disconnected');
  }
}
