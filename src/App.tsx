// src/App.tsx
import React, { useState, useEffect, useRef } from 'react';
import { Titlebar } from './components/Titlebar';
import { Dashboard } from './components/Dashboard';
import { IncomingCallModal } from './components/IncomingCallModal';
import { RemoteSessionViewport } from './components/RemoteSessionViewport';
import { HostSessionView } from './components/HostSessionView';
import { SettingsModal } from './components/SettingsModal';
import { FileTransferModal } from './components/FileTransferModal';
import { SignalingClient } from './services/signaling-client';
import { WebRTCManager } from './services/webrtc-manager';
import { getSignalingUrl } from './services/config';
import {
  ActiveSessionData,
  ConnectionState,
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

  // Core Service Instances
  const signalingRef = useRef<SignalingClient | null>(null);
  const webrtcRef = useRef<WebRTCManager | null>(null);
  const incomingCallRef = useRef<IncomingCallData | null>(null);
  incomingCallRef.current = incomingCall;

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

      onIncomingCall: (call) => {
        setIncomingCall(call);
        setConnectionState('ringing');
        // Trigger always-on-top popover and unminimize window if minimized
        window.aeroDeskApi?.notifyIncomingCall(call);
      },

      onCallAccepted: async (hostId, hostName, grantedPermissions) => {
        console.log(`[App] Call accepted by ${hostId}`);
        setConnectionState('connected');

        setActiveSession({
          peerId: hostId,
          peerName: hostName,
          role: 'viewer',
          permissions: grantedPermissions,
          startTime: Date.now(),
          durationSeconds: 0,
          quality: 'balanced',
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
        await webrtc.startAsViewer(hostId, grantedPermissions);
      },

      onCallRejected: (hostId, reason) => {
        alert(`Connection to ${hostId} was rejected: ${reason}`);
        setConnectionState('idle');
      },

      onCallFailed: (targetId, reason) => {
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
        console.log(`[App] Session ended by ${peerId}: ${reason}`);
        handleDisconnect(false);
      },

      onStateChange: (state) => {
        setConnectionState(state);
      }
    });

    // Attach webrtc telemetry events
    webrtc.setEvents({
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

    // Listen for Popover Decisions (from always-on-top approval popover window)
    const cleanupPopover = window.aeroDeskApi?.onPopoverDecision(({ accepted, permissions }) => {
      console.log('[App] Received approval decision from popover:', accepted);
      if (accepted) {
        handleAcceptIncomingCall(permissions);
      } else {
        handleRejectIncomingCall('Connection declined by host user');
      }
    });

    signaling.connect();

    return () => {
      cleanupRevoke?.();
      cleanupDisconnect?.();
      cleanupPopover?.();
      signaling.disconnect();
      webrtc.close();
    };
  }, []);

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

  const handleConnect = (targetId: string, perms: SessionPermissions, quality: QualityPreset) => {
    if (!signalingRef.current) return;
    setConnectionState('calling');
    signalingRef.current.callRemoteDevice(targetId, perms);
  };

  const handleAcceptIncomingCall = async (grantedPermissions?: SessionPermissions) => {
    const call = incomingCallRef.current || incomingCall;
    if (!call || !signalingRef.current || !webrtcRef.current) return;
    const callerId = call.callerId;
    const callerName = call.callerName;
    const permissions = grantedPermissions || call.requestedPermissions;

    // Close any active approval popover window
    window.aeroDeskApi?.closeIncomingCallPopover();

    setIncomingCall(null);
    setConnectionState('connected');

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

    // Close any active approval popover window
    window.aeroDeskApi?.closeIncomingCallPopover();

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
            onClose={() => setFileTransferOpen(false)}
          />
        )}
      </main>
    </div>
  );
};
