#!/usr/bin/env bash
# Restart the copilot-for-cursor LaunchAgent service

set -euo pipefail

LABEL="com.$(whoami).copilot-for-cursor"

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

echo -e "${BLUE}🔄 Restarting Copilot for Cursor service...${NC}"

# Check if service is installed
if ! launchctl list | grep -q "$LABEL"; then
    echo -e "${RED}❌ Service not installed${NC}"
    echo "Install it first with: ./scripts/install-launch-agent.sh"
    exit 1
fi

# Restart the service
echo "Stopping service..."
launchctl kickstart -k "gui/$(id -u)/$LABEL" 2>/dev/null || {
    echo -e "${YELLOW}⚠️  kickstart failed, trying bootout/bootstrap...${NC}"
    launchctl bootout "gui/$(id -u)/$LABEL" 2>/dev/null || true
    sleep 1
    PLIST_PATH="$HOME/Library/LaunchAgents/$LABEL.plist"
    launchctl bootstrap "gui/$(id -u)" "$PLIST_PATH" 2>/dev/null || launchctl load "$PLIST_PATH"
}

echo "Waiting for service to restart..."
sleep 2

# Check if service is running
if launchctl list | grep -q "$LABEL"; then
    echo -e "${GREEN}✅ Service restarted successfully${NC}"
    echo ""
    echo "📊 Check status:"
    echo "   launchctl list | grep copilot-for-cursor"
    echo ""
    echo "📝 View logs:"
    echo "   tail -f ~/.local/share/copilot-for-cursor/launch.stdout.log"
    echo ""
    echo "🌐 Dashboard:"
    echo "   http://localhost:4142"
else
    echo -e "${RED}❌ Service failed to start${NC}"
    echo "Check logs at: ~/.local/share/copilot-for-cursor/"
    exit 1
fi
