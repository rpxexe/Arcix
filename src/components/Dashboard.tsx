// src/components/Dashboard.tsx
import React, { useState } from 'react';
import {
  Copy,
  Check,
  ArrowRight,
  Shield,
  MousePointer,
  Clipboard,
  FileText,
  Clock,
  Bookmark,
  Sliders,
  Sparkles,
  Zap,
  Eye,
  RefreshCw
} from 'lucide-react';
import { ConnectionState, QualityPreset, RecentSession, SavedDevice, SessionPermissions } from '../types';

interface DashboardProps {
  myDeviceId: string;
  connectionState: ConnectionState;
  recentSessions: RecentSession[];
  savedDevices: SavedDevice[];
  onConnect: (targetId: string, perms: SessionPermissions, quality: QualityPreset) => void;
  onOpenSettings: () => void;
}

export const Dashboard: React.FC<DashboardProps> = ({
  myDeviceId,
  connectionState,
  recentSessions,
  savedDevices,
  onConnect,
  onOpenSettings
}) => {
  const [remoteId, setRemoteId] = useState('');
  const [copied, setCopied] = useState(false);
  const [activeTab, setActiveTab] = useState<'recent' | 'saved'>('recent');

  // Connection settings
  const [permissions, setPermissions] = useState<SessionPermissions>({
    view: true,
    input: true,
    clipboard: true,
    fileTransfer: true
  });
  const [quality, setQuality] = useState<QualityPreset>('balanced');

  const handleCopyId = () => {
    if (!myDeviceId) return;
    navigator.clipboard.writeText(myDeviceId.replace(/\s+/g, ''));
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const handleIdChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const raw = e.target.value.replace(/\D/g, '').slice(0, 9);
    // Format as 3-3-3
    let formatted = raw;
    if (raw.length > 6) {
      formatted = `${raw.slice(0, 3)} ${raw.slice(3, 6)} ${raw.slice(6)}`;
    } else if (raw.length > 3) {
      formatted = `${raw.slice(0, 3)} ${raw.slice(3)}`;
    }
    setRemoteId(formatted);
  };

  const handleConnectSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const cleanId = remoteId.replace(/\s+/g, '');
    if (cleanId.length === 9) {
      onConnect(cleanId, permissions, quality);
    }
  };

  return (
    <div style={{
      display: 'flex',
      flexDirection: 'column',
      gap: 24,
      padding: '28px 32px',
      maxWidth: 1100,
      margin: '0 auto',
      width: '100%',
      height: 'calc(100vh - 38px)',
      overflowY: 'auto'
    }}>
      {/* Top Banner & Quick Controls */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <div>
          <h1 style={{ fontFamily: 'var(--font-heading)', fontSize: 26, fontWeight: 700, color: '#fff' }}>
            AeroDesk Control Center
          </h1>
          <p style={{ color: 'var(--text-muted)', fontSize: 13, marginTop: 4 }}>
            High-Performance Real-Time Screen Sharing & Native Control
          </p>
        </div>
        <div style={{ display: 'flex', gap: 10 }}>
          <button
            onClick={onOpenSettings}
            className="btn-secondary"
            id="dashboard-settings-btn"
            style={{ padding: '8px 16px', fontSize: 13 }}
          >
            <Sliders size={16} />
            Preferences & Logs
          </button>
        </div>
      </div>

      {/* Main Dual Cards Grid */}
      <div style={{
        display: 'grid',
        gridTemplateColumns: 'repeat(auto-fit, minmax(380px, 1fr))',
        gap: 24
      }}>
        {/* THIS DEVICE CARD */}
        <div className="glass-panel" style={{ padding: 24, position: 'relative', overflow: 'hidden' }}>
          <div style={{
            position: 'absolute',
            top: -40,
            right: -40,
            width: 140,
            height: 140,
            borderRadius: '50%',
            background: 'radial-gradient(circle, rgba(6, 182, 212, 0.15) 0%, transparent 70%)',
            pointerEvents: 'none'
          }} />

          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 16 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <div style={{
                width: 32,
                height: 32,
                borderRadius: 8,
                background: 'rgba(6, 182, 212, 0.15)',
                color: '#06b6d4',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center'
              }}>
                <Shield size={18} />
              </div>
              <span style={{ fontWeight: 600, fontSize: 15, color: '#fff' }}>This Device</span>
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12 }}>
              <div className="online-pulse" />
              <span style={{ color: '#10b981', fontWeight: 600 }}>Ready to Connect</span>
            </div>
          </div>

          <p style={{ fontSize: 13, color: 'var(--text-muted)', marginBottom: 16 }}>
            Provide this unique 9-digit address to authorized partners to allow incoming remote desktop sessions.
          </p>

          <div style={{
            background: 'rgba(7, 9, 14, 0.85)',
            border: '1px solid rgba(6, 182, 212, 0.25)',
            borderRadius: 12,
            padding: '16px 20px',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            marginBottom: 20
          }}>
            <div>
              <span style={{ fontSize: 11, textTransform: 'uppercase', color: 'var(--text-dim)', letterSpacing: 1 }}>
                Connection ID
              </span>
              <div className="device-id-badge" id="this-device-id-display">
                {myDeviceId || 'Generating...'}
              </div>
            </div>

            <button
              onClick={handleCopyId}
              id="copy-my-id-btn"
              style={{
                background: copied ? 'rgba(16, 185, 129, 0.2)' : 'rgba(255, 255, 255, 0.08)',
                color: copied ? '#10b981' : '#e2e8f0',
                border: copied ? '1px solid #10b981' : '1px solid rgba(255, 255, 255, 0.1)',
                padding: '10px 14px',
                borderRadius: 8,
                cursor: 'pointer',
                display: 'flex',
                alignItems: 'center',
                gap: 6,
                fontWeight: 600,
                fontSize: 13,
                transition: 'all 0.15s ease'
              }}
            >
              {copied ? <Check size={16} /> : <Copy size={16} />}
              {copied ? 'Copied!' : 'Copy'}
            </button>
          </div>

          <div style={{
            borderTop: '1px solid var(--border-subtle)',
            paddingTop: 16,
            display: 'flex',
            justifyContent: 'space-between',
            fontSize: 12,
            color: 'var(--text-dim)'
          }}>
            <span>Operating System: Windows 11 (x64)</span>
            <span>Security: DTLS-SRTP End-to-End</span>
          </div>
        </div>

        {/* REMOTE DEVICE CONNECTION CARD */}
        <div className="glass-panel" style={{ padding: 24, position: 'relative', overflow: 'hidden' }}>
          <div style={{
            position: 'absolute',
            top: -40,
            right: -40,
            width: 140,
            height: 140,
            borderRadius: '50%',
            background: 'radial-gradient(circle, rgba(59, 130, 246, 0.15) 0%, transparent 70%)',
            pointerEvents: 'none'
          }} />

          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 16 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <div style={{
                width: 32,
                height: 32,
                borderRadius: 8,
                background: 'rgba(59, 130, 246, 0.15)',
                color: '#3b82f6',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center'
              }}>
                <Zap size={18} />
              </div>
              <span style={{ fontWeight: 600, fontSize: 15, color: '#fff' }}>Connect to Remote Desk</span>
            </div>
            <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>Direct WebRTC</span>
          </div>

          <form onSubmit={handleConnectSubmit}>
            <div style={{ marginBottom: 16 }}>
              <label style={{ display: 'block', fontSize: 12, color: 'var(--text-muted)', marginBottom: 8 }}>
                Enter 9-Digit Remote ID
              </label>
              <div style={{ display: 'flex', gap: 10 }}>
                <input
                  type="text"
                  id="remote-device-id-input"
                  placeholder="000 000 000"
                  value={remoteId}
                  onChange={handleIdChange}
                  style={{
                    flex: 1,
                    background: 'rgba(7, 9, 14, 0.85)',
                    border: '1px solid var(--border-subtle)',
                    borderRadius: 10,
                    padding: '12px 16px',
                    color: '#fff',
                    fontFamily: 'var(--font-mono)',
                    fontSize: 20,
                    fontWeight: 600,
                    letterSpacing: 2,
                    outline: 'none',
                    transition: 'border-color 0.2s'
                  }}
                  onFocus={(e) => e.target.style.borderColor = 'var(--accent-cyan)'}
                  onBlur={(e) => e.target.style.borderColor = 'var(--border-subtle)'}
                />

                <button
                  type="submit"
                  id="connect-remote-btn"
                  className="btn-primary"
                  disabled={remoteId.replace(/\s+/g, '').length !== 9 || connectionState === 'calling' || connectionState === 'connecting'}
                  style={{ minWidth: 120 }}
                >
                  {connectionState === 'calling' || connectionState === 'connecting' ? (
                    <>
                      <RefreshCw size={16} className="animate-spin" />
                      Calling...
                    </>
                  ) : (
                    <>
                      Connect
                      <ArrowRight size={16} />
                    </>
                  )}
                </button>
              </div>
            </div>

            {/* Granular Permission Presets */}
            <div style={{ marginBottom: 16 }}>
              <span style={{ fontSize: 11, color: 'var(--text-dim)', textTransform: 'uppercase', letterSpacing: 0.8, display: 'block', marginBottom: 8 }}>
                Requested Capabilities
              </span>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
                <label style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 6,
                  padding: '6px 10px',
                  background: permissions.input ? 'rgba(6, 182, 212, 0.15)' : 'rgba(255, 255, 255, 0.05)',
                  border: permissions.input ? '1px solid rgba(6, 182, 212, 0.4)' : '1px solid var(--border-subtle)',
                  borderRadius: 6,
                  fontSize: 12,
                  cursor: 'pointer',
                  color: permissions.input ? '#38bdf8' : 'var(--text-muted)'
                }}>
                  <input
                    type="checkbox"
                    checked={permissions.input}
                    onChange={(e) => setPermissions({ ...permissions, input: e.target.checked })}
                    style={{ accentColor: '#06b6d4' }}
                  />
                  <MousePointer size={13} />
                  Remote Input
                </label>

                <label style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 6,
                  padding: '6px 10px',
                  background: permissions.clipboard ? 'rgba(6, 182, 212, 0.15)' : 'rgba(255, 255, 255, 0.05)',
                  border: permissions.clipboard ? '1px solid rgba(6, 182, 212, 0.4)' : '1px solid var(--border-subtle)',
                  borderRadius: 6,
                  fontSize: 12,
                  cursor: 'pointer',
                  color: permissions.clipboard ? '#38bdf8' : 'var(--text-muted)'
                }}>
                  <input
                    type="checkbox"
                    checked={permissions.clipboard}
                    onChange={(e) => setPermissions({ ...permissions, clipboard: e.target.checked })}
                    style={{ accentColor: '#06b6d4' }}
                  />
                  <Clipboard size={13} />
                  Clipboard Sync
                </label>

                <label style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 6,
                  padding: '6px 10px',
                  background: permissions.fileTransfer ? 'rgba(6, 182, 212, 0.15)' : 'rgba(255, 255, 255, 0.05)',
                  border: permissions.fileTransfer ? '1px solid rgba(6, 182, 212, 0.4)' : '1px solid var(--border-subtle)',
                  borderRadius: 6,
                  fontSize: 12,
                  cursor: 'pointer',
                  color: permissions.fileTransfer ? '#38bdf8' : 'var(--text-muted)'
                }}>
                  <input
                    type="checkbox"
                    checked={permissions.fileTransfer}
                    onChange={(e) => setPermissions({ ...permissions, fileTransfer: e.target.checked })}
                    style={{ accentColor: '#06b6d4' }}
                  />
                  <FileText size={13} />
                  File Transfer
                </label>
              </div>
            </div>

            {/* Quality Preset Buttons */}
            <div>
              <span style={{ fontSize: 11, color: 'var(--text-dim)', textTransform: 'uppercase', letterSpacing: 0.8, display: 'block', marginBottom: 8 }}>
                Streaming Profile
              </span>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 8 }}>
                {(['speed', 'balanced', 'quality'] as QualityPreset[]).map((q) => (
                  <button
                    key={q}
                    type="button"
                    onClick={() => setQuality(q)}
                    style={{
                      padding: '6px 10px',
                      background: quality === q ? 'rgba(56, 189, 248, 0.15)' : 'rgba(255, 255, 255, 0.04)',
                      border: quality === q ? '1px solid #38bdf8' : '1px solid var(--border-subtle)',
                      borderRadius: 6,
                      color: quality === q ? '#38bdf8' : 'var(--text-muted)',
                      fontSize: 12,
                      fontWeight: 600,
                      cursor: 'pointer',
                      textTransform: 'capitalize'
                    }}
                  >
                    {q === 'speed' ? '⚡ Low Latency' : q === 'balanced' ? '⚖ Balanced' : '💎 Ultra HD'}
                  </button>
                ))}
              </div>
            </div>
          </form>
        </div>
      </div>

      {/* Recent Sessions & Saved Devices Section */}
      <div className="glass-panel" style={{ padding: 20 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 16, borderBottom: '1px solid var(--border-subtle)', paddingBottom: 12, marginBottom: 16 }}>
          <button
            onClick={() => setActiveTab('recent')}
            id="tab-recent-sessions"
            style={{
              background: 'none',
              border: 'none',
              color: activeTab === 'recent' ? '#38bdf8' : 'var(--text-muted)',
              fontWeight: 600,
              fontSize: 14,
              cursor: 'pointer',
              display: 'flex',
              alignItems: 'center',
              gap: 6,
              borderBottom: activeTab === 'recent' ? '2px solid #38bdf8' : '2px solid transparent',
              paddingBottom: 8
            }}
          >
            <Clock size={16} />
            Recent Sessions ({recentSessions.length})
          </button>

          <button
            onClick={() => setActiveTab('saved')}
            id="tab-saved-devices"
            style={{
              background: 'none',
              border: 'none',
              color: activeTab === 'saved' ? '#38bdf8' : 'var(--text-muted)',
              fontWeight: 600,
              fontSize: 14,
              cursor: 'pointer',
              display: 'flex',
              alignItems: 'center',
              gap: 6,
              borderBottom: activeTab === 'saved' ? '2px solid #38bdf8' : '2px solid transparent',
              paddingBottom: 8
            }}
          >
            <Bookmark size={16} />
            Saved Devices ({savedDevices.length})
          </button>
        </div>

        {activeTab === 'recent' ? (
          <div>
            {recentSessions.length === 0 ? (
              <div style={{ textAlign: 'center', padding: '30px 0', color: 'var(--text-dim)', fontSize: 13 }}>
                No recent remote sessions. Enter an authorized 9-digit ID above to connect.
              </div>
            ) : (
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))', gap: 12 }}>
                {recentSessions.map((session) => (
                  <div
                    key={session.id}
                    style={{
                      background: 'rgba(255, 255, 255, 0.03)',
                      border: '1px solid var(--border-subtle)',
                      borderRadius: 10,
                      padding: 14,
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'space-between',
                      transition: 'all 0.15s ease'
                    }}
                  >
                    <div>
                      <div style={{ fontWeight: 600, color: '#fff', fontSize: 13 }}>
                        {session.deviceName || 'Windows Workstation'}
                      </div>
                      <div style={{ fontFamily: 'var(--font-mono)', color: '#38bdf8', fontSize: 13, marginTop: 2 }}>
                        {session.deviceId}
                      </div>
                      <div style={{ fontSize: 11, color: 'var(--text-dim)', marginTop: 4 }}>
                        {session.timestamp}
                      </div>
                    </div>
                    <button
                      onClick={() => onConnect(session.deviceId, permissions, quality)}
                      className="btn-secondary"
                      style={{ padding: '6px 12px', fontSize: 12 }}
                    >
                      Connect
                    </button>
                  </div>
                ))}
              </div>
            )}
          </div>
        ) : (
          <div>
            {savedDevices.length === 0 ? (
              <div style={{ textAlign: 'center', padding: '30px 0', color: 'var(--text-dim)', fontSize: 13 }}>
                No saved workstations. Star frequent devices from your session history.
              </div>
            ) : (
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))', gap: 12 }}>
                {savedDevices.map((dev) => (
                  <div
                    key={dev.id}
                    style={{
                      background: 'rgba(255, 255, 255, 0.03)',
                      border: '1px solid var(--border-subtle)',
                      borderRadius: 10,
                      padding: 14,
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'space-between'
                    }}
                  >
                    <div>
                      <div style={{ fontWeight: 600, color: '#fff', fontSize: 13 }}>{dev.alias}</div>
                      <div style={{ fontFamily: 'var(--font-mono)', color: '#38bdf8', fontSize: 13, marginTop: 2 }}>
                        {dev.deviceId}
                      </div>
                    </div>
                    <button
                      onClick={() => onConnect(dev.deviceId, permissions, quality)}
                      className="btn-primary"
                      style={{ padding: '6px 12px', fontSize: 12 }}
                    >
                      Connect
                    </button>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
};
