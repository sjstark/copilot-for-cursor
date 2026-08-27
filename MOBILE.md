# 📱 Mobile Access Guide

## Accessing Copilot from Your iPhone 17

Your proxy is already accessible from your iPhone through the Cloudflare tunnel! Here's how to use it.

---

## 🌐 Quick Start

### Your Mobile Endpoint
```
https://copilot-for-cursor.samstark.me/v1
```

This works **right now** from your iPhone - no additional setup needed!

---

## 🔐 Step-by-Step Setup

### 1. Enable API Key Protection (Recommended)

**From Desktop:**
1. Open `http://localhost:4142` in your browser
2. Go to **Endpoint** tab
3. Toggle **"Require API Key"** to ON
4. Click **"+ Create Key"**
5. Name it "iPhone 17"
6. **Copy the key immediately** (it won't be shown again!)

**Or via Terminal:**
```bash
# Enable API key requirement
curl -X PUT http://localhost:4142/api/settings/auth \
  -H 'Content-Type: application/json' \
  -d '{"requireApiKey": true}'

# Create mobile-specific key
curl -X POST http://localhost:4142/api/keys \
  -H 'Content-Type: application/json' \
  -d '{"name": "iPhone 17"}'
```

### 2. Configure Your Mobile App

Use these settings in any OpenAI-compatible iOS app:

```
API Endpoint:  https://copilot-for-cursor.samstark.me/v1
API Key:       cpk-xxxxxxxxxxxxxxxx  (from step 1)
Model:         cus-claude-sonnet-4.6
```

Available models (all with `cus-` prefix):
- `cus-claude-sonnet-4.6` - Recommended for mobile
- `cus-claude-haiku-4.5` - Fastest, cheapest
- `cus-gpt-5-mini` - Fast GPT alternative
- `cus-gpt-5.4` - Premium GPT
- See full list at: `https://copilot-for-cursor.samstark.me/`

---

## 📱 Recommended iOS Apps

### Apps That Support Custom OpenAI Endpoints:

1. **OpenCat** (Recommended)
   - Native iOS app
   - Supports custom endpoints
   - Beautiful UI
   - https://apps.apple.com/app/opencat/id6445999569

2. **ChatGPT-compatible apps**
   - Search for "OpenAI compatible" in App Store
   - Look for "custom endpoint" or "API URL" settings

3. **iOS Shortcuts**
   - Create custom AI workflows
   - Make HTTP requests to your endpoint
   - See example shortcut below

---

## 🤖 iOS Shortcuts Example

Create a Siri shortcut to use your proxy:

### Simple Chat Shortcut:

1. Open **Shortcuts** app
2. Create new shortcut
3. Add these actions:

```
Ask for Input
  ↓ (prompt text)
Text (JSON body):
  {
    "model": "cus-claude-sonnet-4.6",
    "messages": [{"role": "user", "content": "[Input]"}],
    "max_tokens": 1000
  }
  ↓
Get Contents of URL
  URL: https://copilot-for-cursor.samstark.me/v1/chat/completions
  Method: POST
  Headers:
    Content-Type: application/json
    Authorization: Bearer cpk-your-key-here
  Request Body: [Previous result]
  ↓
Get Dictionary Value
  Key: choices[0].message.content
  ↓
Show Result
```

Name it "Ask Copilot" and you can invoke with Siri!

---

## 📊 Monitor Usage from Mobile

### Mobile Dashboard

Visit in Safari:
```
https://copilot-for-cursor.samstark.me/
```

Add to Home Screen:
1. Open URL in Safari
2. Tap Share button
3. Select "Add to Home Screen"
4. Now you have a home screen icon!

### Check Stats via API

```bash
# Using Shortcuts or any HTTP client
GET https://copilot-for-cursor.samstark.me/api/usage
```

Returns:
```json
{
  "totalRequests": 150,
  "totalCost": 0.25,
  "totalTokens": 50000,
  ...
}
```

---

## 🔒 Security Best Practices

### 1. Use API Keys
- Always enable API key protection
- Create separate keys for each device
- Revoke keys if compromised

### 2. Monitor Usage
- Check dashboard regularly
- Set budget limits
- Review per-model costs

### 3. Rate Limiting
Your proxy has built-in protection:
- 30 requests/minute per API key (if using mobile endpoint)
- Budget enforcement
- Automatic retry on errors

### 4. HTTPS Only
- Always use `https://` endpoint
- Never share your API key
- Don't commit keys to git

---

## 🚀 Advanced: Dedicated Mobile Endpoint

For extra mobile optimizations, run the dedicated mobile endpoint:

```bash
# Start mobile-specific endpoint on port 4143
bun run mobile-endpoint.ts
```

Features:
- Mobile-optimized rate limiting
- Simpler responses
- Mobile-friendly dashboard
- Additional safeguards

Then update your Cloudflare tunnel to expose port 4143 for mobile traffic.

---

## 🎯 Use Cases

### 1. Voice Assistant
- Use Siri Shortcuts
- Ask questions hands-free
- Get responses via voice

### 2. Mobile Coding
- Use coding-focused AI apps
- Access Codex models on the go
- Debug code from anywhere

### 3. Quick Queries
- Fast responses with Haiku
- Low-cost simple questions
- Always-available assistant

### 4. Multi-Device Workflows
- Start conversation on desktop
- Continue on mobile
- Unified usage tracking

---

## 🐛 Troubleshooting

### "Invalid API Key"
- Ensure key starts with `cpk-`
- Check it's copied correctly
- Verify it's active in dashboard

### "Connection Failed"
- Check your Mac is running the proxy
- Verify Cloudflare tunnel is active
- Test with: `curl https://copilot-for-cursor.samstark.me/api/usage`

### "Budget Exceeded"
- Check dashboard for spending
- Adjust limits if needed
- Wait for daily reset

### Slow Responses
- Switch to faster models (Haiku, Mini)
- Check your internet connection
- Enable smart routing for auto-optimization

---

## 📝 Example: Full iOS Shortcut

**Advanced Shortcut with Model Selection:**

```
1. Choose from Menu
   - "Fast (Haiku)" 
   - "Smart (Sonnet)"
   - "Best (Opus)"
   
2. Set Variable: model
   - If Haiku: cus-claude-haiku-4.5
   - If Sonnet: cus-claude-sonnet-4.6
   - If Opus: cus-claude-opus-4.8

3. Ask for Input
   
4. Text (JSON):
   {
     "model": "[model]",
     "messages": [{"role": "user", "content": "[Input]"}],
     "max_tokens": 2000,
     "stream": false
   }

5. Get Contents of URL
   URL: https://copilot-for-cursor.samstark.me/v1/chat/completions
   Method: POST
   Headers:
     Content-Type: application/json
     Authorization: Bearer cpk-YOUR-KEY
   Body: [JSON from step 4]

6. Get Dictionary Value: choices[0].message.content

7. Show Result or Speak Text
```

---

## 🎉 You're All Set!

Your iPhone can now:
- ✅ Access all Copilot models
- ✅ Use via Siri shortcuts
- ✅ Monitor usage and costs
- ✅ Work from anywhere with internet

**Test it now:**
```bash
# From your iPhone (using Shortcuts or any HTTP client)
curl -X POST https://copilot-for-cursor.samstark.me/v1/chat/completions \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer cpk-YOUR-KEY" \
  -d '{
    "model": "cus-claude-sonnet-4.6",
    "messages": [{"role": "user", "content": "Hello from iPhone!"}]
  }'
```

Happy mobile AI usage! 🚀📱
