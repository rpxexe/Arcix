// src/components/FileTransferModal.tsx
import React, { useState } from 'react';
import { X, UploadCloud, File, AlertCircle } from 'lucide-react';
import { WebRTCManager } from '../services/webrtc-manager';
import { FileTransferItem } from '../types';
import { TransferList, formatBytes } from './TransferList';

const MAX_FILE_BYTES = 10 * 1024 * 1024 * 1024;

interface FileTransferModalProps {
  webrtc: WebRTCManager;
  transfers: FileTransferItem[];
  onClose: () => void;
}

export const FileTransferModal: React.FC<FileTransferModalProps> = ({ webrtc, transfers, onClose }) => {
  const [selectedFiles, setSelectedFiles] = useState<File[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [dragOver, setDragOver] = useState(false);

  const addFiles = (files: File[], skippedFolders = 0) => {
    const tooLarge = files.filter((f) => f.size > MAX_FILE_BYTES);
    const ok = files.filter((f) => f.size <= MAX_FILE_BYTES);
    const problems = [
      tooLarge.length ? `${tooLarge.map((f) => f.name).join(', ')} over the 10 GB limit` : '',
      skippedFolders ? `${skippedFolders} folder(s) skipped, drop the files inside instead` : ''
    ].filter(Boolean);
    setError(problems.length ? `Skipped: ${problems.join('; ')}` : null);
    setSelectedFiles((prev) => [...prev, ...ok.filter((f) => !prev.some((p) => p.name === f.name && p.size === f.size))]);
  };

  const handleStartUpload = () => {
    try {
      webrtc.sendFiles(selectedFiles);
      setSelectedFiles([]);
      setError(null);
    } catch (err: any) {
      setError(err.message || 'File transfer failed');
    }
  };

  return (
    <div className="modal-overlay" id="file-transfer-modal">
      <div className="glass-panel-elevated modal-content" style={{ width: '100%', maxWidth: 500, padding: 24, maxHeight: '90vh', overflowY: 'auto' }}>
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

          <button onClick={onClose} className="titlebar-btn" id="close-file-transfer-btn" aria-label="Close">
            <X size={16} />
          </button>
        </div>

        {/* Drag and Drop Zone */}
        <label
          onDragOver={(e) => {
            e.preventDefault();
            e.dataTransfer.dropEffect = 'copy';
            setDragOver(true);
          }}
          onDragLeave={() => setDragOver(false)}
          onDrop={(e) => {
            e.preventDefault();
            setDragOver(false);
            const items = Array.from(e.dataTransfer.items);
            const isFolder = (i: number) => !!items[i]?.webkitGetAsEntry()?.isDirectory;
            const files = Array.from(e.dataTransfer.files);
            addFiles(files.filter((_, i) => !isFolder(i)), files.filter((_, i) => isFolder(i)).length);
          }}
          style={{
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            justifyContent: 'center',
            border: `2px dashed ${dragOver ? '#06b6d4' : 'var(--border-subtle)'}`,
            borderRadius: 12,
            padding: '24px 16px',
            cursor: 'pointer',
            background: dragOver ? 'rgba(6, 182, 212, 0.1)' : 'rgba(255, 255, 255, 0.02)',
            marginBottom: 16,
            transition: 'all 0.15s ease'
          }}
        >
          <UploadCloud size={32} color="#06b6d4" style={{ marginBottom: 8 }} />
          <span style={{ fontSize: 13, fontWeight: 600, color: '#fff' }}>
            {dragOver ? 'Drop to add files' : 'Drag files here or click to select'}
          </span>
          <span style={{ fontSize: 11, color: 'var(--text-dim)', marginTop: 2 }}>
            Multiple files supported · up to 10 GB each
          </span>
          <input
            type="file"
            multiple
            onChange={(e) => {
              addFiles(Array.from(e.target.files || []));
              e.target.value = ''; // allow re-selecting the same file
            }}
            style={{ display: 'none' }}
            id="file-transfer-input"
          />
        </label>

        {selectedFiles.length > 0 && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6, marginBottom: 16 }} id="file-transfer-selected">
            {selectedFiles.map((file, i) => (
              <div key={`${file.name}-${file.size}`} style={{
                display: 'flex',
                alignItems: 'center',
                gap: 8,
                padding: '6px 10px',
                background: 'rgba(255, 255, 255, 0.04)',
                border: '1px solid var(--border-subtle)',
                borderRadius: 8,
                fontSize: 12
              }}>
                <File size={14} color="#94a3b8" />
                <span style={{ flex: 1, minWidth: 0, color: '#fff', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={file.name}>{file.name}</span>
                <span style={{ color: 'var(--text-dim)' }}>{formatBytes(file.size)}</span>
                <button
                  onClick={() => setSelectedFiles(selectedFiles.filter((_, j) => j !== i))}
                  aria-label={`Remove ${file.name}`}
                  title="Remove"
                  style={{ background: 'none', border: 'none', color: 'var(--text-muted)', cursor: 'pointer', padding: 2, display: 'flex' }}
                >
                  <X size={14} />
                </button>
              </div>
            ))}
          </div>
        )}

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

        {transfers.length > 0 && (
          <div style={{ marginBottom: 20 }}>
            <TransferList transfers={transfers} onCancel={(id) => webrtc.cancelTransfer(id)} />
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
            disabled={selectedFiles.length === 0}
            style={{ padding: '8px 16px', fontSize: 13 }}
          >
            Send {selectedFiles.length > 1 ? `${selectedFiles.length} Files` : 'File'}
          </button>
        </div>
      </div>
    </div>
  );
};
