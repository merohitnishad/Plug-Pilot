# PlugPilot

PlugPilot is a macOS application that automates Alexa smart plugs based on your MacBook's battery percentage. It helps maintain battery health by keeping it between specified thresholds (e.g., 20% to 80%).

## Project Overview

- **Purpose:** Automate charging/discharging using Alexa-compatible smart plugs.
- **Architecture:** Electron app with a background LaunchAgent worker.
- **Technologies:** Electron, TypeScript, Node.js, `alexa-remote2`, `better-sqlite3`, `systeminformation`.
- **Platform:** macOS only (12+).

## Architecture & Core Components

### 1. Main Process (`src/index.ts`)
The entry point for the Electron app. It handles:
- Window management (Main window, Wizard, Logs).
- Menu bar tray icon.
- Application menu.
- IPC handler registration.
- Safe storage encryption/decryption for Alexa cookies.

### 2. Background Worker (`src/backend/worker.ts`)
A standalone Node.js script managed by a macOS LaunchAgent.
- **Frequency:** Runs every 2 minutes.
- **Functionality:** Reads config, checks battery status, and triggers Alexa commands if thresholds are met.
- **Plist Location:** `src/launchagent/com.plugpilot.worker.plist` (installed to `~/Library/LaunchAgents/`).

### 3. Frontend (`src/frontend/`)
A pure HTML/JS/CSS implementation (no heavy frameworks).
- `index.html`: Main dashboard.
- `wizard.html`: Onboarding and Alexa authentication.
- `logs.html`: History of battery actions.
- `styles.css`: Shared styling (supports Dark/Light mode).

### 4. Backend Logic (`src/backend/`)
- `alexa.ts`: Integration with `alexa-remote2`.
- `battery.ts`: Battery status retrieval using `systeminformation`.
- `historydb.ts`: SQLite management for action logs.
- `launchagent.ts`: Management (install/uninstall/status) of the background worker.

## Development & Build Commands

The project uses a `Makefile` to simplify development workflows.

| Command | Description |
| :--- | :--- |
| `make start` | Compiles TypeScript and launches the app in dev mode. |
| `make compile` | Runs `tsc` to compile `src/` to `electron/`. |
| `make build` | Compiles and packages the app into DMG/ZIP with ad-hoc signing. |
| `make reset` | Clears all session cookies, config, and logs. |
| `make kill` | Force-kills all app processes and unloads the LaunchAgent. |
| `make clean` | Removes the `electron/` output directory. |

## Data & Configuration

- **Config:** Stored via `electron-store` in `~/Library/Application Support/plugpilot/plugpilot-config.json`.
- **History:** SQLite database in `~/Library/Application Support/PlugPilot/history.db`.
- **Logs:** Plain text files in `~/Library/Application Support/PlugPilot/logs/`.
- **Encryption:** Sensitive Alexa cookies are encrypted using internal AES-256-CBC (avoids macOS Keychain prompts).

## Development Conventions

- **Surgical Updates:** When modifying code, maintain the existing architecture of separating backend logic from IPC handlers.
- **Vanilla Frontend:** Avoid adding React/Vue unless explicitly requested; keep the frontend lightweight.
- **macOS Specifics:** Always consider the macOS lifecycle (e.g., hiding from Dock, Tray interaction).
- **TypeScript:** Use strict typing where possible.
- **Logging:** Use the internal logger (`src/backend/logger.ts`) for consistency.

## Environment Requirements
- Node.js 22.x
- macOS 12+
- Amazon Alexa account
