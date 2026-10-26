// src/components/FileTransferModal.tsx
import React, { useState } from 'react';
import { X, UploadCloud, File, CheckCircle2, AlertCircle, Download } from 'lucide-react';
import { WebRTCManager } from '../services/webrtc-manager';

interface FileTransferModalProps {
  webrtc: WebRTCManager;
  onClose: () => void;
}

export const FileTransferModal: React.FC<FileTransferModalProps> = ({ webrtc, onClose }) => {
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [progress, setProgress] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [completed, setCompleted] = useState<boolean>(false);

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files[0]) {
      const file = e.target.files[0];

      // Validate filename and size (e.g. max 100MB over P2P data channel)
      if (file.size > 100 * 1024 * 1024) {
        setError('File exceeds maximum size of 100 MB');
        return;
      }

      // Check path traversal or illegal characters in filename
      if (file.name.includes('..') || file.name.includes('/') || file.name.includes('\\')) {
        setError('Illegal characters in file name');
        return;
      }

      setSelectedFile(file);
      setError(null);
      setCompleted(false);
      setProgress(null);
    }
  };

  const handleStartUpload = async () => {
    if (!selectedFile) return;
    setError(null);
    setProgress(0);

    try {
      webrtc.setEvents({
        onFileTransferProgress: (_fileName, percent) => {
          setProgress(percent);
          if (percent >= 100) {
            setCompleted(true);
          }
        }
      });

      await webrtc.sendFile(selectedFile);
    } catch (err: any) {
      setError(err.message || 'File transfer failed');
      setProgress(null);
    }
  };

  const formatBytes = (bytes: number) => {
    if (bytes < 1024) return bytes + ' B';
    else if (bytes < 1048576) return (bytes / 1024).toFixed(1) + ' KB';
    else return (bytes / 1048576).toFixed(1) + ' MB';
  };

  return (
    <div className="modal-overlay" id="file-transfer-modal">
      <div className="glass-panel-elevated modal-content" style={{ width: '100%', maxWidth: 460, padding: 24 }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 20 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
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
              <UploadCloud size={18} />
            </div>
            <div>
              <h3 style={{ fontSize: 16, fontWeight: 700, color: '#fff' }}>Secure File Transfer</h3>
              <p style={{ fontSize: 11, color: 'var(--text-muted)' }}>P2P encrypted chunked transmission</p>
            </div>
          </div>

          <button onClick={onClose} className="titlebar-btn" id="close-file-transfer-btn">
            <X size={16} />
          </button>
        </div>

        {/* Drag and Drop Zone */}
        <label style={{
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: 'center',
          border: '2px dashed var(--border-subtle)',
          borderRadius: 12,
          padding: '24px 16px',
          cursor: 'pointer',
          background: 'rgba(255, 255, 255, 0.02)',
          marginBottom: 16,
          transition: 'all 0.15s ease'
        }}>
          <UploadCloud size={32} color="#06b6d4" style={{ marginBottom: 8 }} />
          <span style={{ fontSize: 13, fontWeight: 600, color: '#fff' }}>
            {selectedFile ? selectedFile.name : 'Click to select a file'}
          </span>
          <span style={{ fontSize: 11, color: 'var(--text-dim)', marginTop: 2 }}>
            {selectedFile ? formatBytes(selectedFile.size) : 'Maximum file size: 100 MB'}
          </span>
          <input type="file" onChange={handleFileChange} style={{ display: 'none' }} id="file-transfer-input" />
        </label>

        {error && (
          <div style={{
            display: 'flex',
            alignItems: 'center',
            gap: 8,
            color: '#f43f5e',
            background: 'rgba(244, 63, 94, 0.1)',
            padding: '8px 12px',
            borderRadius: 8,
            fontSize: 12,
            marginBottom: 16
          }}>
            <AlertCircle size={14} />
            {error}
          </div>
        )}

        {/* Progress Bar */}
        {progress !== null && (
          <div style={{ marginBottom: 20 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12, marginBottom: 6 }}>
              <span style={{ color: 'var(--text-muted)' }}>Transfer Progress</span>
              <span style={{ color: '#06b6d4', fontWeight: 600 }}>{progress}%</span>
            </div>
            <div style={{ height: 6, background: 'rgba(255, 255, 255, 0.1)', borderRadius: 3, overflow: 'hidden' }}>
              <div style={{
                height: '100%',
                width: `${progress}%`,
                background: completed ? '#10b981' : '#06b6d4',
                transition: 'width 0.1s linear'
              }} />
            </div>
          </div>
        )}

        {completed && (
          <div style={{
            display: 'flex',
            alignItems: 'center',
            gap: 8,
            color: '#10b981',
            background: 'rgba(16, 185, 129, 0.1)',
            padding: '8px 12px',
            borderRadius: 8,
            fontSize: 12,
            marginBottom: 16
          }}>
            <CheckCircle2 size={16} />
            File transferred successfully to remote device!
          </div>
        )}

        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 10 }}>
          <button onClick={onClose} className="btn-secondary" style={{ padding: '8px 16px', fontSize: 13 }}>
            Done
          </button>
          <button
            onClick={handleStartUpload}
            id="start-upload-btn"
            className="btn-primary"
            disabled={!selectedFile || (progress !== null && progress < 100)}
            style={{ padding: '8px 16px', fontSize: 13 }}
          >
            Start Transfer
          </button>
        </div>
      </div>
    </div>
  );
};
