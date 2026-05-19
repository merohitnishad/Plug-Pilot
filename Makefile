.PHONY: start build compile reset reset-session reset-logs clean kill help

ELECTRON_STORE := $(HOME)/Library/Application\ Support/plugpilot
APP_SUPPORT    := $(HOME)/Library/Application\ Support/PlugPilot

## Start the app (compile first)
start: compile
	npx electron .

## Compile TypeScript only
compile:
	npx tsc

## Full build (compile + electron-builder + ad-hoc sign for local install)
build: compile
	npx electron-builder
	@echo "Ad-hoc signing for local install (bypasses Gatekeeper)..."
	@if [ -d dist/mac-arm64/PlugPilot.app ]; then \
		xattr -cr dist/mac-arm64/PlugPilot.app && \
		codesign --force --deep --sign - dist/mac-arm64/PlugPilot.app && \
		echo "  ✓ arm64 signed"; \
	fi
	@if [ -d dist/mac/PlugPilot.app ]; then \
		xattr -cr dist/mac/PlugPilot.app && \
		codesign --force --deep --sign - dist/mac/PlugPilot.app && \
		echo "  ✓ x64 signed"; \
	fi

## Reset everything: clear session, logs, config, and history — then start fresh
reset: reset-session reset-logs reset-history
	@echo "App reset complete. Run 'make start' to launch."

## Clear Alexa session and config (forces re-auth on next start)
reset-session:
	@echo "Clearing Alexa session and config..."
	@rm -f $(ELECTRON_STORE)/plugpilot-config.json
	@rm -f $(APP_SUPPORT)/config.json
	@echo "Session cleared."

## Clear action history database
reset-history:
	@echo "Clearing action history..."
	@rm -f $(APP_SUPPORT)/history.db
	@echo "History cleared."

## Clear all logs
reset-logs:
	@echo "Clearing logs..."
	@rm -f $(APP_SUPPORT)/logs/*.log
	@rm -f $(APP_SUPPORT)/logs/*.log.old
	@echo "Logs cleared."

## Kill all running instances of the app (Electron + background worker)
kill:
	@echo "Killing PlugPilot processes..."
	@pkill -f "electron ."                        2>/dev/null || true
	@pkill -f "Electron"                          2>/dev/null || true
	@pkill -f "PlugPilot"                         2>/dev/null || true
	@pkill -f "plugpilot"                         2>/dev/null || true
	@pkill -f "worker.js"                         2>/dev/null || true
	@pkill -f "com.plugpilot"                     2>/dev/null || true
	@pkill -f "smart/electron"                    2>/dev/null || true
	@launchctl unload ~/Library/LaunchAgents/com.plugpilot.worker.plist 2>/dev/null || true
	@sleep 1
	@# Force-kill anything still holding the port or lingering
	@pgrep -f "PlugPilot|plugpilot|worker.js|com.plugpilot" | xargs kill -9 2>/dev/null || true
	@echo "Done."

## Remove compiled output
clean:
	@echo "Removing compiled output..."
	@rm -rf electron/
	@echo "Done."

help:
	@echo ""
	@echo "Usage: make <target>"
	@echo ""
	@echo "  start          Compile and start the app"
	@echo "  compile        Compile TypeScript (src/ -> electron/)"
	@echo "  build          Compile + package with electron-builder"
	@echo "  reset          Clear session + logs, then prompt to start"
	@echo "  reset-session  Clear stored Alexa cookies and config"
	@echo "  reset-logs     Clear all log files"
	@echo "  kill           Kill all running app processes and stop LaunchAgent"
	@echo "  clean          Remove compiled electron/ output"
	@echo ""
