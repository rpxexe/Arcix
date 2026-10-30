// src/components/TransferList.tsx
import React from 'react';
import { ArrowUp, ArrowDown, X, CheckCircle2, AlertCircle } from 'lucide-react';
import { FileTransferItem } from '../types';

export const formatBytes = (bytes: number) => {
  if (bytes < 1024) return bytes + ' B';
  else if (bytes < 1048576) return (bytes / 1024).toFixed(1) + ' KB';
  else if (bytes < 1073741824) return (bytes / 1048576).toFixed(1) + ' MB';
  else return (bytes / 1073741824).toFixed(2) + ' GB';
};

const formatEta = (seconds: number) => {
  if (!isFinite(seconds)) return '';
  if (seconds < 60) return `${Math.ceil(seconds)}s left`;
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m ${Math.ceil(seconds % 60)}s left`;
  return `${Math.floor(seconds / 3600)}h ${Math.floor((seconds % 3600) / 60)}m left`;
};

export const transferPercent = (t: FileTransferItem) =>
  t.totalBytes ? Math.min(100, Math.floor((t.transferredBytes / t.totalBytes) * 100)) : t.status === 'done' ? 100 : 0;

// One-line status: sizes, speed and time left while active; outcome once finished
export const describeTransfer = (t: FileTransferItem) => {
  // Average speed since the transfer started: steadier ETA than an instantaneous rate
  const elapsed = (Date.now() - t.startedAt) / 1000;
  const speed = elapsed > 0.5 ? t.transferredBytes / elapsed : 0;
  if (t.status === 'active') return `${formatBytes(t.transferredBytes)} of ${formatBytes(t.totalBytes)}${speed ? ` · ${formatBytes(speed)}/s · ${formatEta((t.totalBytes - t.transferredBytes) / speed)}` : ''}`;
  if (t.status === 'queued') return `Waiting · ${formatBytes(t.totalBytes)}`;
  if (t.status === 'done') return `${formatBytes(t.totalBytes)}${t.savedPath ? ` · Saved to ${t.savedPath}` : ''}`;
  return t.error || t.status;
};

export interface TransferSummary {
  title: string;
  detail: string;
  percent: number;
  status: FileTransferItem['status'];
}

// Headline for the session toast: the running transfer (and how many wait behind it) or the last outcome
export const summarizeTransfer = (t: FileTransferItem, waiting: number): TransferSummary => {
  const more = waiting > 0 ? ` (+${waiting} more)` : '';
  const title =
    t.status === 'active' || t.status === 'queued' ? `${t.direction === 'send' ? 'Sending' : 'Receiving'} ${t.fileName}${more}`
    : t.status === 'done' ? (t.direction === 'send' ? `${t.fileName} sent` : `${t.fileName} downloaded`)
    : t.status === 'error' ? `${t.fileName} failed`
    : `${t.fileName} cancelled`;
  return { title, detail: describeTransfer(t), percent: transferPercent(t), status: t.status };
};

const statusColor: Record<FileTransferItem['status'], string> = {
  queued: 'var(--text-dim)',
  active: '#06b6d4',
  done: '#10b981',
  error: '#f43f5e',
  cancelled: 'var(--text-dim)'
};

interface TransferListProps {
  transfers: FileTransferItem[];
  onCancel?: (id: string) => void;
}

export const TransferList: React.FC<TransferListProps> = ({ transfers, onCancel }) => (
  <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
    {transfers.map((t) => {
      const percent = transferPercent(t);
      const detail = describeTransfer(t);
      return (
        <div key={t.id} role="group" aria-label={`${t.direction === 'send' ? 'Sending' : 'Receiving'} ${t.fileName}`}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 12, marginBottom: 4 }}>
            {t.direction === 'send' ? <ArrowUp size={13} color="#38bdf8" /> : <ArrowDown size={13} color="#10b981" />}
            <span style={{ flex: 1, minWidth: 0, color: '#fff', fontWeight: 600, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={t.fileName}>
              {t.fileName}
            </span>
            {t.status === 'done' && <CheckCircle2 size={14} color="#10b981" />}
            {t.status === 'error' && <AlertCircle size={14} color="#f43f5e" />}
            <span style={{ color: statusColor[t.status], fontWeight: 600, fontVariantNumeric: 'tabular-nums' }}>{percent}%</span>
            {onCancel && (t.status === 'active' || t.status === 'queued') && (
              <button
                onClick={() => onCancel(t.id)}
                title="Cancel transfer"
                aria-label={`Cancel ${t.fileName}`}
                style={{ background: 'none', border: 'none', color: 'var(--text-muted)', cursor: 'pointer', padding: 2, display: 'flex' }}
              >
                <X size={14} />
              </button>
            )}
          </div>
          <div style={{ height: 5, background: 'rgba(255, 255, 255, 0.1)', borderRadius: 3, overflow: 'hidden' }}>
            <div style={{ height: '100%', width: `${percent}%`, background: statusColor[t.status], transition: 'width 0.1s linear' }} />
          </div>
          <div style={{ fontSize: 11, color: t.status === 'error' ? '#f43f5e' : 'var(--text-dim)', marginTop: 3, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={detail}>
            {detail}
          </div>
        </div>
      );
    })}
  </div>
);
