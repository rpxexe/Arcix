// src/components/HostSessionView.tsx
import React, { useState, useEffect } from 'react';
import {
  Monitor,
  Shield,
  ShieldAlert,
  ShieldCheck,
  MousePointer,
  Clipboard,
  FileUp,
  PhoneOff,
  Activity,
  Lock,
  Clock,
  Laptop,
  Minimize2,
  Maximize2
} from 'lucide-react';
import { ActiveSessionData } from '../types';
import { WebRTCManager } from '../services/webrtc-manager';

interface HostSessionViewProps {
  session: ActiveSessionData;
  webrtc: WebRTCManager;
  onDisconnect: () => void;
  onOpenFileTransfer?: () => void;
  onToggleInputPermission?: (allowed: boolean) => void;
}

export const HostSessionView: React.FC<HostSessionViewProps> = ({
  session,
  webrtc,
  onDisconnect,
  onOpenFileTransfer,
  onToggleInputPermission
}) => {
  const [duration, setDuration] = useState(session.durationSeconds || 0);
  const [inputAllowed, setInputAllowed] = useState(session.permissions.input);
  const [isCollapsed, setIsCollapsed] = useState(false);

  // Live timer
  useEffect(() => {
    const timer = setInterval(() => {
      setDuration((prev) => prev + 1);
    }, 1000);
    return () => clearInterval(timer);
  }, []);

  // Format duration into mm:ss or hh:mm:ss
  const formatTime = (secs: number) => {
    const hrs = Math.floor(secs / 3600);
    const mins = Math.floor((secs % 3600) / 60);
    const remainingSecs = secs % 60;
    if (hrs > 0) {
      return `${hrs.toString().padStart(2, '0')}:${mins.toString().padStart(2, '0')}:${remainingSecs.toString().padStart(2, '0')}`;
    }
    return `${mins.toString().padStart(2, '0')}:${remainingSecs.toString().padStart(2, '0')}`;
  };

  const handleToggleInput = () => {
    const nextState = !inputAllowed;
    setInputAllowed(nextState);
    webrtc.setPermissions({
      ...session.permissions,
      input: nextState
    });
    if (onToggleInputPermission) {
      onToggleInputPermission(nextState);
    }
  };

  return (
    <div style={{
      height: '100%',
      width: '100%',
      display: 'flex',
      flexDirection: 'column',
      alignItems: 'center',
      justifyContent: 'center',
      padding: '32px 24px',
      background: 'radial-gradient(circle at 50% 20%, rgba(6, 182, 212, 0.08) 0%, rgba(13, 17, 23, 1) 75%)',
      overflowY: 'auto'
    }}>
      {isCollapsed ? (
        /* Collapsed Compact Floating Card */
        <div
          id="host-session-card-collapsed"
          style={{
            background: 'rgba(21, 27, 35, 0.95)',
            backdropFilter: 'blur(20px)',
            border: '1px solid rgba(239, 68, 68, 0.4)',
            borderRadius: 14,
            padding: '14px 24px',
            boxShadow: '0 10px 30px rgba(0, 0, 0, 0.7), 0 0 20px rgba(239, 68, 68, 0.2)',
            display: 'flex',
            alignItems: 'center',
            gap: 20,
            maxWidth: 680,
            width: '100%',
            justifyContent: 'space-between',
            userSelect: 'none'
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
            <span className="online-pulse" style={{ background: '#ef4444' }} />
            <div>
              <div style={{ fontSize: 13, fontWeight: 700, color: '#fff', display: 'flex', alignItems: 'center', gap: 8 }}>
                <span>Screen Sharing</span>
                <span style={{ color: '#38bdf8', fontFamily: 'var(--font-mono)' }}>{session.peerId}</span>
              </div>
              <div style={{ fontSize: 11, color: 'var(--text-dim)', marginTop: 2 }}>
                {session.peerName || 'Remote Client'} • {formatTime(duration)}
              </div>
            </div>
          </div>

          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <button
              onClick={handleToggleInput}
              style={{
                padding: '6px 12px',
                borderRadius: 6,
                fontSize: 12,
                fontWeight: 600,
                cursor: 'pointer',
                background: inputAllowed ? 'rgba(239, 68, 68, 0.15)' : 'rgba(16, 185, 129, 0.2)',
                color: inputAllowed ? '#f87171' : '#10b981',
                border: inputAllowed ? '1px solid rgba(239, 68, 68, 0.4)' : '1px solid #10b981'
              }}
            >
              {inputAllowed ? 'Revoke Input' : 'Grant Input'}
            </button>

            <button
              onClick={onDisconnect}
              className="btn-danger"
              style={{ padding: '6px 14px', fontSize: 12 }}
            >
              Disconnect
            </button>

            <button
              onClick={() => setIsCollapsed(false)}
              id="expand-host-dashboard-btn"
              title="Expand Controls Dashboard"
              style={{
                background: 'rgba(255, 255, 255, 0.05)',
                border: '1px solid var(--border-subtle)',
                color: '#38bdf8',
                padding: '6px 10px',
                borderRadius: 6,
                cursor: 'pointer',
                display: 'flex',
                alignItems: 'center',
                gap: 4,
                fontSize: 12
              }}
            >
              <Maximize2 size={13} />
              <span>Expand</span>
            </button>
          </div>
        </div>
      ) : (
        /* Expanded Full Dashboard Card */
        <div style={{
          maxWidth: 720,
          width: '100%',
          background: 'rgba(21, 27, 35, 0.85)',
          backdropFilter: 'blur(20px)',
          border: '1px solid rgba(255, 255, 255, 0.08)',
          borderRadius: 16,
          padding: 32,
          boxShadow: '0 20px 50px rgba(0, 0, 0, 0.6), 0 0 30px rgba(6, 182, 212, 0.1)'
        }}>
          {/* Header Status */}
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 24, borderBottom: '1px solid var(--border-subtle)', paddingBottom: 20 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
              <div style={{
                width: 48,
                height: 48,
                borderRadius: 12,
                background: 'linear-gradient(135deg, rgba(239, 68, 68, 0.2) 0%, rgba(245, 158, 11, 0.2) 100%)',
                border: '1px solid rgba(239, 68, 68, 0.4)',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                color: '#ef4444',
                boxShadow: '0 0 16px rgba(239, 68, 68, 0.3)'
              }}>
                <Monitor size={24} strokeWidth={2.2} />
              </div>
              <div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  <span className="online-pulse" style={{ background: '#ef4444' }} />
                  <h2 style={{ fontSize: 18, fontWeight: 700, color: '#fff', margin: 0 }}>
                    Screen Sharing Active
                  </h2>
                </div>
                <p style={{ fontSize: 13, color: 'var(--text-muted)', margin: '4px 0 0 0' }}>
                  Your desktop is currently being viewed by a remote authorized operator.
                </p>
              </div>
            </div>

            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <div style={{
                display: 'flex',
                alignItems: 'center',
                gap: 6,
                background: 'rgba(255, 255, 255, 0.05)',
                border: '1px solid var(--border-subtle)',
                borderRadius: 8,
                padding: '6px 14px',
                fontSize: 13,
                color: '#fff',
                fontFamily: 'var(--font-mono)'
              }}>
                <Clock size={15} color="var(--accent-cyan)" />
                <span>{formatTime(duration)}</span>
              </div>

              <button
                onClick={() => setIsCollapsed(true)}
                id="collapse-host-dashboard-btn"
                title="Minimize to Compact View"
                style={{
                  background: 'rgba(255, 255, 255, 0.05)',
                  border: '1px solid var(--border-subtle)',
                  borderRadius: 8,
                  padding: '6px 10px',
                  color: 'var(--text-dim)',
                  cursor: 'pointer',
                  display: 'flex',
                  alignItems: 'center',
                  gap: 4,
                  fontSize: 12
                }}
              >
                <Minimize2 size={13} />
                <span>Minimize</span>
              </button>
            </div>
          </div>

        {/* Remote Peer & Connection Details Grid */}
        <div style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))',
          gap: 16,
          marginBottom: 24
        }}>
          {/* Peer Info */}
          <div style={{
            background: 'rgba(7, 9, 14, 0.6)',
            border: '1px solid var(--border-subtle)',
            borderRadius: 12,
            padding: 16
          }}>
            <div style={{ fontSize: 11, textTransform: 'uppercase', letterSpacing: '0.05em', color: 'var(--text-dim)', marginBottom: 6 }}>
              Connected Viewer
            </div>
            <div style={{ fontSize: 18, fontWeight: 700, color: '#38bdf8', fontFamily: 'var(--font-mono)', marginBottom: 4 }}>
              {session.peerId}
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12, color: 'var(--text-muted)' }}>
              <Laptop size={13} />
              <span>{session.peerName || 'Remote Client'}</span>
            </div>
          </div>

          {/* Telemetry Metrics */}
          <div style={{
            background: 'rgba(7, 9, 14, 0.6)',
            border: '1px solid var(--border-subtle)',
            borderRadius: 12,
            padding: 16
          }}>
            <div style={{ fontSize: 11, textTransform: 'uppercase', letterSpacing: '0.05em', color: 'var(--text-dim)', marginBottom: 6 }}>
              Live Telemetry
            </div>
            <div style={{ display: 'flex', alignItems: 'baseline', gap: 12 }}>
              <div style={{ fontSize: 18, fontWeight: 700, color: session.rttMs < 40 ? '#10b981' : '#f59e0b' }}>
                {session.rttMs} ms <span style={{ fontSize: 11, fontWeight: 400, color: 'var(--text-dim)' }}>RTT</span>
              </div>
              <div style={{ fontSize: 15, fontWeight: 600, color: '#fff' }}>
                {session.fps} <span style={{ fontSize: 11, fontWeight: 400, color: 'var(--text-dim)' }}>FPS</span>
              </div>
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 11, color: '#10b981', marginTop: 4 }}>
              <Lock size={12} />
              <span>DTLS-SRTP 256-bit Encrypted</span>
            </div>
          </div>
        </div>

        {/* Current Active Permissions */}
        <div style={{ marginBottom: 28 }}>
          <div style={{ fontSize: 12, fontWeight: 600, color: '#cbd5e1', marginBottom: 10 }}>
            Granted Session Permissions
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))', gap: 10 }}>
            <div style={{
              display: 'flex',
              alignItems: 'center',
              gap: 8,
              padding: '10px 12px',
              borderRadius: 8,
              background: 'rgba(16, 185, 129, 0.1)',
              border: '1px solid rgba(16, 185, 129, 0.3)',
              fontSize: 12,
              color: '#e2e8f0'
            }}>
              <Monitor size={15} color="#10b981" />
              <span>Screen Viewing</span>
            </div>

            <div style={{
              display: 'flex',
              alignItems: 'center',
              gap: 8,
              padding: '10px 12px',
              borderRadius: 8,
              background: inputAllowed ? 'rgba(16, 185, 129, 0.1)' : 'rgba(239, 68, 68, 0.1)',
              border: inputAllowed ? '1px solid rgba(16, 185, 129, 0.3)' : '1px solid rgba(239, 68, 68, 0.3)',
              fontSize: 12,
              color: inputAllowed ? '#e2e8f0' : '#f87171'
            }}>
              <MousePointer size={15} color={inputAllowed ? '#10b981' : '#ef4444'} />
              <span>Input Control: {inputAllowed ? 'Active' : 'Revoked'}</span>
            </div>

            <div style={{
              display: 'flex',
              alignItems: 'center',
              gap: 8,
              padding: '10px 12px',
              borderRadius: 8,
              background: session.permissions.clipboard ? 'rgba(16, 185, 129, 0.1)' : 'rgba(255, 255, 255, 0.04)',
              border: session.permissions.clipboard ? '1px solid rgba(16, 185, 129, 0.3)' : '1px solid var(--border-subtle)',
              fontSize: 12,
              color: session.permissions.clipboard ? '#e2e8f0' : 'var(--text-dim)'
            }}>
              <Clipboard size={15} color={session.permissions.clipboard ? '#10b981' : 'var(--text-dim)'} />
              <span>Clipboard Sync: {session.permissions.clipboard ? 'Active' : 'Disabled'}</span>
            </div>

            {session.permissions.fileTransfer && (
              <div
                onClick={onOpenFileTransfer}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 8,
                  padding: '10px 12px',
                  borderRadius: 8,
                  background: 'rgba(6, 182, 212, 0.1)',
                  border: '1px solid rgba(6, 182, 212, 0.3)',
                  fontSize: 12,
                  color: '#38bdf8',
                  cursor: 'pointer'
                }}
                title="Click to manage file transfers"
              >
                <FileUp size={15} color="#06b6d4" />
                <span>File Transfer</span>
              </div>
            )}
          </div>
        </div>

        {/* Host Action Buttons */}
        <div style={{ display: 'flex', gap: 12, marginBottom: 24 }}>
          <button
            onClick={handleToggleInput}
            id="host-toggle-input-btn"
            style={{
              flex: 1,
              padding: '12px 18px',
              borderRadius: 8,
              fontSize: 13,
              fontWeight: 600,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              gap: 8,
              cursor: 'pointer',
              background: inputAllowed ? 'rgba(239, 68, 68, 0.15)' : 'rgba(16, 185, 129, 0.2)',
              color: inputAllowed ? '#f87171' : '#10b981',
              border: inputAllowed ? '1px solid rgba(239, 68, 68, 0.4)' : '1px solid #10b981',
              transition: 'all 0.15s ease'
            }}
          >
            {inputAllowed ? <ShieldAlert size={16} /> : <ShieldCheck size={16} />}
            {inputAllowed ? 'Revoke Remote Input Control' : 'Grant Remote Input Control'}
          </button>

          <button
            onClick={onDisconnect}
            id="host-disconnect-btn"
            className="btn-danger"
            style={{
              padding: '12px 24px',
              fontSize: 13,
              display: 'flex',
              alignItems: 'center',
              gap: 8
            }}
          >
            <PhoneOff size={16} />
            Disconnect Session
          </button>
        </div>

        {/* Safety Note & Shortcut Banner */}
        <div style={{
          display: 'flex',
          alignItems: 'center',
          gap: 12,
          padding: '12px 16px',
          background: 'rgba(6, 182, 212, 0.05)',
          border: '1px solid rgba(6, 182, 212, 0.2)',
          borderRadius: 10,
          fontSize: 12,
          color: 'var(--text-muted)'
        }}>
          <Shield size={18} color="var(--accent-cyan)" style={{ flexShrink: 0 }} />
          <span>
            <strong style={{ color: '#fff' }}>Emergency Killswitch:</strong> Press{' '}
            <kbd style={{ background: 'rgba(255, 255, 255, 0.1)', padding: '2px 6px', borderRadius: 4, color: '#e2e8f0', fontFamily: 'var(--font-mono)' }}>
              Ctrl + Alt + Shift + Esc
            </kbd>{' '}
            at any time to immediately revoke remote control and terminate all access.
          </span>
        </div>
      </div>
      )}
    </div>
  );
};
