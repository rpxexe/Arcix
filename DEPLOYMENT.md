# AeroDesk Deployment Guide

Complete step-by-step instructions for deploying the **AeroDesk** remote desktop application across cloud platforms and packaging client executables.

---

## 📐 Architecture Overview

AeroDesk separates its cloud infrastructure into two distinct services:

```mermaid
graph LR
    subgraph Clients["AeroDesk Desktop & Web Clients"]
        Viewer["Remote Viewer (PC / Web)"]
        Host["Host Desktop (Windows)"]
    end

    subgraph Vercel["Vercel Cloud (Serverless)"]
        WebUI["Web App Dashboard (SPA)"]
        RestAPI["REST API (/api/health, /api/register, /api/turn)"]
    end

    subgraph Signaling["Persistent Signaling Server (Render / Docker / VPS)"]
        WSS["WebSocket Hub (ws:// or wss://:7070)"]
    end

    subgraph STUNTURN["NAT Traversal Infrastructure"]
        STUN["Google Public STUN"]
        TURN["TURN Relay Server"]
    end

    Viewer -->|HTTP / REST| RestAPI
    Host -->|HTTP / REST| RestAPI
    Viewer <-->|Persistent WSS Signaling| WSS
    Host <-->|Persistent WSS Signaling| WSS
    Viewer <==>|Encrypted P2P Media & Input (DTLS-SRTP)| Host
    Viewer -.->|Relay Fallback if P2P blocked| TURN
    Host -.->|Relay Fallback if P2P blocked| TURN
```

| Component | Recommended Host | Why |
| :--- | :--- | :--- |
| **Web Dashboard & REST API** | **Vercel** | Fast global CDN, instant serverless execution, automated Git CI/CD |
| **Signaling Gateway** | **Render / Railway / Docker / VPS** | Requires persistent, long-lived bidirectional WebSockets (`ws://`) |
| **Desktop Client (`.exe`)** | **Local Release / GitHub Releases** | Single standalone portable executable for Windows |

---

## 🚀 Quick Deployment Summary

1. **Vercel**: Deploy the web dashboard and serverless endpoints with `npx vercel --prod`.
2. **Signaling Server**: Deploy `server/` to Render (free) using [`render.yaml`](render.yaml) or Docker to keep persistent WebSockets active.
3. **Desktop App**: Run `npm run package:exe` to generate the portable Windows `AeroDesk 1.0.0.exe`.

---

## 1. Deploying to Vercel (Frontend & Serverless API)

### Option A: Deploy via Vercel CLI

Since you are already authenticated with `npx vercel login`:

1. From the project root (`d:\New folder`), run:
   ```powershell
   npx vercel --prod
   ```
2. Accept the prompts:
   - **Set up and deploy?**: `Y`
   - **Which scope?**: Select your account
   - **Link to existing project?**: `N` (or select if previously created)
   - **Project name**: `aerodesk` (or your preferred name)
   - **In which directory is your code located?**: `./`
   - **Want to modify settings?**: `N` (auto-detected via [`vercel.json`](vercel.json))
3. Once finished, Vercel will output your live URL (e.g. `https://aerodesk.vercel.app`).

### Option B: Deploy via Vercel Web Dashboard (Automated Git CI/CD)

1. Open [vercel.com/new](https://vercel.com/new).
2. Connect your GitHub account and import the repository: **`rpxexe/aerodesk`**.
3. Vercel will automatically read [`vercel.json`](vercel.json):
   - **Framework Preset**: `Vite`
   - **Build Command**: `npm run build:react`
   - **Output Directory**: `dist`
4. Click **Deploy**. Any future `git push origin main` will automatically redeploy the site.

### Environment Variables on Vercel
In your Vercel Project Settings > **Environment Variables**, configure:
| Variable Name | Example Value | Description |
| :--- | :--- | :--- |
| `VITE_SIGNALING_URL` | `wss://aerodesk-signaling.onrender.com` | Public WebSocket URL for signaling |
| `TURN_SECRET` | *(Optional secret string)* | Secret for timed HMAC TURN credentials |
| `TURN_DOMAIN` | *(Optional domain, e.g. turn.yourdomain.com)* | Domain of your TURN server |

### Verifying Vercel Deployment
Test your endpoints in your browser or with curl:
- `https://<your-project>.vercel.app/api/health` — Returns status `online` and STUN server list.
- `https://<your-project>.vercel.app/api/register` — Tests device ID generation and authentication tokens.
- `https://<your-project>.vercel.app/api/turn` — Returns ICE server configurations.

---

## 2. Deploying the Persistent WebSocket Signaling Server

> ⚠️ **Why is this separate?** Vercel serverless functions shut down after each HTTP request. WebRTC connection establishment requires a persistent WebSocket server (`ws://` or `wss://`) to negotiate session handshakes between devices in real-time.

### Option A: Free 1-Click Deployment on Render.com (Recommended)

1. Sign up or log into [Render.com](https://render.com).
2. Click **New +** > **Blueprint**.
3. Connect your GitHub repository: **`rpxexe/aerodesk`**.
4. Render will automatically detect [`render.yaml`](render.yaml):
   - **Service Name**: `aerodesk-signaling-hub`
   - **Runtime**: `Node`
   - **Plan**: `Free`
   - **Build Command**: `npm install --omit=dev`
   - **Start Command**: `node server/index.js`
5. Click **Apply**.
6. When deployment finishes, copy your public service URL:
   - Example: `https://aerodesk-signaling-hub.onrender.com`
   - Your WebSocket URL will be: **`wss://aerodesk-signaling-hub.onrender.com`**

### Option B: Deploy with Docker (Railway / Fly.io / VPS)

The project includes a production [`Dockerfile`](Dockerfile).

#### Run on any Linux / Cloud VPS (Ubuntu / Debian):
```bash
# 1. Clone repository
git clone https://github.com/rpxexe/aerodesk.git
cd aerodesk

# 2. Build Docker container
docker build -t aerodesk-signaling .

# 3. Run container on port 7070
docker run -d --name aerodesk-signaling -p 7070:7070 --restart unless-stopped aerodesk-signaling
```

#### Nginx / Caddy Reverse Proxy for SSL (WSS):
If running on a VPS, use Caddy for automatic free HTTPS/WSS:
```caddy
signaling.yourdomain.com {
    reverse_proxy localhost:7070
}
```

---

## 3. Configuring the Desktop Client & Web App

Once your persistent signaling server is live, point your clients to it:

### In Development or Build Configuration:
Edit your local [`.env`](.env.example):
```env
VITE_SIGNALING_URL=wss://aerodesk-signaling-hub.onrender.com
```

### In the Desktop App GUI:
You can also change the signaling server directly inside the running application:
1. Click **Preferences & Logs** on the dashboard.
2. Under the **Security** tab, find **Signaling Gateway Server**.
3. Enter your deployed server URL (e.g. `wss://aerodesk-signaling-hub.onrender.com`).
4. Click **Save Preferences**. The client reconnects immediately.

---

## 4. Building the Windows Executable (`.exe`)

AeroDesk packages into a single standalone portable `.exe` that runs on any Windows 10 or 11 system without installation.

### Packaging Command:
```powershell
npm run package:exe
```

### Output Artifacts:
- **Portable Executable**: [`release\AeroDesk 1.0.0.exe`](release/AeroDesk%201.0.0.exe) (~82 MB)
  - Contains Electron 34, React UI, WebRTC media engine, and the native Win32 `InputInjector.exe`.
  - Can be copied to a USB drive or distributed to clients directly.
- **Unpacked Folder**: [`release\win-unpacked\AeroDesk.exe`](release/win-unpacked/AeroDesk.exe)

### Windows Code-Signing (Optional for Production):
To eliminate the Windows Defender SmartScreen "Unknown Publisher" prompt:
1. Acquire an Authenticode certificate (`.pfx` file) from a trusted certificate authority (Sectigo, DigiCert).
2. Set environment variables prior to running the packaging command:
   ```powershell
   $env:CSC_LINK = "C:\Certificates\aerodesk_signing.pfx"
   $env:CSC_KEY_PASSWORD = "YourCertificatePassword"
   npm run package:exe
   ```

---

## 5. STUN & TURN Relay Server Setup

- **STUN (Default)**: Free public Google STUN servers are already hardcoded into the client and server (`stun:stun.l.google.com:19302`). This allows direct P2P connection for ~85% of home/office networks.
- **TURN Relay (For Strict Corporate NATs & Firewalls)**:
  - When direct P2P is blocked by symmetric firewalls, a TURN relay server relays the encrypted stream.
  - Recommended free/low-cost TURN providers:
    - [Metered.ca](https://www.metered.ca/tools/openrelay/) (Free tier provides 50GB/mo free TURN relay).
    - [Twilio Network Traversal](https://www.twilio.com/docs/stun-turn).
    - [Coturn](https://github.com/coturn/coturn) (Self-hosted on Ubuntu).
  - Add your TURN credentials to [`.env`](.env.example):
    ```env
    TURN_SERVER_URL=turn:turn.yourdomain.com:3478
    TURN_USERNAME=aerodesk_user
    TURN_CREDENTIAL=your_turn_secret_password
    ```

---

## 6. Verification Checklist

- [ ] **Signaling Hub Online**: Visiting `https://<signaling-domain>/health` returns `{"status":"online"}`.
- [ ] **Vercel API Online**: Visiting `https://<vercel-domain>/api/health` returns status `200 OK`.
- [ ] **Device Registration**: Running two instances assigns distinct 9-digit addresses (e.g. `123 456 789`).
- [ ] **Remote Session Test**:
  1. Open instance A (Host).
  2. Open instance B (Viewer).
  3. Enter Host's 9-digit ID into Viewer and click **Connect**.
  4. Host screen displays interactive approval prompt. Click **Accept**.
  5. Viewer receives live video stream and can inject mouse/keyboard input.
- [ ] **Immediate Revocation**: Click "Revoke Control" on the host floating banner to verify remote input stops instantly.
