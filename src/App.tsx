// src/App.tsx
import React, { useState, useEffect, useRef } from 'react';
import { Titlebar } from './components/Titlebar';
import { Dashboard } from './components/Dashboard';
import { IncomingCallModal } from './components/IncomingCallModal';
import { RemoteSessionViewport } from './components/RemoteSessionViewport';
import { HostSessionView } from './components/HostSessionView';
import { SettingsModal } from './components/SettingsModal';
import { FileTransferModal } from './components/FileTransferModal';
import { summarizeTransfer, TransferSummary } from './components/TransferList';
import { SignalingClient } from './services/signaling-client';
import { WebRTCManager } from './services/webrtc-manager';
import { getSignalingUrl } from './services/config';
import { verifyUnattendedPassword } from './services/unattended';
import {
  ActiveSessionData,
  ConnectionState,
  FileTransferItem,
  IncomingCallData,
  QualityPreset,
  RecentSession,
  SavedDevice,
  SessionPermissions
} from './types';

export const App: React.FC = () => {
  const [connectionState, setConnectionState] = useState<ConnectionState>('disconnected');
  const [myDeviceId, setMyDeviceId] = useState<string>('');
  const [incomingCall, setIncomingCall] = useState<IncomingCallData | null>(null);
  const [activeSession, setActiveSession] = useState<ActiveSessionData | null>(null);

  const [recentSessions, setRecentSessions] = useState<RecentSession[]>([]);
  const [savedDevices, setSavedDevices] = useState<SavedDevice[]>([]);

  const [settingsOpen, setSettingsOpen] = useState(false);
  const [fileTransferOpen, setFileTransferOpen] = useState(false);
  const [transfers, setTransfers] = useState<FileTransferItem[]>([]);

  // Core Service Instances
  const signalingRef = useRef<SignalingClient | null>(null);
  const webrtcRef = useRef<WebRTCManager | null>(null);
  const incomingCallRef = useRef<IncomingCallData | null>(null);
  incomingCallRef.current = incomingCall;
  // Callbacks registered once at mount (overlay, shortcut, signaling) need the live session, not the first render's
  const activeSessionRef = useRef<ActiveSessionData | null>(null);
  const requestedQualityRef = useRef<QualityPreset>('balanced');
  // Outgoing call still ringing; cleared on answer, failure or cancel
  const pendingCallRef = useRef<string | null>(null);
  activeSessionRef.current = activeSession;

  // Initialize Services
  useEffect(() => {
    // Load local storage items
    const savedRecents = localStorage.getItem('aerodesk_recent_sessions');
    if (savedRecents) {
      try { setRecentSessions(JSON.parse(savedRecents)); } catch (_) {}
    }

    const savedDevs = localStorage.getItem('aerodesk_saved_devices');
    if (savedDevs) {
      try { setSavedDevices(JSON.parse(savedDevs)); } catch (_) {}
    }

    const signalingUrl = getSignalingUrl();
    console.log('[App] Connecting to signaling gateway:', signalingUrl);
    const signaling = new SignalingClient(signalingUrl);
    signalingRef.current = signaling;

    const webrtc = new WebRTCManager(signaling);
    webrtcRef.current = webrtc;

    // Attach signaling callbacks
    signaling.setHandlers({
      onRegistered: (deviceId) => {
        setMyDeviceId(deviceId);
        setConnectionState('idle');
      },

      onIncomingCall: async ({ password, ...call }) => {
        // Unattended access: correct password skips the prompt; wrong one falls back to manual approval
        if (await verifyUnattendedPassword(password || '')) {
          incomingCallRef.current = call;
          handleAcceptIncomingCall(call.requestedPermissions);
          return;
        }
        setIncomingCall(call);
        setConnectionState('ringing');
        // Raise the window so the approval prompt is seen even if minimized
        window.aeroDeskApi?.notifyIncomingCall(call);
      },

      onCallAccepted: async (hostId, hostName, grantedPermissions) => {
        if (!pendingCallRef.current) {
          // Host accepted just as we cancelled: end it on their side too
          signaling.endSession(hostId, 'Caller cancelled the request');
          return;
        }
        pendingCallRef.current = null;
        console.log(`[App] Call accepted by ${hostId}`);
        setConnectionState('connected');

        setActiveSession({
          peerId: hostId,
          peerName: hostName,
          role: 'viewer',
          permissions: grantedPermissions,
          startTime: Date.now(),
          durationSeconds: 0,
          quality: requestedQualityRef.current,
          rttMs: 15,
          fps: 60,
          bitrateKbps: 0,
          isFullscreen: false,
          fitToWindow: true
        });

        // Save to recent sessions
        addRecentSession(hostId, hostName);

        // Record audit log
        window.aeroDeskApi?.appendAuditLog({
          timestamp: new Date().toISOString(),
          type: 'outgoing_connection',
          peerId: hostId,
          peerName: hostName,
          permissions: grantedPermissions,
          status: 'accepted'
        });

        // Initialize WebRTC as viewer
        await webrtc.startAsViewer(hostId, grantedPermissions, requestedQualityRef.current);
      },

      onCallRejected: (hostId, reason) => {
        pendingCallRef.current = null;
        alert(`Connection to ${hostId} was rejected: ${reason}`);
        setConnectionState('idle');
      },

      onCallFailed: (targetId, reason) => {
        pendingCallRef.current = null;
        alert(`Connection to ${targetId} failed: ${reason}`);
        setConnectionState('idle');
      },

      onWebRTCOffer: async (fromId, sdp) => {
        await webrtc.handleRemoteOffer(sdp);
      },

      onWebRTCAnswer: async (fromId, sdp) => {
        await webrtc.handleRemoteAnswer(sdp);
      },

      onIceCandidate: async (fromId, candidate) => {
        await webrtc.handleRemoteIceCandidate(candidate);
      },

      onSessionEnd: (peerId, reason) => {
        // Caller cancelled while we were still being asked: dismiss the prompt
        const ringing = incomingCallRef.current;
        if (ringing && ringing.callerId.replace(/\s+/g, '') === peerId.replace(/\s+/g, '')) {
          window.aeroDeskApi?.clearIncomingCallAlert();
          setIncomingCall(null);
          setConnectionState('idle');
          return;
        }
        console.log(`[App] Session ended by ${peerId}: ${reason}`);
        handleDisconnect(false);
      },

      onStateChange: (state) => {
        setConnectionState(state);
      }
    });

    // Attach webrtc telemetry events
    webrtc.setEvents({
      onTransferUpdate: (transfer) => {
        setTransfers((prev) => prev.some((t) => t.id === transfer.id)
          ? prev.map((t) => (t.id === transfer.id ? transfer : t))
          : [...prev, transfer]);
        if (transfer.direction === 'receive' && transfer.status === 'done' && transfer.savedPath) {
          new Notification('File received', { body: transfer.savedPath });
        }
      },
      onStatsUpdate: (stats) => {
        setActiveSession((prev) => {
          if (!prev) return null;
          return {
            ...prev,
            rttMs: stats.rttMs,
            fps: stats.fps,
            bitrateKbps: stats.bitrateKbps
          };
        });
      }
    });

    // Listen for Emergency Revocation & Host Disconnect from Electron
    const cleanupRevoke = window.aeroDeskApi?.onEmergencyRevoke(() => {
      console.warn('[App] EMERGENCY REVOCATION TRIGGERED');
      if (webrtcRef.current) {
        webrtcRef.current.setPermissions({ view: true, input: false, clipboard: false, fileTransfer: false });
      }
      setActiveSession((prev) => prev ? {
        ...prev,
        permissions: { ...prev.permissions, input: false }
      } : null);
    });

    const cleanupDisconnect = window.aeroDeskApi?.onHostDisconnect(() => {
      console.warn('[App] HOST DISCONNECT TRIGGERED');
      handleDisconnect(true);
    });

    signaling.connect();

    return () => {
      cleanupRevoke?.();
      cleanupDisconnect?.();
      signaling.disconnect();
      webrtc.close();
    };
  }, []);

  // Session toast line: the running transfer, then its outcome for a few seconds
  const [transferToast, setTransferToast] = useState<TransferSummary | null>(null);
  useEffect(() => {
    const pending = transfers.filter((t) => t.status === 'active' || t.status === 'queued');
    const current = pending.find((t) => t.status === 'active') ?? pending[0] ?? transfers[transfers.length - 1];
    setTransferToast(current ? summarizeTransfer(current, pending.length - 1) : null);
    if (!current || pending.length) return;
    const timer = setTimeout(() => setTransferToast(null), 6000);
    return () => clearTimeout(timer);
  }, [transfers]);

  // Host: shown in the bottom-right session banner (which pops open if it was collapsed)
  useEffect(() => {
    if (activeSession?.role === 'host') window.aeroDeskApi?.hostOverlayTransfer(transferToast);
  }, [transferToast, activeSession?.role]);

  // Duration Timer for active session
  useEffect(() => {
    let timer: any = null;
    if (activeSession) {
      timer = setInterval(() => {
        setActiveSession((prev) => {
          if (!prev) return null;
          return {
            ...prev,
            durationSeconds: Math.floor((Date.now() - prev.startTime) / 1000)
          };
        });
      }, 1000);
    }
    return () => {
      if (timer) clearInterval(timer);
    };
  }, [!!activeSession]);

  const addRecentSession = (deviceId: string, deviceName: string) => {
    const updated = [
      {
        id: Date.now().toString(),
        deviceId,
        deviceName: deviceName || 'Windows Workstation',
        timestamp: new Date().toLocaleDateString() + ' ' + new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
        durationSeconds: 0
      },
      ...recentSessions.filter(s => s.deviceId !== deviceId)
    ].slice(0, 10);

    setRecentSessions(updated);
    localStorage.setItem('aerodesk_recent_sessions', JSON.stringify(updated));
  };

  const handleConnect = (targetId: string, perms: SessionPermissions, quality: QualityPreset, password?: string) => {
    if (!signalingRef.current) return;
    requestedQualityRef.current = quality;
    pendingCallRef.current = targetId;
    setConnectionState('calling');
    signalingRef.current.callRemoteDevice(targetId, perms, password);
  };

  const handleCancelCall = () => {
    if (pendingCallRef.current) {
      signalingRef.current?.endSession(pendingCallRef.current, 'Caller cancelled the request');
    }
    pendingCallRef.current = null;
    setConnectionState('idle');
  };

  const handleAcceptIncomingCall = async (grantedPermissions?: SessionPermissions) => {
    const call = incomingCallRef.current || incomingCall;
    if (!call || !signalingRef.current || !webrtcRef.current) return;
    const callerId = call.callerId;
    const callerName = call.callerName;
    const permissions = grantedPermissions || call.requestedPermissions;

    window.aeroDeskApi?.clearIncomingCallAlert();

    setIncomingCall(null);

    setActiveSession({
      peerId: callerId,
      peerName: callerName,
      role: 'host',
      permissions,
      startTime: Date.now(),
      durationSeconds: 0,
      quality: 'balanced',
      rttMs: 10,
      fps: 60,
      bitrateKbps: 0,
      isFullscreen: false,
      fitToWindow: true
    });

    // Accept via signaling
    signalingRef.current.respondToIncomingCall(callerId, true, permissions);
    setConnectionState('connected'); // after respond(), which reports 'connecting'

    // Show host indicator floating overlay window
    window.aeroDeskApi?.showHostOverlay({
      peerId: callerId,
      peerName: callerName,
      permissions
    });

    // Append audit log
    window.aeroDeskApi?.appendAuditLog({
      timestamp: new Date().toISOString(),
      type: 'incoming_connection',
      peerId: callerId,
      peerName: callerName,
      permissions,
      status: 'accepted'
    });

    // Start WebRTC as host (captures screen)
    await webrtcRef.current.startAsHost(callerId, permissions);
  };

  const handleRejectIncomingCall = (reason?: string) => {
    const call = incomingCallRef.current || incomingCall;
    if (!call || !signalingRef.current) return;

    window.aeroDeskApi?.clearIncomingCallAlert();

    signalingRef.current.respondToIncomingCall(call.callerId, false, {
      view: false,
      input: false,
      clipboard: false,
      fileTransfer: false
    }, reason);

    window.aeroDeskApi?.appendAuditLog({
      timestamp: new Date().toISOString(),
      type: 'incoming_connection',
      peerId: call.callerId,
      peerName: call.callerName,
      status: 'rejected'
    });

    setIncomingCall(null);
    setConnectionState('idle');
  };

  const handleDisconnect = (notifyPeer: boolean = true) => {
    const activeSession = activeSessionRef.current;
    if (activeSession && notifyPeer && signalingRef.current) {
      signalingRef.current.endSession(activeSession.peerId, 'Session ended by user');
    }

    if (activeSession) {
      window.aeroDeskApi?.appendAuditLog({
        timestamp: new Date().toISOString(),
        type: 'disconnect',
        peerId: activeSession.peerId,
        peerName: activeSession.peerName,
        durationSeconds: activeSession.durationSeconds,
        status: 'terminated'
      });
    }

    if (webrtcRef.current) {
      webrtcRef.current.close();
    }

    // Hide host overlay
    window.aeroDeskApi?.hideHostOverlay();

    setActiveSession(null);
    setConnectionState('idle');
  };

  return (
    <div style={{ height: '100vh', display: 'flex', flexDirection: 'column' }}>
      <Titlebar
        connectionState={connectionState}
        onOpenSettings={() => setSettingsOpen(true)}
      />

      <main style={{ flex: 1, position: 'relative', overflow: 'hidden' }}>
        {activeSession ? (
          activeSession.role === 'host' ? (
            <HostSessionView
              session={activeSession}
              webrtc={webrtcRef.current!}
              onDisconnect={() => handleDisconnect(true)}
              onOpenFileTransfer={() => setFileTransferOpen(true)}
              onToggleInputPermission={(allowed) => {
                setActiveSession((prev) => prev ? {
                  ...prev,
                  permissions: { ...prev.permissions, input: allowed }
                } : null);
              }}
            />
          ) : (
            <RemoteSessionViewport
              session={activeSession}
              webrtc={webrtcRef.current!}
              transferToast={transferToast}
              onDisconnect={() => handleDisconnect(true)}
              onOpenFileTransfer={() => setFileTransferOpen(true)}
            />
          )
        ) : (
          <Dashboard
            myDeviceId={myDeviceId}
            connectionState={connectionState}
            recentSessions={recentSessions}
            savedDevices={savedDevices}
            onConnect={handleConnect}
            onCancelCall={handleCancelCall}
            onOpenSettings={() => setSettingsOpen(true)}
          />
        )}

        {/* Incoming Connection Modal */}
        {incomingCall && (
          <IncomingCallModal
            callData={incomingCall}
            onAccept={handleAcceptIncomingCall}
            onReject={handleRejectIncomingCall}
          />
        )}

        {/* Settings Modal */}
        {settingsOpen && (
          <SettingsModal onClose={() => setSettingsOpen(false)} />
        )}

        {/* File Transfer Modal */}
        {fileTransferOpen && webrtcRef.current && (
          <FileTransferModal
            webrtc={webrtcRef.current}
            transfers={transfers}
            onClose={() => setFileTransferOpen(false)}
          />
        )}

      </main>
    </div>
  );
};
