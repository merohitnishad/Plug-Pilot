# Contributing to PlugPilot

Thanks for your interest! Contributions are welcome — bug fixes, features, and documentation improvements.

## Getting started

```bash
git clone https://github.com/merohitnishad/Plug-Pilot.git
cd Plug-Pilot
npm install
make start   # compile TypeScript + launch
```

## Workflow

1. Fork the repo
2. Create a branch: `git checkout -b feature/my-feature`
3. Make your changes
4. Test manually with `make start`
5. Commit: `git commit -m 'short description'`
6. Push: `git push origin feature/my-feature`
7. Open a Pull Request

## Guidelines

- **macOS only** — this app is intentionally macOS-specific; don't add cross-platform shims
- **No new dependencies** unless necessary — keep the bundle lean
- **Security**: never log cookies, tokens, or passwords — only `.message` from errors
- **TypeScript** for all backend code (`src/`); vanilla JS is fine for frontend
- For major changes, open an issue first to discuss

## Development commands

| Command | What it does |
|---------|-------------|
| `make compile` | TypeScript → `electron/` |
| `make start` | compile + launch Electron |
| `make build` | compile + package DMG + ZIP |
| `make reset-session` | clear stored cookies / force re-auth |
| `make reset-logs` | clear all log files |
| `make kill` | kill all instances + unload LaunchAgent |
| `make clean` | remove compiled `electron/` output |

## Reporting bugs

Open a GitHub issue with:
- macOS version + chip (Apple Silicon / Intel)
- Steps to reproduce
- Relevant log lines from `~/Library/Application Support/PlugPilot/logs/`

For security issues, see [SECURITY.md](SECURITY.md).
