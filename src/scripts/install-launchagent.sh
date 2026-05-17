#!/bin/bash
# Install PlugPilot LaunchAgent
# This script installs the background worker as a macOS LaunchAgent

set -e

PLIST_NAME="com.plugpilot.worker.plist"
LAUNCH_AGENTS_DIR="$HOME/Library/LaunchAgents"
PLIST_DEST="$LAUNCH_AGENTS_DIR/$PLIST_NAME"
APP_SUPPORT="$HOME/Library/Application Support/PlugPilot"
LOG_DIR="$APP_SUPPORT/logs"

# Find node
NODE_PATH=$(which node 2>/dev/null || which /usr/local/bin/node 2>/dev/null || echo "/usr/local/bin/node")

# Find worker.js - try multiple locations
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
APP_DIR="$(dirname "$SCRIPT_DIR")"
WORKER_PATH="$APP_DIR/backend/worker.js"

# Also check if running from packaged app
if [ ! -f "$WORKER_PATH" ]; then
    WORKER_PATH="$(dirname "$APP_DIR")/Resources/backend/worker.js"
fi

if [ ! -f "$WORKER_PATH" ]; then
    echo "ERROR: worker.js not found. Expected at: $APP_DIR/backend/worker.js"
    exit 1
fi

echo "PlugPilot LaunchAgent Installer"
echo "===================================="
echo "Node: $NODE_PATH"
echo "Worker: $WORKER_PATH"
echo "Log Dir: $LOG_DIR"
echo ""

# Create directories
mkdir -p "$LAUNCH_AGENTS_DIR"
mkdir -p "$LOG_DIR"
mkdir -p "$APP_SUPPORT"

# Generate the plist with correct paths
cat > "$PLIST_DEST" << EOF
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
    <key>Label</key>
    <string>com.plugpilot.worker</string>
    <key>ProgramArguments</key>
    <array>
        <string>${NODE_PATH}</string>
        <string>${WORKER_PATH}</string>
    </array>
    <key>RunAtLoad</key>
    <true/>
    <key>StartInterval</key>
    <integer>120</integer>
    <key>StandardOutPath</key>
    <string>${LOG_DIR}/worker.log</string>
    <key>StandardErrorPath</key>
    <string>${LOG_DIR}/worker-error.log</string>
    <key>EnvironmentVariables</key>
    <dict>
        <key>HOME</key>
        <string>${HOME}</string>
        <key>PATH</key>
        <string>/usr/local/bin:/usr/bin:/bin:/opt/homebrew/bin:/opt/homebrew/sbin</string>
    </dict>
    <key>KeepAlive</key>
    <false/>
</dict>
</plist>
EOF

echo "Plist written to: $PLIST_DEST"

# Unload if already loaded (ignore errors)
launchctl unload "$PLIST_DEST" 2>/dev/null || true

# Load the LaunchAgent
if launchctl load "$PLIST_DEST"; then
    echo ""
    echo "✓ LaunchAgent installed and loaded successfully!"
    echo "  The battery worker will run every 2 minutes in the background."
    echo "  Logs: $LOG_DIR/"
else
    echo ""
    echo "ERROR: Failed to load LaunchAgent"
    exit 1
fi
