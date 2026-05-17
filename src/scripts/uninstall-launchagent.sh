#!/bin/bash
# Uninstall PlugPilot LaunchAgent
# Stops and removes the background worker

set -e

PLIST_NAME="com.plugpilot.worker.plist"
LAUNCH_AGENTS_DIR="$HOME/Library/LaunchAgents"
PLIST_PATH="$LAUNCH_AGENTS_DIR/$PLIST_NAME"

echo "PlugPilot LaunchAgent Uninstaller"
echo "======================================"

if [ -f "$PLIST_PATH" ]; then
    # Unload (stop and disable)
    if launchctl unload "$PLIST_PATH" 2>/dev/null; then
        echo "✓ LaunchAgent unloaded"
    else
        echo "  LaunchAgent was not running (or already unloaded)"
    fi

    # Remove the plist file
    rm -f "$PLIST_PATH"
    echo "✓ Plist removed: $PLIST_PATH"
    echo ""
    echo "✓ PlugPilot background worker has been uninstalled."
    echo "  Battery automation will no longer run in the background."
else
    echo "LaunchAgent not found at: $PLIST_PATH"
    echo "Nothing to uninstall."
fi
