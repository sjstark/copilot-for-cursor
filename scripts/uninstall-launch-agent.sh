#!/usr/bin/env bash
set -euo pipefail

LABEL="com.$(whoami).copilot-for-cursor"
PLIST_PATH="$HOME/Library/LaunchAgents/$LABEL.plist"

echo "=== Copilot for Cursor — LaunchAgent Uninstaller ==="

if [[ -f "$PLIST_PATH" ]]; then
  launchctl bootout "gui/$(id -u)/$LABEL" 2>/dev/null || launchctl unload "$PLIST_PATH" 2>/dev/null || true
  rm -f "$PLIST_PATH"
  echo "[OK] LaunchAgent removed"
else
  echo "[OK] LaunchAgent not installed"
fi

# Also remove legacy copilot-tunnel agent if present
LEGACY_LABEL="com.$(whoami).copilot-tunnel"
LEGACY_PLIST="$HOME/Library/LaunchAgents/$LEGACY_LABEL.plist"
if [[ -f "$LEGACY_PLIST" ]]; then
  launchctl bootout "gui/$(id -u)/$LEGACY_LABEL" 2>/dev/null || launchctl unload "$LEGACY_PLIST" 2>/dev/null || true
  rm -f "$LEGACY_PLIST"
  echo "[OK] Removed legacy copilot-tunnel LaunchAgent"
fi

echo ""
echo "Config preserved at: ~/.copilot-proxy/config.json"
echo "Logs preserved at:   ~/.local/share/copilot-for-cursor/"
echo ""
echo "=== Done ==="
