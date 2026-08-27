# 🔧 Quick Fix: Connection Error

## Problem
You're getting a "connection error" because the server is running an **old version** without the new auth endpoints.

## ✅ Solution: Restart the Server

### Step 1: Stop the Current Server

Find and kill the running process:

```bash
# Find the process
lsof -ti:4142

# Kill it
kill $(lsof -ti:4142)

# Or more forcefully if needed
kill -9 $(lsof -ti:4142)
```

### Step 2: Start the New Version

```bash
cd /Users/samstark/copilot-for-cursor
bun run start.ts
```

You should see:
```
🔐 Dashboard auth: no password yet
🚀 Proxy Router running on http://localhost:4142
```

### Step 3: Test the Dashboard

1. Open `http://localhost:4142`
2. You should see the "Set Dashboard Password" modal
3. Enter a password (min 6 characters)
4. Confirm it
5. Click Continue
6. ✅ You're in!

---

## 🧪 Verify Auth Endpoints

Test if the endpoints are working:

```bash
# Check auth status
curl http://localhost:4142/api/auth/status

# Should return:
# {"passwordSet":false,"sessionCount":0}
```

Or run the test script:

```bash
bun run test-auth.ts
```

---

## 🔍 Troubleshooting

### "Port 4142 already in use"

```bash
# Kill the old process
kill -9 $(lsof -ti:4142)

# Wait a second
sleep 1

# Start again
bun run start.ts
```

### "404 Not Found" on /api/auth/status

The server is running an old version. Follow Step 1 and 2 above.

### Still getting connection error?

1. Check browser console (F12) for the actual error
2. Verify the server is running: `curl http://localhost:4142/api/auth/status`
3. Make sure you're using `http://localhost:4142` (not the tunnel URL for first setup)

---

## 💡 Why This Happened

The new server-side auth feature requires:
1. New file: `dashboard-auth.ts` ✅
2. New endpoints in `proxy-router.ts` ✅
3. Updated `dashboard.html` ✅
4. **Server restart to load new code** ⚠️ ← You need to do this!

Once restarted, the password will work for everyone! 🎉
