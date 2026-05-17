# Security Policy

## Supported Versions

| Version | Supported |
| ------- | --------- |
| 1.x     | ✅ Yes     |


## Security Design

### Credentials

| What            | How                                                                |
| --------------- | ------------------------------------------------------------------ |
| Amazon password | Never stored — browser handles login via proxy                     |
| Session cookies | Encrypted with Electron `safeStorage` (OS keychain-backed AES-256) |
| Cookie data     | Never printed in logs — only `.message` from errors is logged      |
| IPC responses   | No raw cookies or tokens are ever sent to the renderer process     |

### Renderer Isolation

- `sandbox: true` — renderer has no Node.js access
- `contextIsolation: true` — preload bridge is the only surface
- `nodeIntegration: false` — enforced

### Network

- `network.client` entitlement required for Alexa API calls
- `open-url` IPC validates `http:`/`https:` protocol before opening external URLs

### LaunchAgent

- Plist written with mode `0o644` (owner read/write, others read-only)
- Runs the packaged Electron binary with `ELECTRON_RUN_AS_NODE=1` — no system Node.js required or trusted

### Hardened Runtime

- `hardenedRuntime: true` with minimal entitlements (`cs.allow-jit`, `cs.allow-unsigned-executable-memory`, `network.client`, keychain access group)
