// src/components/SettingsModal.tsx
import React, { useState, useEffect } from 'react';
import {
  X,
  Sliders,
  Shield,
  Key,
  FileText,
  Palette,
  Check,
  Lock,
  Eye,
  EyeOff,
  Trash2,
  HardDrive
} from 'lucide-react';
import { AuditLogEntry } from '../../electron/preload';
import { getSignalingUrl, getDefaultSignalingUrl, saveSignalingUrl } from '../services/config';

interface SettingsModalProps {
  onClose: () => void;
}

export const SettingsModal: React.FC<SettingsModalProps> = ({ onClose }) => {
  const [activeTab, setActiveTab] = useState<'security' | 'display' | 'logs' | 'theme'>('security');
  const [unattendedEnabled, setUnattendedEnabled] = useState(false);
  const [unattendedPassword, setUnattendedPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [passwordSaved, setPasswordSaved] = useState(false);

  const [requireConsent, setRequireConsent] = useState(true);
  const [auditLogs, setAuditLogs] = useState<AuditLogEntry[]>([]);
  const [serverUrl, setServerUrl] = useState(() => getSignalingUrl());

  useEffect(() => {
    // Load stored settings
    const savedConsent = localStorage.getItem('aerodesk_require_consent');
    if (savedConsent !== null) setRequireConsent(savedConsent === 'true');

    const savedUnattended = localStorage.getItem('aerodesk_unattended_enabled');
    if (savedUnattended === 'true') setUnattendedEnabled(true);

    setServerUrl(getSignalingUrl());

    // Fetch audit logs
    if (window.aeroDeskApi) {
      window.aeroDeskApi.getAuditLogs(30).then((logs) => {
        setAuditLogs(logs);
      });
    }
  }, []);

  const handleSaveSecurity = () => {
    localStorage.setItem('aerodesk_require_consent', requireConsent.toString());
    localStorage.setItem('aerodesk_unattended_enabled', unattendedEnabled.toString());
    saveSignalingUrl(serverUrl);

    if (unattendedPassword) {
      // In a real app we salt and hash before storing
      localStorage.setItem('aerodesk_unattended_hash', btoa(unattendedPassword));
    }

    setPasswordSaved(true);
    setTimeout(() => setPasswordSaved(false), 2000);
  };

  return (
    <div className="modal-overlay" id="settings-modal">
      <div className="glass-panel-elevated modal-content" style={{ width: '100%', maxWidth: 640, height: 520, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
        {/* Header */}
        <div style={{
          padding: '18px 24px',
          borderBottom: '1px solid var(--border-subtle)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between'
        }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <Sliders size={20} color="#06b6d4" />
            <h2 style={{ fontFamily: 'var(--font-heading)', fontSize: 18, fontWeight: 700, color: '#fff' }}>
              AeroDesk Preferences
            </h2>
          </div>
          <button onClick={onClose} className="titlebar-btn" id="close-settings-btn">
            <X size={16} />
          </button>
        </div>

        {/* Body with Sidebar */}
        <div style={{ display: 'flex', flex: 1, overflow: 'hidden' }}>
          {/* Navigation Sidebar */}
          <div style={{
            width: 180,
            borderRight: '1px solid var(--border-subtle)',
            padding: 12,
            display: 'flex',
            flexDirection: 'column',
            gap: 4
          }}>
            <button
              onClick={() => setActiveTab('security')}
              className="btn-secondary"
              id="settings-tab-security"
              style={{
                width: '100%',
                justifyContent: 'flex-start',
                padding: '8px 12px',
                fontSize: 13,
                background: activeTab === 'security' ? 'rgba(6, 182, 212, 0.15)' : 'transparent',
                borderColor: activeTab === 'security' ? '#06b6d4' : 'transparent',
                color: activeTab === 'security' ? '#38bdf8' : 'var(--text-muted)'
              }}
            >
              <Shield size={16} />
              Security
            </button>

            <button
              onClick={() => setActiveTab('display')}
              className="btn-secondary"
              id="settings-tab-display"
              style={{
                width: '100%',
                justifyContent: 'flex-start',
                padding: '8px 12px',
                fontSize: 13,
                background: activeTab === 'display' ? 'rgba(6, 182, 212, 0.15)' : 'transparent',
                borderColor: activeTab === 'display' ? '#06b6d4' : 'transparent',
                color: activeTab === 'display' ? '#38bdf8' : 'var(--text-muted)'
              }}
            >
              <Sliders size={16} />
              Display & Audio
            </button>

            <button
              onClick={() => setActiveTab('logs')}
              className="btn-secondary"
              id="settings-tab-logs"
              style={{
                width: '100%',
                justifyContent: 'flex-start',
                padding: '8px 12px',
                fontSize: 13,
                background: activeTab === 'logs' ? 'rgba(6, 182, 212, 0.15)' : 'transparent',
                borderColor: activeTab === 'logs' ? '#06b6d4' : 'transparent',
                color: activeTab === 'logs' ? '#38bdf8' : 'var(--text-muted)'
              }}
            >
              <FileText size={16} />
              Audit Logs
            </button>

            <button
              onClick={() => setActiveTab('theme')}
              className="btn-secondary"
              id="settings-tab-theme"
              style={{
                width: '100%',
                justifyContent: 'flex-start',
                padding: '8px 12px',
                fontSize: 13,
                background: activeTab === 'theme' ? 'rgba(6, 182, 212, 0.15)' : 'transparent',
                borderColor: activeTab === 'theme' ? '#06b6d4' : 'transparent',
                color: activeTab === 'theme' ? '#38bdf8' : 'var(--text-muted)'
              }}
            >
              <Palette size={16} />
              Branding
            </button>
          </div>

          {/* Main Tab Content */}
          <div style={{ flex: 1, padding: 24, overflowY: 'auto' }}>
            {activeTab === 'security' && (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
                <div>
                  <h3 style={{ fontSize: 15, fontWeight: 600, color: '#fff', marginBottom: 6 }}>
                    Incoming Session Access Control
                  </h3>
                  <label style={{ display: 'flex', alignItems: 'center', gap: 10, fontSize: 13, color: 'var(--text-muted)', cursor: 'pointer' }}>
                    <input
                      type="checkbox"
                      checked={requireConsent}
                      onChange={(e) => setRequireConsent(e.target.checked)}
                      style={{ accentColor: '#06b6d4' }}
                    />
                    Always require explicit interactive confirmation for incoming connections
                  </label>
                </div>

                <div style={{ borderTop: '1px solid var(--border-subtle)', paddingTop: 16 }}>
                  <h3 style={{ fontSize: 15, fontWeight: 600, color: '#fff', marginBottom: 6 }}>
                    Unattended Access
                  </h3>
                  <p style={{ fontSize: 12, color: 'var(--text-dim)', marginBottom: 12 }}>
                    Permits connecting to this workstation when you are away using a high-entropy password.
                  </p>

                  <label style={{ display: 'flex', alignItems: 'center', gap: 10, fontSize: 13, color: 'var(--text-muted)', marginBottom: 12, cursor: 'pointer' }}>
                    <input
                      type="checkbox"
                      checked={unattendedEnabled}
                      onChange={(e) => setUnattendedEnabled(e.target.checked)}
                      style={{ accentColor: '#06b6d4' }}
                    />
                    Enable Password-Protected Unattended Access
                  </label>

                  {unattendedEnabled && (
                    <div style={{ position: 'relative', maxWidth: 300 }}>
                      <input
                        type={showPassword ? 'text' : 'password'}
                        placeholder="Enter access passphrase"
                        value={unattendedPassword}
                        onChange={(e) => setUnattendedPassword(e.target.value)}
                        style={{
                          width: '100%',
                          background: 'rgba(7, 9, 14, 0.85)',
                          border: '1px solid var(--border-subtle)',
                          borderRadius: 8,
                          padding: '10px 14px',
                          color: '#fff',
                          fontSize: 13
                        }}
                      />
                      <button
                        type="button"
                        onClick={() => setShowPassword(!showPassword)}
                        style={{
                          position: 'absolute',
                          right: 10,
                          top: '50%',
                          transform: 'translateY(-50%)',
                          background: 'none',
                          border: 'none',
                          color: 'var(--text-dim)',
                          cursor: 'pointer'
                        }}
                      >
                        {showPassword ? <EyeOff size={16} /> : <Eye size={16} />}
                      </button>
                    </div>
                  )}
                </div>

                <div style={{ borderTop: '1px solid var(--border-subtle)', paddingTop: 16 }}>
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 6 }}>
                    <h3 style={{ fontSize: 15, fontWeight: 600, color: '#fff', margin: 0 }}>
                      Signaling Gateway Server
                    </h3>
                    <span style={{
                      fontSize: 11,
                      padding: '2px 8px',
                      borderRadius: 4,
                      background: serverUrl === getDefaultSignalingUrl() ? 'rgba(16, 185, 129, 0.15)' : 'rgba(245, 158, 11, 0.15)',
                      color: serverUrl === getDefaultSignalingUrl() ? '#10b981' : '#f59e0b',
                      border: `1px solid ${serverUrl === getDefaultSignalingUrl() ? 'rgba(16, 185, 129, 0.3)' : 'rgba(245, 158, 11, 0.3)'}`
                    }}>
                      {serverUrl === getDefaultSignalingUrl() ? 'Using .env Default' : 'Custom Override'}
                    </span>
                  </div>
                  <p style={{ fontSize: 12, color: 'var(--text-dim)', marginBottom: 8 }}>
                    WebSocket server used for peer discovery, DTLS-SRTP negotiation, and NAT traversal.
                  </p>
                  <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                    <input
                      type="text"
                      value={serverUrl}
                      onChange={(e) => setServerUrl(e.target.value)}
                      placeholder={getDefaultSignalingUrl()}
                      style={{
                        flex: 1,
                        maxWidth: 380,
                        background: 'rgba(7, 9, 14, 0.85)',
                        border: '1px solid var(--border-subtle)',
                        borderRadius: 8,
                        padding: '10px 14px',
                        color: '#fff',
                        fontSize: 13,
                        fontFamily: 'var(--font-mono)'
                      }}
                    />
                    {serverUrl !== getDefaultSignalingUrl() && (
                      <button
                        type="button"
                        onClick={() => setServerUrl(getDefaultSignalingUrl())}
                        className="btn-secondary"
                        style={{ padding: '8px 12px', fontSize: 12 }}
                        title="Revert to default specified in .env"
                      >
                        Reset to .env
                      </button>
                    )}
                  </div>
                </div>

                <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginTop: 10 }}>
                  <button onClick={handleSaveSecurity} className="btn-primary" style={{ padding: '8px 18px', fontSize: 13 }}>
                    Save Preferences
                  </button>
                  {passwordSaved && (
                    <span style={{ fontSize: 12, color: '#10b981', display: 'flex', alignItems: 'center', gap: 4 }}>
                      <Check size={14} /> Saved!
                    </span>
                  )}
                </div>
              </div>
            )}

            {activeTab === 'display' && (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
                <div>
                  <h3 style={{ fontSize: 15, fontWeight: 600, color: '#fff', marginBottom: 6 }}>
                    Hardware Acceleration
                  </h3>
                  <p style={{ fontSize: 12, color: 'var(--text-muted)' }}>
                    Utilizes Windows DXGI / NVENC / Intel QuickSync hardware encoders when available.
                  </p>
                </div>
                <div style={{ borderTop: '1px solid var(--border-subtle)', paddingTop: 16 }}>
                  <h3 style={{ fontSize: 15, fontWeight: 600, color: '#fff', marginBottom: 6 }}>
                    Audio Forwarding
                  </h3>
                  <label style={{ display: 'flex', alignItems: 'center', gap: 10, fontSize: 13, color: 'var(--text-muted)', cursor: 'pointer' }}>
                    <input type="checkbox" defaultChecked style={{ accentColor: '#06b6d4' }} />
                    Forward system audio to authorized viewer
                  </label>
                </div>
              </div>
            )}

            {activeTab === 'logs' && (
              <div>
                <h3 style={{ fontSize: 15, fontWeight: 600, color: '#fff', marginBottom: 10 }}>
                  Recent Audit Ledger
                </h3>
                {auditLogs.length === 0 ? (
                  <div style={{ fontSize: 12, color: 'var(--text-dim)', textAlign: 'center', padding: '30px 0' }}>
                    No session logs found. Log records will be saved here in accordance with security policy.
                  </div>
                ) : (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                    {auditLogs.map((log, idx) => (
                      <div
                        key={idx}
                        style={{
                          background: 'rgba(255, 255, 255, 0.02)',
                          border: '1px solid var(--border-subtle)',
                          borderRadius: 8,
                          padding: 10,
                          fontSize: 12
                        }}
                      >
                        <div style={{ display: 'flex', justifyContent: 'space-between', color: '#fff', fontWeight: 600 }}>
                          <span>{log.type.replace('_', ' ').toUpperCase()}</span>
                          <span style={{ color: log.status === 'accepted' ? '#10b981' : '#f43f5e' }}>{log.status}</span>
                        </div>
                        <div style={{ color: '#38bdf8', fontFamily: 'var(--font-mono)', marginTop: 2 }}>
                          Peer: {log.peerId}
                        </div>
                        <div style={{ color: 'var(--text-dim)', fontSize: 10, marginTop: 4 }}>
                          {log.timestamp}
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}

            {activeTab === 'theme' && (
              <div>
                <h3 style={{ fontSize: 15, fontWeight: 600, color: '#fff', marginBottom: 8 }}>
                  Original Aero Branding
                </h3>
                <p style={{ fontSize: 12, color: 'var(--text-muted)', marginBottom: 16 }}>
                  AeroDesk features original high-contrast dark mode with electric cyan and obsidian tones.
                </p>
                <div style={{ display: 'flex', gap: 12 }}>
                  <div style={{
                    width: 100,
                    height: 60,
                    borderRadius: 8,
                    background: '#07090e',
                    border: '2px solid #06b6d4',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    fontSize: 11,
                    fontWeight: 600,
                    color: '#fff'
                  }}>
                    Cyber Dark
                  </div>
                </div>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};
