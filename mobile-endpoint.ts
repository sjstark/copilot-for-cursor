// ── Mobile-Optimized Endpoint ────────────────────────────────────────────────
// Lightweight endpoint optimized for mobile access with additional safeguards

import { validateApiKey } from './auth-config';
import { checkBudgetExceeded, calculateCost, trackSpending } from './cost-tracking';
import { retryFetch } from './retry-logic';
import { selectModel } from './smart-router';

const MOBILE_PORT = 4143;
const UPSTREAM_URL = 'http://localhost:4142';

// Mobile-specific rate limiting
const rateLimitMap = new Map<string, { count: number; resetAt: number }>();
const RATE_LIMIT_WINDOW = 60000; // 1 minute
const RATE_LIMIT_MAX = 30; // 30 requests per minute per API key

function checkRateLimit(apiKey: string): boolean {
    const now = Date.now();
    const record = rateLimitMap.get(apiKey);
    
    if (!record || now > record.resetAt) {
        rateLimitMap.set(apiKey, { count: 1, resetAt: now + RATE_LIMIT_WINDOW });
        return true;
    }
    
    if (record.count >= RATE_LIMIT_MAX) {
        return false;
    }
    
    record.count++;
    return true;
}

Bun.serve({
    port: MOBILE_PORT,
    async fetch(req) {
        const url = new URL(req.url);
        
        // CORS headers for mobile browsers
        const corsHeaders = {
            'Access-Control-Allow-Origin': '*',
            'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
            'Access-Control-Allow-Headers': 'Content-Type, Authorization',
        };
        
        if (req.method === 'OPTIONS') {
            return new Response(null, { headers: corsHeaders });
        }
        
        // Health check endpoint
        if (url.pathname === '/health') {
            return Response.json({ status: 'ok', timestamp: Date.now() }, { headers: corsHeaders });
        }
        
        // Mobile-friendly dashboard
        if (url.pathname === '/' || url.pathname === '/mobile') {
            return new Response(getMobileDashboardHTML(), {
                headers: { 'Content-Type': 'text/html', ...corsHeaders }
            });
        }
        
        // API endpoints - require authentication
        if (url.pathname.startsWith('/v1/')) {
            const authHeader = req.headers.get('authorization');
            const apiKey = authHeader?.replace('Bearer ', '');
            
            if (!apiKey || !validateApiKey(apiKey)) {
                return Response.json(
                    { error: 'Invalid or missing API key' },
                    { status: 401, headers: corsHeaders }
                );
            }
            
            // Rate limiting
            if (!checkRateLimit(apiKey)) {
                return Response.json(
                    { error: 'Rate limit exceeded. Max 30 requests per minute.' },
                    { status: 429, headers: corsHeaders }
                );
            }
            
            // Budget check
            if (checkBudgetExceeded()) {
                return Response.json(
                    { error: 'Budget limit exceeded' },
                    { status: 429, headers: corsHeaders }
                );
            }
            
            // Forward to main proxy with mobile headers
            const upstreamUrl = new URL(url.pathname + url.search, UPSTREAM_URL);
            const headers = new Headers(req.headers);
            headers.set('X-Mobile-Client', 'true');
            headers.set('X-Mobile-Device', 'iPhone');
            
            try {
                const result = await retryFetch(upstreamUrl.toString(), {
                    method: req.method,
                    headers: headers,
                    body: req.body,
                });
                
                if (!result.success) {
                    return Response.json(
                        { error: 'Upstream request failed after retries' },
                        { status: 502, headers: corsHeaders }
                    );
                }
                
                const response = result.result!;
                const responseHeaders = new Headers(response.headers);
                Object.entries(corsHeaders).forEach(([k, v]) => responseHeaders.set(k, v));
                
                return new Response(response.body, {
                    status: response.status,
                    headers: responseHeaders,
                });
            } catch (error: any) {
                console.error('Mobile endpoint error:', error);
                return Response.json(
                    { error: error?.message || 'Request failed' },
                    { status: 500, headers: corsHeaders }
                );
            }
        }
        
        return Response.json(
            { error: 'Not found' },
            { status: 404, headers: corsHeaders }
        );
    }
});

function getMobileDashboardHTML(): string {
    return `<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0, maximum-scale=1.0, user-scalable=no">
    <meta name="apple-mobile-web-app-capable" content="yes">
    <meta name="apple-mobile-web-app-status-bar-style" content="black-translucent">
    <title>Copilot Mobile</title>
    <style>
        * { margin: 0; padding: 0; box-sizing: border-box; }
        body {
            font-family: -apple-system, BlinkMacSystemFont, 'SF Pro', sans-serif;
            background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
            min-height: 100vh;
            color: #fff;
            padding: 20px;
            padding-top: max(20px, env(safe-area-inset-top));
            padding-bottom: max(20px, env(safe-area-inset-bottom));
        }
        .container { max-width: 600px; margin: 0 auto; }
        h1 {
            font-size: 28px;
            font-weight: 700;
            margin-bottom: 8px;
            letter-spacing: -0.5px;
        }
        .subtitle {
            opacity: 0.8;
            font-size: 14px;
            margin-bottom: 24px;
        }
        .card {
            background: rgba(255,255,255,0.15);
            backdrop-filter: blur(10px);
            border-radius: 16px;
            padding: 20px;
            margin-bottom: 16px;
            box-shadow: 0 8px 32px rgba(0,0,0,0.2);
        }
        .card h2 {
            font-size: 16px;
            margin-bottom: 12px;
            opacity: 0.9;
        }
        .endpoint {
            background: rgba(0,0,0,0.3);
            padding: 12px;
            border-radius: 8px;
            font-family: 'SF Mono', monospace;
            font-size: 13px;
            word-break: break-all;
            margin-bottom: 8px;
        }
        .btn {
            background: rgba(255,255,255,0.9);
            color: #667eea;
            border: none;
            padding: 12px 20px;
            border-radius: 12px;
            font-weight: 600;
            font-size: 15px;
            width: 100%;
            margin-top: 8px;
            cursor: pointer;
            -webkit-tap-highlight-color: transparent;
        }
        .btn:active { transform: scale(0.98); }
        .status { display: flex; align-items: center; gap: 8px; margin-top: 12px; }
        .status-dot {
            width: 10px;
            height: 10px;
            border-radius: 50%;
            background: #4ade80;
            animation: pulse 2s infinite;
        }
        @keyframes pulse {
            0%, 100% { opacity: 1; }
            50% { opacity: 0.5; }
        }
        .stats {
            display: grid;
            grid-template-columns: 1fr 1fr;
            gap: 12px;
            margin-top: 12px;
        }
        .stat {
            background: rgba(0,0,0,0.2);
            padding: 12px;
            border-radius: 8px;
            text-align: center;
        }
        .stat-value {
            font-size: 24px;
            font-weight: 700;
            margin-bottom: 4px;
        }
        .stat-label {
            font-size: 12px;
            opacity: 0.7;
        }
    </style>
</head>
<body>
    <div class="container">
        <h1>🚀 Copilot Mobile</h1>
        <div class="subtitle">Access your AI proxy from iPhone</div>
        
        <div class="card">
            <h2>📡 Endpoint</h2>
            <div class="endpoint" id="endpoint">https://copilot-for-cursor.samstark.me/v1</div>
            <button class="btn" onclick="copyEndpoint()">Copy Endpoint</button>
            <div class="status">
                <div class="status-dot"></div>
                <span>Connected</span>
            </div>
        </div>
        
        <div class="card">
            <h2>📊 Usage Stats</h2>
            <div class="stats">
                <div class="stat">
                    <div class="stat-value" id="requests">—</div>
                    <div class="stat-label">Requests</div>
                </div>
                <div class="stat">
                    <div class="stat-value" id="cost">—</div>
                    <div class="stat-label">Cost</div>
                </div>
            </div>
            <button class="btn" onclick="refreshStats()" style="margin-top: 16px">Refresh Stats</button>
        </div>
        
        <div class="card">
            <h2>🔑 API Key</h2>
            <p style="font-size: 13px; opacity: 0.8; margin-bottom: 12px;">
                Generate a key from the desktop dashboard, then use it in your mobile AI apps.
            </p>
            <button class="btn" onclick="openDashboard()">Open Dashboard</button>
        </div>
    </div>
    
    <script>
        function copyEndpoint() {
            const endpoint = document.getElementById('endpoint').textContent;
            navigator.clipboard.writeText(endpoint).then(() => {
                alert('Endpoint copied!');
            });
        }
        
        async function refreshStats() {
            try {
                const res = await fetch('${UPSTREAM_URL}/api/usage');
                const data = await res.json();
                document.getElementById('requests').textContent = data.totalRequests || 0;
                document.getElementById('cost').textContent = '$' + (data.totalCost || 0).toFixed(2);
            } catch (e) {
                console.error('Failed to fetch stats:', e);
            }
        }
        
        function openDashboard() {
            window.location.href = 'https://copilot-for-cursor.samstark.me/';
        }
        
        // Auto-refresh stats on load
        refreshStats();
    </script>
</body>
</html>`;
}

console.log(`📱 Mobile endpoint running on http://localhost:${MOBILE_PORT}`);
console.log(`   Mobile dashboard: http://localhost:${MOBILE_PORT}/mobile`);
console.log(`   Health check: http://localhost:${MOBILE_PORT}/health`);
