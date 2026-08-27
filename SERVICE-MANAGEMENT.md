# Service Management Guide

## 📦 Managing the LaunchAgent Service

The copilot-for-cursor proxy can run as a macOS LaunchAgent service that starts automatically at login.

---

## 🚀 Quick Reference

```bash
# Install service
./scripts/install-launch-agent.sh
# or
bun run service:install

# Restart service (after code updates)
./scripts/restart-service.sh
# or
bun run service:restart

# Check status
./scripts/service-status.sh
# or
bun run service:status

# Uninstall service
./scripts/uninstall-launch-agent.sh
# or
bun run service:uninstall
```

---

## 📖 Detailed Commands

### Install Service

```bash
cd /Users/samstark/copilot-for-cursor
./scripts/install-launch-agent.sh
```

**What it does:**
- Creates LaunchAgent plist at `~/Library/LaunchAgents/com.$(whoami).copilot-for-cursor.plist`
- Configures auto-start at login
- Sets up automatic restart on crashes
- Creates log directory at `~/.local/share/copilot-for-cursor/`
- Starts the service immediately

**After installation:**
- Service runs automatically at login
- Restarts if it crashes (after 10 second throttle)
- Cursor is auto-configured with models

---

### Restart Service

```bash
./scripts/restart-service.sh
```

**When to use:**
- ✅ After pulling new code (`git pull`)
- ✅ After editing any `.ts` files
- ✅ After modifying configuration
- ✅ When dashboard features stop working
- ✅ To pick up new auth endpoints

**What it does:**
- Stops the current process
- Starts a fresh instance
- Verifies it's running
- Shows status and logs

**Alternative methods:**
```bash
# Using launchctl directly
launchctl kickstart -k "gui/$(id -u)/com.$(whoami).copilot-for-cursor"

# Or manual stop/start
launchctl stop com.$(whoami).copilot-for-cursor
launchctl start com.$(whoami).copilot-for-cursor
```

---

### Check Status

```bash
./scripts/service-status.sh
```

**Shows:**
- ✅ Installation status
- ✅ Running/stopped state
- ✅ Recent logs (last 10 lines)
- ✅ Management commands
- ✅ Log file locations

**Sample output:**
```
📊 Copilot for Cursor Service Status

✅ Service installed: /Users/you/Library/LaunchAgents/...
✅ Service is running

   12345  0   com.you.copilot-for-cursor

📝 Recent logs (last 10 lines):
════════════════════════════════
   🚀 Starting Copilot Proxy Stack...
   ✅ copilot-api is ready on port 4141
   🔐 Dashboard auth: no password yet
   🚀 Proxy Router running on http://localhost:4142
```

---

### View Logs

**Real-time logs:**
```bash
# Standard output (main logs)
tail -f ~/.local/share/copilot-for-cursor/launch.stdout.log

# Error output
tail -f ~/.local/share/copilot-for-cursor/launch.stderr.log

# Both at once
tail -f ~/.local/share/copilot-for-cursor/launch.*.log
```

**Search logs:**
```bash
# Find errors
grep -i error ~/.local/share/copilot-for-cursor/launch.stderr.log

# Find auth messages
grep "Dashboard auth" ~/.local/share/copilot-for-cursor/launch.stdout.log

# Last 100 lines
tail -100 ~/.local/share/copilot-for-cursor/launch.stdout.log
```

---

### Uninstall Service

```bash
./scripts/uninstall-launch-agent.sh
```

**What it does:**
- Stops the service
- Removes the LaunchAgent plist
- Keeps logs and config (manual cleanup if needed)

**Manual cleanup (optional):**
```bash
# Remove logs
rm -rf ~/.local/share/copilot-for-cursor/

# Remove config
rm -rf ~/.copilot-proxy/

# Remove auth data
rm ~/.copilot-proxy/dashboard-auth.json
```

---

## 🔧 Advanced Management

### Manual LaunchAgent Commands

```bash
LABEL="com.$(whoami).copilot-for-cursor"

# Check if loaded
launchctl list | grep copilot-for-cursor

# Full status
launchctl list $LABEL

# Load (if not loaded)
launchctl load ~/Library/LaunchAgents/$LABEL.plist

# Unload (stop and disable)
launchctl unload ~/Library/LaunchAgents/$LABEL.plist

# Bootstrap (modern macOS)
launchctl bootstrap "gui/$(id -u)" ~/Library/LaunchAgents/$LABEL.plist

# Bootout (modern macOS)
launchctl bootout "gui/$(id -u)/$LABEL"

# Restart (kill and restart)
launchctl kickstart -k "gui/$(id -u)/$LABEL"
```

---

## 🐛 Troubleshooting

### Service won't start

```bash
# Check if plist exists
ls -l ~/Library/LaunchAgents/com.*.copilot-for-cursor.plist

# Check for errors in plist
plutil -lint ~/Library/LaunchAgents/com.*.copilot-for-cursor.plist

# Check logs
cat ~/.local/share/copilot-for-cursor/launch.stderr.log

# Try manual start
cd /Users/samstark/copilot-for-cursor
bun run start.ts --configure-cursor
```

### Service keeps crashing

```bash
# Check error logs
tail -50 ~/.local/share/copilot-for-cursor/launch.stderr.log

# Common issues:
# - Port 4141/4142 already in use
# - Bun not found in PATH
# - Node modules missing (run: bun install)
```

### Service installed but not running

```bash
# Force restart
./scripts/restart-service.sh

# Or manually
launchctl kickstart -k "gui/$(id -u)/com.$(whoami).copilot-for-cursor"

# Check system log
log stream --predicate 'subsystem == "com.apple.launchd"' --level debug
```

### Changes not taking effect

**You must restart the service!**
```bash
./scripts/restart-service.sh
```

The service loads code when it starts. Editing files won't affect the running process.

---

## 📊 Log File Locations

```
~/.local/share/copilot-for-cursor/
├── launch.stdout.log    # Main output
└── launch.stderr.log    # Errors

~/.copilot-proxy/
├── config.json          # Configuration
├── usage.json           # Usage tracking
└── dashboard-auth.json  # Password hash
```

---

## 🔄 Workflow Examples

### After pulling updates

```bash
git pull
./scripts/restart-service.sh
```

### After editing code

```bash
# Edit files...
./scripts/restart-service.sh

# Verify it's working
./scripts/service-status.sh
```

### Debugging issues

```bash
# Check status
./scripts/service-status.sh

# View logs
tail -f ~/.local/share/copilot-for-cursor/launch.stdout.log

# In another terminal, restart
./scripts/restart-service.sh
```

### Clean reinstall

```bash
# Uninstall
./scripts/uninstall-launch-agent.sh

# Clean up
rm -rf ~/.local/share/copilot-for-cursor/
rm -rf ~/.copilot-proxy/

# Reinstall
./scripts/install-launch-agent.sh
```

---

## 💡 Pro Tips

1. **Always restart after code changes** - The service loads code once at startup
2. **Check logs first** - Most issues are visible in the logs
3. **Use the scripts** - They handle edge cases better than manual commands
4. **Monitor on updates** - Tail logs after restarting to catch startup errors
5. **Keep logs clean** - Old logs accumulate; clean them periodically

---

## 🎯 Quick Troubleshooting

| Problem | Solution |
|---------|----------|
| Connection error in dashboard | `./scripts/restart-service.sh` |
| Auth not working | Restart service, check logs |
| Port already in use | Find and kill conflicting process |
| Service not auto-starting | Check plist, reinstall service |
| Changes not appearing | **Restart the service!** |

---

## ✅ Best Practices

1. **Development**: Don't use the service, run manually: `bun run start.ts`
2. **Production**: Use the service for reliability
3. **Updates**: Always `git pull` → `./scripts/restart-service.sh`
4. **Monitoring**: Periodically check `./scripts/service-status.sh`
5. **Logs**: Rotate logs monthly to prevent disk bloat

---

Your service management is now streamlined with easy-to-use scripts! 🚀
