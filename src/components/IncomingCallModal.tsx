// src/components/IncomingCallModal.tsx
import React, { useState } from 'react';
import {
  ShieldAlert,
  Check,
  X,
  MousePointer,
  Clipboard,
  FileText,
  Eye,
  AlertTriangle
} from 'lucide-react';
import { IncomingCallData, SessionPermissions } from '../types';

interface IncomingCallModalProps {
  callData: IncomingCallData;
  onAccept: (grantedPermissions: SessionPermissions) => void;
  onReject: (reason?: string) => void;
}

export const IncomingCallModal: React.FC<IncomingCallModalProps> = ({
  callData,
  onAccept,
  onReject
}) => {
  const [permissions, setPermissions] = useState<SessionPermissions>({
    view: true,
    input: callData.requestedPermissions?.input ?? false,
    clipboard: callData.requestedPermissions?.clipboard ?? false,
    fileTransfer: callData.requestedPermissions?.fileTransfer ?? false
  });

  return (
    <div className="modal-overlay" id="incoming-call-modal">
      <div className="glass-panel-elevated modal-content" style={{ width: '100%', maxWidth: 460, padding: 28 }}>
        {/* Header with security icon */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 14, marginBottom: 20 }}>
          <div style={{
            width: 44,
            height: 44,
            borderRadius: 12,
            background: 'rgba(244, 63, 94, 0.15)',
            border: '1px solid rgba(244, 63, 94, 0.4)',
            color: '#f43f5e',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            boxShadow: '0 0 20px rgba(244, 63, 94, 0.3)'
          }}>
            <ShieldAlert size={24} />
          </div>

          <div>
            <h2 style={{ fontFamily: 'var(--font-heading)', fontSize: 18, fontWeight: 700, color: '#fff' }}>
              Incoming Remote Connection
            </h2>
            <p style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 2 }}>
              A remote partner is requesting desktop access
            </p>
          </div>
        </div>

        {/* Requester Identity Card */}
        <div style={{
          background: 'rgba(7, 9, 14, 0.9)',
          border: '1px solid var(--border-subtle)',
          borderRadius: 12,
          padding: 16,
          marginBottom: 20
        }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 6 }}>
            <span style={{ fontSize: 11, color: 'var(--text-dim)', textTransform: 'uppercase', letterSpacing: 0.8 }}>
              Requesting Device ID
            </span>
            <span style={{ fontSize: 11, color: '#10b981', fontWeight: 600 }}>Authenticated</span>
          </div>

          <div style={{ fontFamily: 'var(--font-mono)', fontSize: 22, fontWeight: 700, color: '#38bdf8', letterSpacing: 2 }}>
            {callData.callerId}
          </div>

          <div style={{ fontSize: 13, color: 'var(--text-muted)', marginTop: 4 }}>
            Computer Name: <strong style={{ color: '#fff' }}>{callData.callerName || 'Unknown Device'}</strong>
          </div>
        </div>

        {/* Granular Permission Checklist */}
        <div style={{ marginBottom: 24 }}>
          <span style={{ fontSize: 12, fontWeight: 600, color: '#fff', display: 'block', marginBottom: 10 }}>
            Authorize Permissions for this Session:
          </span>

          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            <div style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              padding: '10px 14px',
              background: 'rgba(255, 255, 255, 0.03)',
              borderRadius: 8,
              border: '1px solid var(--border-subtle)'
            }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                <Eye size={16} color="#06b6d4" />
                <div>
                  <div style={{ fontSize: 13, fontWeight: 600, color: '#fff' }}>View Desktop Screen</div>
                  <div style={{ fontSize: 11, color: 'var(--text-dim)' }}>Stream real-time screen display</div>
                </div>
              </div>
              <span style={{ fontSize: 11, color: '#06b6d4', fontWeight: 600 }}>Required</span>
            </div>

            <label style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              padding: '10px 14px',
              background: 'rgba(255, 255, 255, 0.03)',
              borderRadius: 8,
              border: '1px solid var(--border-subtle)',
              cursor: 'pointer'
            }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                <MousePointer size={16} color={permissions.input ? '#10b981' : '#64748b'} />
                <div>
                  <div style={{ fontSize: 13, fontWeight: 600, color: '#fff' }}>Control Mouse & Keyboard</div>
                  <div style={{ fontSize: 11, color: 'var(--text-dim)' }}>Allow remote input injection on host</div>
                </div>
              </div>
              <input
                type="checkbox"
                id="perm-allow-input-checkbox"
                checked={permissions.input}
                onChange={(e) => setPermissions({ ...permissions, input: e.target.checked })}
                style={{ width: 16, height: 16, accentColor: '#10b981', cursor: 'pointer' }}
              />
            </label>

            <label style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              padding: '10px 14px',
              background: 'rgba(255, 255, 255, 0.03)',
              borderRadius: 8,
              border: '1px solid var(--border-subtle)',
              cursor: 'pointer'
            }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                <Clipboard size={16} color={permissions.clipboard ? '#10b981' : '#64748b'} />
                <div>
                  <div style={{ fontSize: 13, fontWeight: 600, color: '#fff' }}>Clipboard Synchronization</div>
                  <div style={{ fontSize: 11, color: 'var(--text-dim)' }}>Share copied text bidirectionally</div>
                </div>
              </div>
              <input
                type="checkbox"
                id="perm-allow-clipboard-checkbox"
                checked={permissions.clipboard}
                onChange={(e) => setPermissions({ ...permissions, clipboard: e.target.checked })}
                style={{ width: 16, height: 16, accentColor: '#10b981', cursor: 'pointer' }}
              />
            </label>

            <label style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              padding: '10px 14px',
              background: 'rgba(255, 255, 255, 0.03)',
              borderRadius: 8,
              border: '1px solid var(--border-subtle)',
              cursor: 'pointer'
            }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                <FileText size={16} color={permissions.fileTransfer ? '#10b981' : '#64748b'} />
                <div>
                  <div style={{ fontSize: 13, fontWeight: 600, color: '#fff' }}>File Transfer</div>
                  <div style={{ fontSize: 11, color: 'var(--text-dim)' }}>Exchange files with integrity checks</div>
                </div>
              </div>
              <input
                type="checkbox"
                id="perm-allow-filetransfer-checkbox"
                checked={permissions.fileTransfer}
                onChange={(e) => setPermissions({ ...permissions, fileTransfer: e.target.checked })}
                style={{ width: 16, height: 16, accentColor: '#10b981', cursor: 'pointer' }}
              />
            </label>
          </div>
        </div>

        {/* Security Alert Note */}
        <div style={{
          display: 'flex',
          alignItems: 'center',
          gap: 8,
          fontSize: 11,
          color: '#fbbf24',
          background: 'rgba(245, 158, 11, 0.1)',
          padding: '8px 12px',
          borderRadius: 8,
          marginBottom: 20
        }}>
          <AlertTriangle size={14} />
          <span>You can revoke control or disconnect immediately at any time during the session.</span>
        </div>

        {/* Accept and Reject Buttons */}
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
          <button
            onClick={() => onReject('User declined the connection')}
            id="reject-call-btn"
            className="btn-danger"
            style={{ width: '100%' }}
          >
            <X size={16} />
            Reject
          </button>

          <button
            onClick={() => onAccept(permissions)}
            id="accept-call-btn"
            style={{
              background: 'linear-gradient(135deg, #10b981 0%, #059669 100%)',
              color: 'white',
              border: 'none',
              fontFamily: 'var(--font-heading)',
              fontWeight: 600,
              fontSize: 14,
              padding: '10px 20px',
              borderRadius: 10,
              cursor: 'pointer',
              display: 'inline-flex',
              alignItems: 'center',
              justifyContent: 'center',
              gap: 8,
              boxShadow: '0 4px 14px rgba(16, 185, 129, 0.35)',
              transition: 'all 0.2s ease'
            }}
          >
            <Check size={16} />
            Accept & Connect
          </button>
        </div>
      </div>
    </div>
  );
};
