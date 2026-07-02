#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PROJECT_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
LABEL="com.$(whoami).copilot-for-cursor"
DEFAULT_PUBLIC_URL="https://copilot-for-cursor.samstark.me"

echo "=== Copilot for Cursor — LaunchAgent Installer ==="
echo ""

if [[ "$(uname)" != "Darwin" ]]; then
  echo "ERROR: LaunchAgent install is macOS only"
  exit 1
fi

for cmd in bun curl; do
  if ! command -v "$cmd" &>/dev/null; then
    echo "ERROR: $cmd not found in PATH"
    exit 1
  fi
done

BUN_PATH="$(command -v bun)"
PUBLIC_URL="${PUBLIC_URL:-$DEFAULT_PUBLIC_URL}"

if [[ -z "${PUBLIC_URL:-}" ]]; then
  read -rp "Public URL [$DEFAULT_PUBLIC_URL]: " input
  PUBLIC_URL="${input:-$DEFAULT_PUBLIC_URL}"
fi

mkdir -p "$HOME/.copilot-proxy"
cat > "$HOME/.copilot-proxy/config.json" <<EOF
{
  "publicUrl": "$PUBLIC_URL",
  "cursorAutoConfigure": true
}
EOF
echo "[OK] Config saved to ~/.copilot-proxy/config.json"

PLIST_DIR="$HOME/Library/LaunchAgents"
PLIST_PATH="$PLIST_DIR/$LABEL.plist"
LOG_DIR="$HOME/.local/share/copilot-for-cursor"

mkdir -p "$PLIST_DIR" "$LOG_DIR"

cat > "$PLIST_PATH" <<EOF
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN"
  "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key>
  <string>$LABEL</string>

  <key>ProgramArguments</key>
  <array>
    <string>$BUN_PATH</string>
    <string>run</string>
    <string>$PROJECT_DIR/start.ts</string>
    <string>--configure-cursor</string>
  </array>

  <key>WorkingDirectory</key>
  <string>$PROJECT_DIR</string>

  <key>EnvironmentVariables</key>
  <dict>
    <key>PATH</key>
    <string>$HOME/.bun/bin:/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin</string>
    <key>HOME</key>
    <string>$HOME</string>
    <key>PUBLIC_URL</key>
    <string>$PUBLIC_URL</string>
    <key>CURSOR_AUTO_CONFIGURE</key>
    <string>1</string>
  </dict>

  <key>RunAtLoad</key>
  <true/>

  <key>KeepAlive</key>
  <dict>
    <key>SuccessfulExit</key>
    <false/>
  </dict>

  <key>ThrottleInterval</key>
  <integer>10</integer>

  <key>StandardOutPath</key>
  <string>$LOG_DIR/launch.stdout.log</string>
  <key>StandardErrorPath</key>
  <string>$LOG_DIR/launch.stderr.log</string>
</dict>
</plist>
EOF

echo "[OK] LaunchAgent written to $PLIST_PATH"

launchctl bootout "gui/$(id -u)/$LABEL" 2>/dev/null || launchctl unload "$PLIST_PATH" 2>/dev/null || true
launchctl bootstrap "gui/$(id -u)" "$PLIST_PATH" 2>/dev/null || launchctl load "$PLIST_PATH"
launchctl kickstart -k "gui/$(id -u)/$LABEL" 2>/dev/null || true

echo ""
echo "=== Done ==="
echo "Project:  $PROJECT_DIR"
echo "Public:   $PUBLIC_URL/v1"
echo "Logs:     $LOG_DIR/"
echo ""
echo "Manual run:  cd $PROJECT_DIR && bun run start.ts --configure-cursor"
echo "Stop agent:  ./scripts/uninstall-launch-agent.sh"
