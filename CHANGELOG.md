# Changelog

All notable changes to PlugPilot are documented here.

## [1.0.0] — 2025-05-16

### Initial release

**Core features**
- macOS menu bar utility — no Dock icon, hides on close
- Battery monitoring with configurable low/high thresholds
- Alexa smart plug control (turn on below low threshold, turn off above high threshold)
- Background LaunchAgent (`com.plugpilot.worker`) checks battery every 2 minutes, independent of the UI
- In-app scheduler (node-cron) with immediate trigger on threshold change

**Authentication**
- Browser-based Amazon login via alexa-remote2 proxy — no password ever stored
- Session cookies encrypted with Electron `safeStorage` (OS keychain-backed AES-256)
- Multi-region support: US, India, UK, Germany, Canada, Japan

**UI**
- 4-step setup wizard: region → connect → device → thresholds
- Region selection as pill buttons
- Scrollable device list (Alexa + smart home devices)
- Dual slider + number input for battery range with live validation (low < high enforced)
- Two-button main UI: Start/Stop Monitor · Plug IN/Plug OUT (shows current state)
- Light & dark mode (follows macOS system theme)
- Run at Startup toggle (macOS Login Items)

**Security**
- `sandbox: true`, `contextIsolation: true`, no `nodeIntegration`
- Hardened Runtime with minimal entitlements
- No cookies or tokens in logs or IPC responses
- `open-url` IPC validates `http:`/`https:` protocol

**Distribution**
- Universal build: Apple Silicon (arm64) + Intel (x64)
- Requires macOS 12 (Monterey) or later
- Signed and notarized with Hardened Runtime
