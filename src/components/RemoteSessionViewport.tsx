// src/components/RemoteSessionViewport.tsx
import React, { useRef, useEffect, useState } from 'react';
import {
  Maximize2,
  Minimize2,
  PhoneOff,
  MousePointer,
  Clipboard,
  FileUp,
  Sliders,
  Shield,
  Activity,
  Layers,
  Check,
  AlertCircle
} from 'lucide-react';
import { ActiveSessionData, QualityPreset, RemoteInputEvent } from '../types';
import { WebRTCManager } from '../services/webrtc-manager';

interface RemoteSessionViewportProps {
  session: ActiveSessionData;
  webrtc: WebRTCManager;
  onDisconnect: () => void;
  onOpenFileTransfer: () => void;
}

export const RemoteSessionViewport: React.FC<RemoteSessionViewportProps> = ({
  session,
  webrtc,
  onDisconnect,
  onOpenFileTransfer
}) => {
  const videoRef = useRef<HTMLVideoElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  const [isFullscreen, setIsFullscreen] = useState(false);
  const [fitToWindow, setFitToWindow] = useState(true);
  const [isInputEnabled, setIsInputEnabled] = useState(session.permissions.input);
  const [clipboardStatus, setClipboardStatus] = useState<string | null>(null);

  // Floating ribbon minimized/expanded
  const [ribbonOpen, setRibbonOpen] = useState(true);

  // Bind video element to remote stream
  useEffect(() => {
    webrtc.setEvents({
      onRemoteStream: (stream) => {
        if (videoRef.current) {
          videoRef.current.srcObject = stream;
        }
      }
    });
  }, [webrtc]);

  // Fullscreen change listener
  useEffect(() => {
    const handleFullscreenChange = () => {
      setIsFullscreen(!!document.fullscreenElement);
    };
    document.addEventListener('fullscreenchange', handleFullscreenChange);
    return () => document.removeEventListener('fullscreenchange', handleFullscreenChange);
  }, []);

  const toggleFullscreen = () => {
    if (!containerRef.current) return;
    if (!document.fullscreenElement) {
      containerRef.current.requestFullscreen().catch(() => {});
    } else {
      document.exitFullscreen().catch(() => {});
    }
  };

  // Mouse Input Tracking
  const handleMouseMove = (e: React.MouseEvent<HTMLVideoElement>) => {
    if (!isInputEnabled || session.role !== 'viewer' || !videoRef.current) return;

    const rect = videoRef.current.getBoundingClientRect();
    const videoWidth = videoRef.current.videoWidth || 1920;
    const videoHeight = videoRef.current.videoHeight || 1080;

    // Calculate normalized pointer position within the actual video area
    const clientX = e.clientX - rect.left;
    const clientY = e.clientY - rect.top;

    const scaleX = videoWidth / rect.width;
    const scaleY = videoHeight / rect.height;

    const hostX = Math.round(clientX * scaleX);
    const hostY = Math.round(clientY * scaleY);

    webrtc.sendInputEvent({
      type: 'mouse_move',
      x: hostX,
      y: hostY,
      screen_w: videoWidth,
      screen_h: videoHeight
    });
  };

  const handleMouseDown = (e: React.MouseEvent<HTMLVideoElement>) => {
    if (!isInputEnabled || session.role !== 'viewer') return;
    const button = e.button === 2 ? 'right' : e.button === 1 ? 'middle' : 'left';
    webrtc.sendInputEvent({
      type: 'mouse_down',
      button
    });
  };

  const handleMouseUp = (e: React.MouseEvent<HTMLVideoElement>) => {
    if (!isInputEnabled || session.role !== 'viewer') return;
    const button = e.button === 2 ? 'right' : e.button === 1 ? 'middle' : 'left';
    webrtc.sendInputEvent({
      type: 'mouse_up',
      button
    });
  };

  const handleWheel = (e: React.WheelEvent<HTMLVideoElement>) => {
    if (!isInputEnabled || session.role !== 'viewer') return;
    webrtc.sendInputEvent({
      type: 'mouse_wheel',
      delta_y: e.deltaY > 0 ? -120 : 120
    });
  };

  const handleContextMenu = (e: React.MouseEvent) => {
    e.preventDefault(); // Prevent browser context menu inside remote desktop
  };

  // Keyboard Input Forwarding
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (!isInputEnabled || session.role !== 'viewer') return;

      // Ignore if user is typing in a modal or input
      if (['INPUT', 'TEXTAREA'].includes((e.target as HTMLElement)?.tagName)) return;

      // Emergency Escape: Escape exits full screen
      if (e.key === 'Escape' && document.fullscreenElement) {
        document.exitFullscreen().catch(() => {});
        return;
      }

      webrtc.sendInputEvent({
        type: 'key_down',
        vk: e.keyCode
      });
    };

    const handleKeyUp = (e: KeyboardEvent) => {
      if (!isInputEnabled || session.role !== 'viewer') return;
      if (['INPUT', 'TEXTAREA'].includes((e.target as HTMLElement)?.tagName)) return;

      webrtc.sendInputEvent({
        type: 'key_up',
        vk: e.keyCode
      });
    };

    window.addEventListener('keydown', handleKeyDown);
    window.addEventListener('keyup', handleKeyUp);
    return () => {
      window.removeEventListener('keydown', handleKeyDown);
      window.removeEventListener('keyup', handleKeyUp);
    };
  }, [isInputEnabled, session.role, webrtc]);

  // Clipboard synchronization trigger
  const handleSyncClipboard = async () => {
    try {
      let text = '';
      if (window.aeroDeskApi) {
        text = await window.aeroDeskApi.readClipboard();
      } else {
        text = await navigator.clipboard.readText();
      }

      if (text) {
        webrtc.sendClipboardText(text);
        setClipboardStatus('Clipboard synced!');
        setTimeout(() => setClipboardStatus(null), 2000);
      }
    } catch (err) {
      setClipboardStatus('Clipboard access denied');
      setTimeout(() => setClipboardStatus(null), 2000);
    }
  };

  const formatDuration = (seconds: number) => {
    const m = Math.floor(seconds / 60).toString().padStart(2, '0');
    const s = (seconds % 60).toString().padStart(2, '0');
    return `${m}:${s}`;
  };

  return (
    <div
      ref={containerRef}
      id="remote-session-container"
      style={{
        position: 'relative',
        width: '100%',
        height: 'calc(100vh - 38px)',
        background: '#05070a',
        overflow: 'hidden',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center'
      }}
    >
      {/* Top Floating Control Ribbon */}
      <div
        id="session-control-ribbon"
        style={{
          position: 'absolute',
          top: 12,
          left: '50%',
          transform: 'translateX(-50%)',
          zIndex: 100,
          background: 'rgba(15, 20, 32, 0.88)',
          backdropFilter: 'blur(16px)',
          border: '1px solid var(--border-subtle)',
          borderRadius: 12,
          padding: '6px 14px',
          display: 'flex',
          alignItems: 'center',
          gap: 16,
          boxShadow: '0 8px 30px rgba(0, 0, 0, 0.5)',
          userSelect: 'none',
          transition: 'all 0.2s ease'
        }}
      >
        {/* Remote Partner Info & Timer */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <div className="online-pulse" style={{ background: '#10b981' }} />
          <div>
            <div style={{ fontSize: 12, fontWeight: 700, color: '#fff', fontFamily: 'var(--font-mono)' }}>
              {session.peerId}
            </div>
            <div style={{ fontSize: 10, color: 'var(--text-dim)' }}>
              {formatDuration(session.durationSeconds)}
            </div>
          </div>
        </div>

        <div style={{ height: 20, width: 1, background: 'var(--border-subtle)' }} />

        {/* Telemetry Metrics (RTT, FPS, Bitrate) */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, fontSize: 11, color: 'var(--text-muted)' }}>
          <div title="Round-Trip Time">
            <span style={{ color: session.rttMs < 30 ? '#10b981' : session.rttMs < 80 ? '#f59e0b' : '#ef4444', fontWeight: 600 }}>
              {session.rttMs} ms
            </span>
          </div>
          <div title="Framerate">
            <span style={{ color: '#fff', fontWeight: 600 }}>{session.fps} FPS</span>
          </div>
          {session.bitrateKbps > 0 && (
            <div title="Bitrate">
              <span style={{ color: '#38bdf8' }}>{(session.bitrateKbps / 1000).toFixed(1)} Mb/s</span>
            </div>
          )}
        </div>

        <div style={{ height: 20, width: 1, background: 'var(--border-subtle)' }} />

        {/* Interactive Session Tools */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          {/* Toggle Remote Input Control */}
          <button
            onClick={() => setIsInputEnabled(!isInputEnabled)}
            id="toggle-remote-input-btn"
            title={isInputEnabled ? 'Input Enabled (Click to Pause)' : 'Input Paused (Click to Enable)'}
            style={{
              background: isInputEnabled ? 'rgba(16, 185, 129, 0.2)' : 'rgba(255, 255, 255, 0.05)',
              color: isInputEnabled ? '#10b981' : 'var(--text-dim)',
              border: isInputEnabled ? '1px solid #10b981' : '1px solid var(--border-subtle)',
              padding: '6px 10px',
              borderRadius: 6,
              cursor: 'pointer',
              display: 'flex',
              alignItems: 'center',
              gap: 4,
              fontSize: 12,
              fontWeight: 600
            }}
          >
            <MousePointer size={14} />
            {isInputEnabled ? 'Control ON' : 'Control OFF'}
          </button>

          {/* Sync Clipboard */}
          {session.permissions.clipboard && (
            <button
              onClick={handleSyncClipboard}
              id="sync-clipboard-btn"
              title="Synchronize Clipboard"
              style={{
                background: 'rgba(255, 255, 255, 0.05)',
                color: '#e2e8f0',
                border: '1px solid var(--border-subtle)',
                padding: '6px 10px',
                borderRadius: 6,
                cursor: 'pointer',
                display: 'flex',
                alignItems: 'center',
                gap: 4,
                fontSize: 12
              }}
            >
              <Clipboard size={14} />
              {clipboardStatus || 'Sync Clipboard'}
            </button>
          )}

          {/* File Transfer */}
          {session.permissions.fileTransfer && (
            <button
              onClick={onOpenFileTransfer}
              id="open-file-transfer-btn"
              title="Send Files"
              style={{
                background: 'rgba(255, 255, 255, 0.05)',
                color: '#e2e8f0',
                border: '1px solid var(--border-subtle)',
                padding: '6px 10px',
                borderRadius: 6,
                cursor: 'pointer',
                display: 'flex',
                alignItems: 'center',
                gap: 4,
                fontSize: 12
              }}
            >
              <FileUp size={14} />
              Transfer Files
            </button>
          )}

          {/* Fit to window toggle */}
          <button
            onClick={() => setFitToWindow(!fitToWindow)}
            id="toggle-fit-window-btn"
            title={fitToWindow ? 'Fit to Screen' : '1:1 Original Resolution'}
            style={{
              background: 'rgba(255, 255, 255, 0.05)',
              color: fitToWindow ? '#38bdf8' : 'var(--text-dim)',
              border: '1px solid var(--border-subtle)',
              padding: '6px 8px',
              borderRadius: 6,
              cursor: 'pointer'
            }}
          >
            <Layers size={14} />
          </button>

          {/* Fullscreen Toggle */}
          <button
            onClick={toggleFullscreen}
            id="toggle-fullscreen-btn"
            title={isFullscreen ? 'Exit Fullscreen' : 'Enter Fullscreen'}
            style={{
              background: 'rgba(255, 255, 255, 0.05)',
              color: '#e2e8f0',
              border: '1px solid var(--border-subtle)',
              padding: '6px 8px',
              borderRadius: 6,
              cursor: 'pointer'
            }}
          >
            {isFullscreen ? <Minimize2 size={14} /> : <Maximize2 size={14} />}
          </button>
        </div>

        <div style={{ height: 20, width: 1, background: 'var(--border-subtle)' }} />

        {/* End Session Button */}
        <button
          onClick={onDisconnect}
          id="disconnect-session-btn"
          className="btn-danger"
          style={{ padding: '6px 12px', fontSize: 12 }}
        >
          <PhoneOff size={14} />
          Disconnect
        </button>
      </div>

      {/* Main Remote Desktop Canvas / Video */}
      <video
        ref={videoRef}
        autoPlay
        playsInline
        id="remote-desktop-video"
        onMouseMove={handleMouseMove}
        onMouseDown={handleMouseDown}
        onMouseUp={handleMouseUp}
        onWheel={handleWheel}
        onContextMenu={handleContextMenu}
        style={{
          width: fitToWindow ? '100%' : 'auto',
          height: fitToWindow ? '100%' : 'auto',
          objectFit: fitToWindow ? 'contain' : 'none',
          cursor: isInputEnabled && session.role === 'viewer' ? 'crosshair' : 'default',
          backgroundColor: '#05070a'
        }}
      />
    </div>
  );
};
