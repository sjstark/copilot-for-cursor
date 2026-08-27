#!/usr/bin/env bash
# Get status of the copilot-for-cursor LaunchAgent service

set -euo pipefail

LABEL="com.$(whoami).copilot-for-cursor"
LOG_DIR="$HOME/.local/share/copilot-for-cursor"

# Colors
GREEN='\033[0;32m'
RED='\033[0;31m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m'

echo -e "${BLUE}📊 Copilot for Cursor Service Status${NC}"
echo ""

# Check if service is installed
PLIST_PATH="$HOME/Library/LaunchAgents/$LABEL.plist"
if [ ! -f "$PLIST_PATH" ]; then
    echo -e "${RED}❌ Service not installed${NC}"
    echo "Install with: ./scripts/install-launch-agent.sh"
    exit 1
fi

echo "✅ Service installed: $PLIST_PATH"
echo ""

# Check if running
if launchctl list | grep -q "$LABEL"; then
    echo -e "${GREEN}✅ Service is running${NC}"
    echo ""
    launchctl list | grep "$LABEL" || true
else
    echo -e "${RED}❌ Service is not running${NC}"
fi

echo ""
echo "📝 Recent logs (last 10 lines):"
echo "════════════════════════════════"
if [ -f "$LOG_DIR/launch.stdout.log" ]; then
    tail -10 "$LOG_DIR/launch.stdout.log" | sed 's/^/   /'
else
    echo "   No logs yet"
fi

echo ""
echo "🔧 Management commands:"
echo "   Restart:   ./scripts/restart-service.sh"
echo "   Stop:      launchctl stop $LABEL"
echo "   Start:     launchctl start $LABEL"
echo "   Uninstall: ./scripts/uninstall-launch-agent.sh"
echo ""
echo "📊 Full logs:"
echo "   stdout: tail -f $LOG_DIR/launch.stdout.log"
echo "   stderr: tail -f $LOG_DIR/launch.stderr.log"
echo ""
echo "🌐 Dashboard: http://localhost:4142"
