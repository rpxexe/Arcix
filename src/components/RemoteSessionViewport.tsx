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
  ChevronDown,
  Eye,
  EyeOff
} from 'lucide-react';
import { ActiveSessionData, QualityPreset, RemoteInputEvent } from '../types';
import { WebRTCManager } from '../services/webrtc-manager';
import { TransferSummary } from './TransferList';

// Left/right modifiers by physical key: keyCode reports 16/17/18 for both sides, and the host needs
// the sided VK to send right Ctrl/Alt (AltGr) with the extended flag
const SIDED_VK: Record<string, number> = {
  ShiftLeft: 0xa0, ShiftRight: 0xa1, ControlLeft: 0xa2, ControlRight: 0xa3,
  AltLeft: 0xa4, AltRight: 0xa5, MetaLeft: 0x5b, MetaRight: 0x5c
};

// Cursor drawn locally by the OS (hardware cursor, zero latency); the host hides its own while we control
const LOCAL_CURSOR = `url("data:image/svg+xml,${encodeURIComponent(
  '<svg xmlns="http://www.w3.org/2000/svg" width="20" height="22"><path d="M2 1.5v16l4.2-4 3 6.8 2.6-1.1-3-6.7h5.8z" fill="#fff" stroke="#000" stroke-width="1.3" stroke-linejoin="round"/></svg>'
)}") 2 1, default`;

interface RemoteSessionViewportProps {
  session: ActiveSessionData;
  webrtc: WebRTCManager;
  transferToast?: TransferSummary | null;
  onDisconnect: () => void;
  onOpenFileTransfer: () => void;
}

export const RemoteSessionViewport: React.FC<RemoteSessionViewportProps> = ({
  session,
  webrtc,
  transferToast,
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
  const [showRemoteCursor, setShowRemoteCursor] = useState(true);
  const [clipboardStatus, setClipboardStatus] = useState<string | null>(null);

  // Floating ribbon minimized/expanded
  const [ribbonOpen, setRibbonOpen] = useState(true);

  // A new transfer opens a collapsed ribbon so its progress line is visible
  const hasTransfer = !!transferToast;
  useEffect(() => {
    if (hasTransfer) setRibbonOpen(true);
  }, [hasTransfer]);

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

  useEffect(() => {
    // When showRemoteCursor is enabled, host cursor remains visible and captured in the video stream
    webrtc.setRemoteCursorHidden(!showRemoteCursor);
  }, [webrtc, showRemoteCursor]);

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

  // Map a pointer position into host screen pixels, excluding object-fit letterbox bars (centered by default)
  const toHostPoint = (e: React.MouseEvent<HTMLVideoElement>) => {
    const video = videoRef.current!;
    const rect = video.getBoundingClientRect();
    const videoWidth = video.videoWidth || 1920;
    const videoHeight = video.videoHeight || 1080;
    const scale = Math.min(rect.width / videoWidth, rect.height / videoHeight);
    const offsetX = (rect.width - videoWidth * scale) / 2;
    const offsetY = (rect.height - videoHeight * scale) / 2;
    return {
      x: Math.min(videoWidth - 1, Math.max(0, Math.round((e.clientX - rect.left - offsetX) / scale))),
      y: Math.min(videoHeight - 1, Math.max(0, Math.round((e.clientY - rect.top - offsetY) / scale))),
      screen_w: videoWidth,
      screen_h: videoHeight
    };
  };

  // Mouse Input Tracking
  const handleMouseMove = (e: React.MouseEvent<HTMLVideoElement>) => {
    if (!isInputEnabled || session.role !== 'viewer' || !videoRef.current) return;

    // Leading-edge throttle to ~60 moves/s: the first move goes out immediately (no added latency),
    // moves within the next 16 ms collapse into one. A timer, not rAF: rAF pauses while the window isn't painted.
    pendingMoveRef.current = { type: 'mouse_move', ...toHostPoint(e) };
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

  // Clicks carry their position (reliable channel) so they land exactly where clicked even if a move was lost
  const handleMouseDown = (e: React.MouseEvent<HTMLVideoElement>) => {
    if (!isInputEnabled || session.role !== 'viewer' || !videoRef.current) return;
    const button = e.button === 2 ? 'right' : e.button === 1 ? 'middle' : 'left';
    pendingMoveRef.current = null;
    heldButtonsRef.current.add(button);
    webrtc.sendInputEvent({
      type: 'mouse_down',
      button,
      ...toHostPoint(e)
    });
  };

  const handleMouseUp = (e: React.MouseEvent<HTMLVideoElement>) => {
    if (!isInputEnabled || session.role !== 'viewer' || !videoRef.current) return;
    const button = e.button === 2 ? 'right' : e.button === 1 ? 'middle' : 'left';
    pendingMoveRef.current = null;
    heldButtonsRef.current.delete(button);
    webrtc.sendInputEvent({
      type: 'mouse_up',
      button,
      ...toHostPoint(e)
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

      const vk = SIDED_VK[e.code] ?? e.keyCode;
      if (!vk || vk === 229) return; // 229: IME composition in progress, no real key
      // Keep the key out of this window: Tab/Space/Enter would otherwise hit ribbon buttons, F-keys/Alt act locally
      e.preventDefault();
      heldKeysRef.current.add(vk);
      webrtc.sendInputEvent({
        type: 'key_down',
        vk
      });
    };

    const handleKeyUp = (e: KeyboardEvent) => {
      if (!isInputEnabled || session.role !== 'viewer') return;
      if (['INPUT', 'TEXTAREA'].includes((e.target as HTMLElement)?.tagName)) return;

      const vk = SIDED_VK[e.code] ?? e.keyCode;
      if (!vk || vk === 229) return;
      e.preventDefault();
      heldKeysRef.current.delete(vk);
      webrtc.sendInputEvent({
        type: 'key_up',
        vk
      });
    };

    // Win, Alt+Tab, Ctrl+Esc, PrintScreen never reach the page; the native hook captures them for this window
    const api = window.aeroDeskApi;
    const capturing = isInputEnabled && session.role === 'viewer';
    if (capturing) api?.setKeyCapture(true);
    const cleanupCaptured = api?.onCapturedKey(({ vk, up }) => {
      if (!capturing) return;
      if (up) heldKeysRef.current.delete(vk);
      else heldKeysRef.current.add(vk);
      webrtc.sendInputEvent({ type: up ? 'key_up' : 'key_down', vk });
    });

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
      cleanupCaptured?.();
      if (capturing) api?.setKeyCapture(false);
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

          {/* Toggle Remote Cursor Visibility */}
          <button
            onClick={() => setShowRemoteCursor(!showRemoteCursor)}
            id="toggle-remote-cursor-btn"
            title={showRemoteCursor ? 'Remote Cursor: Visible (Click to Hide)' : 'Remote Cursor: Hidden (Click to Show)'}
            style={{
              background: showRemoteCursor ? 'rgba(6, 182, 212, 0.2)' : 'rgba(255, 255, 255, 0.05)',
              color: showRemoteCursor ? '#38bdf8' : 'var(--text-dim)',
              border: showRemoteCursor ? '1px solid #06b6d4' : '1px solid var(--border-subtle)',
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
            {showRemoteCursor ? <Eye size={14} /> : <EyeOff size={14} />}
            {showRemoteCursor ? 'Cursor ON' : 'Cursor OFF'}
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

      {/* File transfer line, attached under the control ribbon */}
      {ribbonOpen && transferToast && (
        <div
          id="session-transfer-status"
          role="status"
          aria-live="polite"
          style={{
            position: 'absolute',
            top: 62,
            left: '50%',
            transform: 'translateX(-50%)',
            zIndex: 100,
            width: 420,
            maxWidth: 'calc(100% - 32px)',
            background: 'rgba(15, 20, 32, 0.88)',
            backdropFilter: 'blur(16px)',
            border: '1px solid var(--border-subtle)',
            borderRadius: 10,
            padding: '8px 12px',
            boxShadow: '0 8px 30px rgba(0, 0, 0, 0.5)',
            fontSize: 12
          }}
        >
          <div style={{ display: 'flex', gap: 10, alignItems: 'baseline' }}>
            <span style={{ flex: 1, minWidth: 0, color: '#fff', fontWeight: 600, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={transferToast.title}>
              {transferToast.title}
            </span>
            <span style={{
              fontWeight: 600,
              fontVariantNumeric: 'tabular-nums',
              color: transferToast.status === 'done' ? '#10b981' : transferToast.status === 'active' || transferToast.status === 'queued' ? '#06b6d4' : '#f43f5e'
            }}>
              {transferToast.status === 'done' ? <Check size={13} /> : `${transferToast.percent}%`}
            </span>
          </div>
          <div style={{ height: 4, margin: '5px 0 4px', background: 'rgba(255, 255, 255, 0.1)', borderRadius: 2, overflow: 'hidden' }}>
            <div style={{
              height: '100%',
              width: `${transferToast.percent}%`,
              background: transferToast.status === 'done' ? '#10b981' : transferToast.status === 'active' || transferToast.status === 'queued' ? '#06b6d4' : '#f43f5e',
              transition: 'width 0.15s linear'
            }} />
          </div>
          <div style={{ fontSize: 11, color: 'var(--text-dim)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={transferToast.detail}>
            {transferToast.detail}
          </div>
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
          // When remote cursor is shown, video stream contains the remote host cursor; otherwise use local hardware cursor
          cursor: isInputEnabled ? (showRemoteCursor ? 'default' : LOCAL_CURSOR) : 'default',
          backgroundColor: '#05070a'
        }}
      />
    </div>
  );
};
