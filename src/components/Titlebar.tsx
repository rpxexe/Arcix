// src/components/Titlebar.tsx
import React from 'react';
import { Monitor, Minus, Square, X, ShieldCheck } from 'lucide-react';
import { ConnectionState } from '../types';

interface TitlebarProps {
  connectionState: ConnectionState;
  onOpenSettings: () => void;
}

export const Titlebar: React.FC<TitlebarProps> = ({ connectionState, onOpenSettings }) => {
  const handleMinimize = () => {
    window.aeroDeskApi?.minimizeWindow();
  };

  const handleMaximize = () => {
    window.aeroDeskApi?.maximizeWindow();
  };

  const handleClose = () => {
    window.aeroDeskApi?.closeWindow();
  };

  return (
    <header className="app-titlebar" id="app-titlebar">
      <div className="titlebar-brand">
        <div style={{
          width: 24,
          height: 24,
          borderRadius: 6,
          background: 'linear-gradient(135deg, #06b6d4 0%, #3b82f6 100%)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          color: 'white',
          boxShadow: '0 0 10px rgba(6, 182, 212, 0.5)'
        }}>
          <Monitor size={14} strokeWidth={2.5} />
        </div>
        <span>AERODESK</span>
        <span style={{
          fontSize: 10,
          background: 'rgba(255, 255, 255, 0.08)',
          padding: '2px 6px',
          borderRadius: 4,
          color: 'var(--text-muted)'
        }}>
          v1.0
        </span>
      </div>

      <div style={{ display: 'flex', alignItems: 'center', gap: 16 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12 }}>
          <div className={connectionState === 'idle' || connectionState === 'connected' ? 'online-pulse' : ''}
               style={{
                 width: 8,
                 height: 8,
                 borderRadius: '50%',
                 background: connectionState === 'connected' ? '#10b981' :
                             connectionState === 'idle' ? '#06b6d4' :
                             connectionState === 'ringing' || connectionState === 'calling' ? '#f59e0b' : '#ef4444'
               }} />
          <span style={{ color: 'var(--text-muted)', textTransform: 'capitalize' }}>
            {connectionState === 'idle' ? 'Ready' : connectionState}
          </span>
        </div>

        <div className="titlebar-controls">
          <button className="titlebar-btn" onClick={handleMinimize} title="Minimize" id="titlebar-minimize-btn">
            <Minus size={14} />
          </button>
          <button className="titlebar-btn" onClick={handleMaximize} title="Maximize" id="titlebar-maximize-btn">
            <Square size={12} />
          </button>
          <button className="titlebar-btn btn-close" onClick={handleClose} title="Close" id="titlebar-close-btn">
            <X size={14} />
          </button>
        </div>
      </div>
    </header>
  );
};
