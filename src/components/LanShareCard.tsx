// src/components/LanShareCard.tsx
import React, { useState, useEffect } from 'react';
import { FolderOpen, Folder, File, Download, Network, ArrowLeft, StopCircle, Check } from 'lucide-react';
import { LanSharePeer, LanShareEntry } from '../../electron/preload';

const formatBytes = (bytes: number) => {
  if (bytes < 1024) return bytes + ' B';
  else if (bytes < 1048576) return (bytes / 1024).toFixed(1) + ' KB';
  else return (bytes / 1048576).toFixed(1) + ' MB';
};

const rowStyle: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: 10,
  width: '100%',
  padding: '8px 12px',
  background: 'rgba(255, 255, 255, 0.03)',
  border: '1px solid var(--border-subtle)',
  borderRadius: 8,
  color: '#e2e8f0',
  fontSize: 13,
  cursor: 'pointer',
  textAlign: 'left'
};

export const LanShareCard: React.FC = () => {
  const api = window.aeroDeskApi;
  const [sharedDir, setSharedDir] = useState<string | null>(null);
  const [peers, setPeers] = useState<LanSharePeer[]>([]);
  const [browsing, setBrowsing] = useState<{ peer: LanSharePeer; path: string[] } | null>(null);
  const [entries, setEntries] = useState<LanShareEntry[]>([]);
  const [status, setStatus] = useState<string | null>(null);

  useEffect(() => {
    api?.getLanShareStatus().then(setSharedDir);
    const poll = () => api?.getLanSharePeers().then(setPeers);
    poll();
    const timer = setInterval(poll, 3000);
    return () => clearInterval(timer);
  }, []);

  useEffect(() => {
    if (!browsing || !api) return;
    setEntries([]);
    api.listLanShare(browsing.peer.id, browsing.path.join('/'))
      .then((list) => setEntries(list.sort((a, b) => Number(b.dir) - Number(a.dir) || a.name.localeCompare(b.name))))
      .catch((err) => setStatus(err.message || 'Could not open folder'));
  }, [browsing]);

  const openEntry = async (entry: LanShareEntry) => {
    if (!browsing || !api) return;
    const rel = [...browsing.path, entry.name];
    if (entry.dir) {
      setBrowsing({ ...browsing, path: rel });
      return;
    }
    setStatus(`Downloading ${entry.name}…`);
    try {
      setStatus(`Saved to ${await api.downloadLanShareFile(browsing.peer.id, rel.join('/'))}`);
    } catch (err: any) {
      setStatus(err.message || 'Download failed');
    }
  };

  if (!api) return null;

  return (
    <div className="glass-panel" style={{ padding: 20 }} id="lan-share-card">
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap', marginBottom: 16 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <Network size={18} color="#06b6d4" />
          <span style={{ fontWeight: 600, fontSize: 15, color: '#fff' }}>LAN File Sharing</span>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, minWidth: 0 }}>
          {sharedDir && (
            <span title={sharedDir} style={{ fontSize: 12, color: '#10b981', display: 'flex', alignItems: 'center', gap: 4, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: 360 }}>
              <Check size={14} /> Sharing {sharedDir}
            </span>
          )}
          <button className="btn-secondary" id="lan-share-pick-btn" style={{ padding: '6px 12px', fontSize: 12 }} onClick={() => api.pickLanShareFolder().then(setSharedDir)}>
            <FolderOpen size={14} />
            {sharedDir ? 'Change Folder' : 'Share a Folder'}
          </button>
          {sharedDir && (
            <button className="btn-secondary" id="lan-share-stop-btn" style={{ padding: '6px 12px', fontSize: 12 }} onClick={() => api.stopLanShare().then(() => setSharedDir(null))}>
              <StopCircle size={14} />
              Stop
            </button>
          )}
        </div>
      </div>

      {browsing ? (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          <button
            style={{ ...rowStyle, background: 'none', border: 'none', color: '#38bdf8', padding: '4px 0' }}
            onClick={() => setBrowsing(browsing.path.length ? { ...browsing, path: browsing.path.slice(0, -1) } : null)}
          >
            <ArrowLeft size={14} />
            {browsing.peer.name} / {browsing.peer.folder}{browsing.path.map((p) => ` / ${p}`).join('')}
          </button>
          {entries.length === 0 && <div style={{ color: 'var(--text-dim)', fontSize: 13, padding: '12px 0' }}>Empty folder</div>}
          {entries.map((entry) => (
            <button key={entry.name} style={rowStyle} onClick={() => openEntry(entry)} title={entry.dir ? 'Open folder' : 'Download to Downloads folder'}>
              {entry.dir ? <Folder size={15} color="#fbbf24" /> : <File size={15} color="#94a3b8" />}
              <span style={{ flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{entry.name}</span>
              {!entry.dir && (
                <>
                  <span style={{ color: 'var(--text-dim)', fontSize: 12 }}>{formatBytes(entry.size)}</span>
                  <Download size={14} color="#38bdf8" />
                </>
              )}
            </button>
          ))}
        </div>
      ) : peers.length === 0 ? (
        <div style={{ textAlign: 'center', padding: '20px 0', color: 'var(--text-dim)', fontSize: 13 }}>
          No shared folders found on your network. PCs running AeroDesk with a shared folder appear here automatically.
        </div>
      ) : (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(260px, 1fr))', gap: 10 }}>
          {peers.map((peer) => (
            <button key={peer.id} style={{ ...rowStyle, padding: 14 }} onClick={() => { setStatus(null); setBrowsing({ peer, path: [] }); }}>
              <Folder size={18} color="#fbbf24" />
              <div style={{ minWidth: 0 }}>
                <div style={{ fontWeight: 600, color: '#fff' }}>{peer.folder}</div>
                <div style={{ fontSize: 11, color: 'var(--text-dim)', marginTop: 2 }}>{peer.name} · {peer.host}</div>
              </div>
            </button>
          ))}
        </div>
      )}

      {status && <div role="status" style={{ marginTop: 12, fontSize: 12, color: 'var(--text-muted)', wordBreak: 'break-all' }}>{status}</div>}
    </div>
  );
};
