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
  AlertCircle,
  ChevronUp,
  ChevronDown
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
  const pendingMoveRef = useRef<RemoteInputEvent | null>(null);
  const moveFrameRef = useRef<number | null>(null);
  // Held keys/buttons, released on blur so alt-tab doesn't leave them stuck down on the host
  const heldKeysRef = useRef(new Set<number>());
  const heldButtonsRef = useRef(new Set<'left' | 'right' | 'middle'>());

  const [isFullscreen, setIsFullscreen] = useState(false);
  const [fitToWindow, setFitToWindow] = useState(true);
  const [isInputEnabled, setIsInputEnabled] = useState(session.permissions.input);
  const [clipboardStatus, setClipboardStatus] = useState<string | null>(null);

  // Floating ribbon minimized/expanded
  const [ribbonOpen, setRibbonOpen] = useState(true);

  // Bind video element to remote stream with instant fallback and autoplay
  useEffect(() => {
    const attachStream = (stream: MediaStream) => {
      // Re-assigning the same stream restarts loading and aborts the pending play()
      if (videoRef.current && videoRef.current.srcObject !== stream) {
        videoRef.current.srcObject = stream;
        videoRef.current.play().catch((err) => {
          console.warn('[RemoteSessionViewport] Autoplay interrupted:', err);
        });
      }
    };

    const existingStream = webrtc.getRemoteStream();
    if (existingStream) {
      attachStream(existingStream);
    }

    webrtc.setEvents({
      onRemoteStream: (stream) => {
        attachStream(stream);
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

    // Map into the rendered picture, excluding object-fit letterbox bars (centered by default)
    const scale = Math.min(rect.width / videoWidth, rect.height / videoHeight);
    const offsetX = (rect.width - videoWidth * scale) / 2;
    const offsetY = (rect.height - videoHeight * scale) / 2;
    const hostX = Math.min(videoWidth - 1, Math.max(0, Math.round((e.clientX - rect.left - offsetX) / scale)));
    const hostY = Math.min(videoHeight - 1, Math.max(0, Math.round((e.clientY - rect.top - offsetY) / scale)));

    // Leading-edge throttle to ~60 moves/s: the first move goes out immediately (no added latency),
    // moves within the next 16 ms collapse into one. A timer, not rAF: rAF pauses while the window isn't painted.
    pendingMoveRef.current = { type: 'mouse_move', x: hostX, y: hostY, screen_w: videoWidth, screen_h: videoHeight };
    if (moveFrameRef.current === null) {
      flushMouseMove();
      moveFrameRef.current = window.setTimeout(() => {
        moveFrameRef.current = null;
        flushMouseMove();
      }, 16);
    }
  };

  const flushMouseMove = () => {
    if (pendingMoveRef.current) {
      webrtc.sendInputEvent(pendingMoveRef.current);
      pendingMoveRef.current = null;
    }
  };

  const handleMouseDown = (e: React.MouseEvent<HTMLVideoElement>) => {
    if (!isInputEnabled || session.role !== 'viewer') return;
    const button = e.button === 2 ? 'right' : e.button === 1 ? 'middle' : 'left';
    flushMouseMove();
    heldButtonsRef.current.add(button);
    webrtc.sendInputEvent({
      type: 'mouse_down',
      button
    });
  };

  const handleMouseUp = (e: React.MouseEvent<HTMLVideoElement>) => {
    if (!isInputEnabled || session.role !== 'viewer') return;
    const button = e.button === 2 ? 'right' : e.button === 1 ? 'middle' : 'left';
    flushMouseMove();
    heldButtonsRef.current.delete(button);
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

      heldKeysRef.current.add(e.keyCode);
      webrtc.sendInputEvent({
        type: 'key_down',
        vk: e.keyCode
      });
    };

    const handleKeyUp = (e: KeyboardEvent) => {
      if (!isInputEnabled || session.role !== 'viewer') return;
      if (['INPUT', 'TEXTAREA'].includes((e.target as HTMLElement)?.tagName)) return;

      heldKeysRef.current.delete(e.keyCode);
      webrtc.sendInputEvent({
        type: 'key_up',
        vk: e.keyCode
      });
    };

    const releaseAll = () => {
      heldKeysRef.current.forEach((vk) => webrtc.sendInputEvent({ type: 'key_up', vk }));
      heldButtonsRef.current.forEach((button) => webrtc.sendInputEvent({ type: 'mouse_up', button }));
      heldKeysRef.current.clear();
      heldButtonsRef.current.clear();
    };

    window.addEventListener('keydown', handleKeyDown);
    window.addEventListener('keyup', handleKeyUp);
    window.addEventListener('blur', releaseAll);
    return () => {
      releaseAll();
      window.removeEventListener('keydown', handleKeyDown);
      window.removeEventListener('keyup', handleKeyUp);
      window.removeEventListener('blur', releaseAll);
      if (moveFrameRef.current !== null) clearTimeout(moveFrameRef.current);
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

      setClipboardStatus(!text ? 'Clipboard is empty' : webrtc.sendClipboardText(text) ? 'Clipboard synced!' : 'Not connected yet');
      setTimeout(() => setClipboardStatus(null), 2000);
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
      {/* Top Floating Control Ribbon (Collapsible) */}
      {ribbonOpen ? (
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
          transition: 'all 0.2s ease',
          whiteSpace: 'nowrap',
          flexWrap: 'nowrap'
        }}
      >
        {/* Remote Partner Info & Timer */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexShrink: 0, whiteSpace: 'nowrap' }}>
          <div className="online-pulse" style={{ background: '#10b981', flexShrink: 0 }} />
          <div>
            <div style={{ fontSize: 12, fontWeight: 700, color: '#fff', fontFamily: 'var(--font-mono)', whiteSpace: 'nowrap' }}>
              {session.peerId}
            </div>
            <div style={{ fontSize: 10, color: 'var(--text-dim)', whiteSpace: 'nowrap' }}>
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

        <div style={{ height: 20, width: 1, background: 'var(--border-subtle)' }} />

        {/* Collapse Ribbon Button */}
        <button
          onClick={() => setRibbonOpen(false)}
          id="collapse-ribbon-btn"
          title="Hide Control Ribbon"
          style={{
            background: 'transparent',
            border: 'none',
            color: 'var(--text-dim)',
            cursor: 'pointer',
            display: 'flex',
            alignItems: 'center',
            padding: '4px',
            borderRadius: 4
          }}
        >
          <ChevronUp size={16} />
        </button>
      </div>
      ) : (
        /* Collapsed Mini Tab / Pill */
        <div
          id="session-control-ribbon-collapsed"
          onClick={() => setRibbonOpen(true)}
          title="Click to expand control ribbon"
          style={{
            position: 'absolute',
            top: 8,
            left: '50%',
            transform: 'translateX(-50%)',
            zIndex: 100,
            background: 'rgba(15, 23, 42, 0.92)',
            backdropFilter: 'blur(12px)',
            border: '1px solid var(--border-subtle)',
            borderRadius: 20,
            padding: '4px 12px',
            display: 'flex',
            alignItems: 'center',
            gap: 8,
            boxShadow: '0 4px 20px rgba(0, 0, 0, 0.5)',
            cursor: 'pointer',
            userSelect: 'none',
            fontSize: 12,
            color: '#e2e8f0',
            transition: 'all 0.2s ease'
          }}
        >
          <div className="online-pulse" style={{ background: '#10b981', width: 6, height: 6 }} />
          <span style={{ fontFamily: 'var(--font-mono)', fontWeight: 600 }}>{session.peerId}</span>
          <span style={{ color: 'var(--text-dim)', fontSize: 11 }}>{formatDuration(session.durationSeconds)}</span>
          <ChevronDown size={14} color="#38bdf8" />
        </div>
      )}

      {/* Main Remote Desktop Canvas / Video */}
      <video
        ref={videoRef}
        autoPlay
        playsInline
        muted
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
          // While controlling, the host's cursor in the video is the cursor; hide ours so only one shows
          cursor: isInputEnabled ? 'none' : 'default',
          backgroundColor: '#05070a'
        }}
      />
    </div>
  );
};
