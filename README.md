# AeroDesk — Production-Grade Remote Desktop Application

AeroDesk is a high-performance, production-oriented remote desktop application inspired by AnyDesk, featuring original branding, dark glassmorphic aesthetics, and native Windows integrations.

Built with **Electron 34**, **React 19**, **TypeScript**, **WebRTC (DTLS-SRTP)**, and a native zero-dependency **Win32 Input Injector** compiled in C#.

---

## 🌟 Key Features

- **AnyDesk-Style 9-Digit Addressing**: Distinct 9-digit connection IDs (`XXX XXX XXX`) generated and authenticated through the signaling gateway.
- **Ultra-Low Latency WebRTC Video**: Hardware-accelerated screen streaming with VP8/VP9 codecs and adaptive bitrate control.
- **Native Windows Input Injection**: Sub-millisecond mouse movement, clicking, scrolling, and keyboard keystrokes via direct Win32 `SendInput` APIs without external C++ runtimes.
- **Granular Session Permissions**:
  - Screen Viewing (always requested)
  - Remote Mouse & Keyboard Control (toggleable)
  - Bidirectional Clipboard Synchronization (toggleable)
  - Secure File Transfer (toggleable)
- **Host-Side Safety Circuit Breakers**:
  - Persistent floating host indicator banner with real-time session telemetry.
  - Emergency Disconnect button and global emergency shortcut (`Ctrl+Alt+Shift+Escape`).
  - Instant permission revocation at any time during a session.
- **End-to-End Encryption**: DTLS 1.3 / SRTP for media streams and SCTP for data channels.
- **Privacy-Conscious Audit Logging**: Local append-only ledger (`logs/audit.jsonl`) recording session metadata without passwords, tokens, or keystroke contents.

---

## 🏗️ Architecture & Component Separation

```
aerodesk/
├── server/
│   ├── signaling-server.js   # WebSocket signaling hub, room manager, and rate limiter
│   └── index.js              # Standalone signaling gateway entrypoint (Port 7070)
├── native-input/
│   ├── InputInjector.cs      # Native C# Win32 SendInput engine
│   └── InputInjector.exe     # Pre-compiled high-performance Windows binary
├── electron/
│   ├── main.ts               # Electron main process, window manager, and native IPC
│   └── preload.ts            # Secure contextBridge API bindings
├── src/
│   ├── components/
│   │   ├── Titlebar.tsx               # Frameless custom titlebar with status pulse
│   │   ├── Dashboard.tsx              # "This Device" and "Connect to Remote" cards
│   │   ├── IncomingCallModal.tsx      # Consent prompt with granular permission toggles
│   │   ├── RemoteSessionViewport.tsx  # Video viewport with floating ribbon toolbar
│   │   ├── FileTransferModal.tsx      # Chunked P2P file transfer modal with validation
│   │   └── SettingsModal.tsx          # Security, unattended access, and audit log viewer
│   ├── services/
│   │   ├── signaling-client.ts        # Client WebSocket signaling manager
│   │   └── webrtc-manager.ts          # RTCPeerConnection and data channel orchestrator
│   ├── types/
│   │   └── index.ts                   # Core TypeScript type definitions
│   ├── App.tsx                        # Root application component
│   ├── main.tsx                       # React mount point
│   └── index.css                      # Cyber Dark glassmorphic design system
├── tests/
│   └── run-tests.js          # Automated end-to-end verification test suite (26 assertions)
└── scripts/
    └── wait-and-launch-electron.js    # Concurrently runner helper
```

---

## 🚀 Quick Start Guide

### 1. Prerequisites
- **Node.js**: v22.x, v24.x, or v26.x
- **npm**: v10+ or v11+
- **OS**: Windows 10 or Windows 11 (x64)

### 2. Installation
```bash
git clone <repository-url>
cd aerodesk
npm install
```

### 3. Native Input Injector Compilation (Optional)
The native C# input injector (`native-input/InputInjector.exe`) is already pre-compiled in the repository. If you make modifications to `InputInjector.cs`, recompile it using Windows' built-in .NET compiler:
```powershell
& "C:\Windows\Microsoft.NET\Framework64\v4.0.30319\csc.exe" /nologo /optimize /target:exe /out:"native-input\InputInjector.exe" "native-input\InputInjector.cs"
```

### 4. Run Automated Test Suite
Verify all 26 assertions across native input, signaling, device registration, and security:
```bash
npm test
```

### 5. Running the Application
#### Start the Signaling Server:
```bash
npm run dev:server
```
*The signaling gateway will listen on `ws://localhost:7070` and provide health telemetry at `http://localhost:7070/health`.*

#### Run Desktop Application in Development:
```bash
npm run dev
```
*Launches Vite on port 5173, starts the signaling gateway, and boots the Electron desktop shell with hot-module replacement.*

---

## 🔒 Security & Privacy Model

1. **Consent-First Architecture**: By default, no remote connection can access or view the host workstation without an explicit user acceptance on the host screen.
2. **Selective Permissions**: The host user explicitly toggles whether the remote partner can inject mouse/keyboard events, sync the clipboard, or transfer files.
3. **Emergency Circuit Breaker**: Pressing `Ctrl+Alt+Shift+Escape` or clicking "Revoke Control" on the persistent host overlay window immediately cuts off all input forwarding.
4. **Path Traversal Protection**: The file transfer engine enforces strict filename normalization, disallowing relative path separators (`..`, `/`, `\`) and verifying chunk hashes with SHA-256.
5. **Audit Logging**: Every session creation, permission grant, rejection, and termination is logged to `logs/audit.jsonl` without sensitive credentials or screen payloads.

---

## 📦 Production Packaging & Windows Installer

To build production binaries and generate a portable Windows installer:
1. Compile the production bundles:
   ```bash
   npm run build
   ```
2. Package using Electron Builder (run with administrator privileges for NSIS installer generation):
   ```bash
   npx electron-builder --win nsis:ia32,x64
   ```

### Code Signing Guidance
For production deployment without Windows SmartScreen warnings:
1. Obtain an EV (Extended Validation) or OV Code Signing Certificate from a trusted CA (DigiCert, Sectigo).
2. Set the environment variables:
   ```powershell
   $env:CSC_LINK = "C:\path\to\your_certificate.pfx"
   $env:CSC_KEY_PASSWORD = "your_secure_passphrase"
   ```
3. Run `electron-builder` to sign both the executable and the NSIS installer package automatically.

---

## 🛠️ Troubleshooting

- **Target Device Shows Offline**: Ensure both devices are connected to the signaling gateway (`ws://localhost:7070` or your remote domain).
- **Cannot Inject Remote Input**: Verify that the host user accepted the "Control Mouse & Keyboard" checkbox on the incoming connection screen. Confirm that `native-input/InputInjector.exe` is present and not blocked by local antivirus software.
- **Symmetric NAT / Strict Firewall Issues**: If direct P2P connections cannot be established over public networks, configure a TURN relay server in `.env`.
