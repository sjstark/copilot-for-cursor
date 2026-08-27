import { normalizeRequest } from './anthropic-transforms';
import { handleResponsesAPIBridge } from './responses-bridge';
import { createStreamProxy } from './stream-proxy';
import { logIncomingRequest, logTransformedRequest } from './debug-logger';
import { addRequestLog, getNextRequestId, getUsageStats, flushToDisk, type RequestLog } from './usage-db';
import { loadAuthConfig, saveAuthConfig, generateApiKey, validateApiKey } from './auth-config';
import { getUpstreamAuthHeader, getUpstreamApiKeys, createUpstreamApiKey, deleteUpstreamApiKey } from './upstream-auth';
import { compactIfNeeded, isMaxMode } from './max-mode';
import { needsResponsesAPI, normalizeModelId, resolveModelForUpstream, needsLowReasoningEffort, COPILOT_MODEL_PREFIX, isCopilotRoutedModel, withCopilotPrefix } from './model-routing';
import { getPersonalUpstream, personalAuthHeader, joinUpstreamPath, personalModelsUrl, extraPersonalModelIds } from './personal-upstream';
import { getTunnelState, configureCursor, subscribeTunnel } from './tunnel';
import { getBudgetStatus, checkBudgetExceeded } from './cost-tracking';
import { retryFetch } from './retry-logic';
import { selectModel, getRoutingConfig, setRoutingConfig } from './smart-router';
import { isPasswordSet, createAuthSession, checkAuthSession, destroyAuthSession, getAuthStatus, resetPassword as resetDashboardPassword } from './dashboard-auth';

// ── Console capture for SSE streaming ─────────────────────────────────────────
interface ConsoleLine {
    timestamp: number;
    level: 'LOG' | 'INFO' | 'WARN' | 'ERROR' | 'DEBUG';
    message: string;
}

const consoleLines: ConsoleLine[] = [];
const MAX_CONSOLE_LINES = 500;
const logSubscribers = new Set<ReadableStreamDefaultController>();

const origLog = console.log;
const origError = console.error;
const origWarn = console.warn;

function addConsoleLine(level: ConsoleLine['level'], args: any[]) {
    const message = args.map(a => typeof a === 'string' ? a : JSON.stringify(a)).join(' ');
    const line: ConsoleLine = { timestamp: Date.now(), level, message };
    consoleLines.push(line);
    if (consoleLines.length > MAX_CONSOLE_LINES) consoleLines.shift();
    const data = `data: ${JSON.stringify({ type: 'line', ...line })}\n\n`;
    for (const ctrl of logSubscribers) {
        try { ctrl.enqueue(new TextEncoder().encode(data)); } catch { logSubscribers.delete(ctrl); }
    }
}

console.log = (...args: any[]) => { origLog(...args); addConsoleLine('LOG', args); };
console.error = (...args: any[]) => { origError(...args); addConsoleLine('ERROR', args); };
console.warn = (...args: any[]) => { origWarn(...args); addConsoleLine('WARN', args); };

// ── Config ────────────────────────────────────────────────────────────────────
const PORT = 4142;
const TARGET_URL = "http://localhost:4141";
const PREFIX = COPILOT_MODEL_PREFIX;
const personalUpstream = getPersonalUpstream();
let responseCounter = 0;

console.log(`🚀 Proxy Router running on http://localhost:${PORT}`);
console.log(`🔗 Copilot (${PREFIX}*): ${TARGET_URL}`);
if (personalUpstream) {
    console.log(`👤 Personal (no prefix): ${personalUpstream.baseUrl}`);
} else {
    console.log(`👤 Personal routing off — unprefixed models still go to Copilot`);
    console.log(`   Set CURSOR_UPSTREAM_URL + CURSOR_UPSTREAM_KEY to split personal vs work`);
}

function shouldUseCopilot(model: unknown): boolean {
    if (!personalUpstream) return true;
    return isCopilotRoutedModel(typeof model === 'string' ? model : '', PREFIX);
}

function prefixCopilotModelList(data: any): any {
    if (data?.data && Array.isArray(data.data)) {
        data.data = data.data.map((model: any) => {
            const normalizedId = normalizeModelId(model.id);
            return {
                ...model,
                id: withCopilotPrefix(normalizedId, PREFIX),
                display_name: PREFIX + normalizeModelId(model.display_name || model.id),
            };
        });
    }
    return data;
}

async function fetchPersonalModelEntries(): Promise<any[]> {
    const extras = extraPersonalModelIds().map(id => ({ id, display_name: id }));
    if (!personalUpstream) return extras;
    try {
        const response = await fetch(personalModelsUrl(personalUpstream), {
            headers: { Authorization: personalAuthHeader(personalUpstream) },
        });
        if (!response.ok) return extras;
        const data = await response.json() as { data?: any[] };
        const fromApi = Array.isArray(data.data) ? data.data : [];
        return [...fromApi, ...extras];
    } catch {
        return extras;
    }
}

async function mergeModelsResponse(copilotData: any): Promise<any> {
    const merged = prefixCopilotModelList(copilotData || { data: [] });
    if (!personalUpstream) return merged;
    if (!Array.isArray(merged.data)) merged.data = [];
    const seen = new Set(merged.data.map((m: any) => m.id));
    for (const model of await fetchPersonalModelEntries()) {
        const id = typeof model?.id === 'string' ? model.id : '';
        if (!id || isCopilotRoutedModel(id, PREFIX) || seen.has(id)) continue;
        seen.add(id);
        merged.data.push({ ...model, id, display_name: model.display_name || id });
    }
    return merged;
}

async function forwardToPersonal(req: Request, url: URL, json: any, startTime: number): Promise<Response> {
    const upstream = personalUpstream!;
    const target = joinUpstreamPath(upstream.baseUrl, url.pathname, url.search);
    const model = typeof json?.model === 'string' ? json.model : 'unknown';
    console.log(`👤 Personal route: ${model} → ${target.toString()}`);

    if (url.pathname.includes('/chat/completions') && json && typeof json === 'object') {
        const isClaude = String(json.model || '').toLowerCase().includes('claude');
        normalizeRequest(json, isClaude);
    }

    const headers = new Headers(req.headers);
    headers.set('host', target.host);
    headers.set('authorization', personalAuthHeader(upstream));
    const body = JSON.stringify(json);
    headers.set('content-length', String(new TextEncoder().encode(body).length));

    const retryResult = await retryFetch(target.toString(), {
        method: req.method,
        headers,
        body,
    });

    if (!retryResult.success) {
        console.error(`❌ Personal upstream failed after ${retryResult.attempts} attempts:`, retryResult.error);
        addRequestLog({
            id: getNextRequestId(), timestamp: startTime, model,
            promptTokens: 0, completionTokens: 0, totalTokens: 0,
            status: 502, duration: retryResult.totalDuration, stream: !!json?.stream,
        });
        return new Response(
            JSON.stringify({ error: { message: `Personal upstream failed: ${retryResult.error?.message || 'Unknown error'}`, type: 'proxy_error' } }),
            { status: 502, headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' } },
        );
    }

    const response = retryResult.result!;
    const responseHeaders = new Headers(response.headers);
    responseHeaders.set('Access-Control-Allow-Origin', '*');

    if (!response.ok) {
        const errText = await response.text();
        console.error(`❌ Personal upstream error (${response.status}):`, errText);
        addRequestLog({
            id: getNextRequestId(), timestamp: startTime, model,
            promptTokens: 0, completionTokens: 0, totalTokens: 0,
            status: response.status, duration: Date.now() - startTime, stream: !!json?.stream,
        });
        return new Response(errText, { status: response.status, headers: responseHeaders });
    }

    if (json?.stream && response.body) {
        return createStreamProxy(response.body, responseHeaders, (usage) => {
            addRequestLog({
                id: getNextRequestId(), timestamp: startTime, model,
                promptTokens: usage.promptTokens, completionTokens: usage.completionTokens,
                totalTokens: usage.totalTokens,
                status: response.status, duration: Date.now() - startTime, stream: true,
            });
        });
    }

    addRequestLog({
        id: getNextRequestId(), timestamp: startTime, model,
        promptTokens: 0, completionTokens: 0, totalTokens: 0,
        status: response.status, duration: Date.now() - startTime, stream: false,
    });
    return new Response(response.body, { status: response.status, headers: responseHeaders });
}

Bun.serve({
  port: PORT,
  idleTimeout: 255,
  async fetch(req) {
    const url = new URL(req.url);

    // ── Dashboard ─────────────────────────────────────────────────────────
    if (url.pathname === "/" || url.pathname === "/dashboard.html") {
      try {
        const dashboardPath = import.meta.dir + "/dashboard.html";
        const dashboardContent = await Bun.file(dashboardPath).text();
        return new Response(dashboardContent, { headers: { "Content-Type": "text/html" } });
      } catch (e) {
        return new Response("Dashboard not found.", { status: 404 });
      }
    }
    
    // ── Dashboard Auth API ────────────────────────────────────────────
    if (url.pathname === "/api/auth/status") {
        return Response.json(getAuthStatus(), {
            headers: { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" },
        });
    }
    
    if (url.pathname === "/api/auth/login" && req.method === "POST") {
        try {
            const { password } = await req.json();
            const sessionToken = createAuthSession(password);
            
            if (sessionToken) {
                return Response.json({ 
                    ok: true, 
                    sessionToken,
                    message: 'Login successful'
                }, {
                    headers: { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" },
                });
            } else {
                return Response.json({ 
                    ok: false, 
                    error: 'Invalid password'
                }, {
                    status: 401,
                    headers: { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" },
                });
            }
        } catch (e: any) {
            return Response.json({ 
                ok: false, 
                error: e.message || 'Authentication failed'
            }, {
                status: 400,
                headers: { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" },
            });
        }
    }
    
    if (url.pathname === "/api/auth/logout" && req.method === "POST") {
        try {
            const { sessionToken } = await req.json();
            if (sessionToken) {
                destroyAuthSession(sessionToken);
            }
            return Response.json({ ok: true }, {
                headers: { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" },
            });
        } catch {
            return Response.json({ ok: false }, {
                headers: { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" },
            });
        }
    }
    
    if (url.pathname === "/api/auth/verify" && req.method === "POST") {
        try {
            const { sessionToken } = await req.json();
            const valid = checkAuthSession(sessionToken);
            return Response.json({ valid }, {
                headers: { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" },
            });
        } catch {
            return Response.json({ valid: false }, {
                headers: { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" },
            });
        }
    }

    // ── Dashboard API: usage stats ────────────────────────────────────────
    if (url.pathname === "/api/usage") {
        const stats = getUsageStats();
        const budget = getBudgetStatus();
        return new Response(JSON.stringify({ ...stats, budget }), {
            headers: { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" },
        });
    }

    // ── Dashboard API: flush usage to disk ────────────────────────────────
    if (url.pathname === "/api/usage/flush" && req.method === "POST") {
        await flushToDisk();
        return new Response('{"ok":true}', {
            headers: { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" },
        });
    }

    // ── Dashboard API: SSE console log stream ─────────────────────────────
    if (url.pathname === "/api/logs/stream") {
        const stream = new ReadableStream({
            start(controller) {
                const initData = `data: ${JSON.stringify({ type: 'init', lines: consoleLines })}\n\n`;
                controller.enqueue(new TextEncoder().encode(initData));
                logSubscribers.add(controller);
            },
            cancel() {
                // cleaned up on enqueue failure
            },
        });
        return new Response(stream, {
            headers: {
                "Content-Type": "text/event-stream",
                "Cache-Control": "no-cache",
                "Connection": "keep-alive",
                "Access-Control-Allow-Origin": "*",
            },
        });
    }

    // ── Dashboard API: clear console logs ─────────────────────────────────
    if (url.pathname === "/api/logs/clear" && req.method === "POST") {
        consoleLines.length = 0;
        const data = `data: ${JSON.stringify({ type: 'clear' })}\n\n`;
        for (const ctrl of logSubscribers) {
            try { ctrl.enqueue(new TextEncoder().encode(data)); } catch { logSubscribers.delete(ctrl); }
        }
        return new Response('{"ok":true}', {
            headers: { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" },
        });
    }

    // ── API Key management endpoints ──────────────────────────────────
    const corsHeaders = { "Access-Control-Allow-Origin": "*" };

    if (url.pathname === "/api/keys" && req.method === "GET") {
        const config = loadAuthConfig();
        const maskedKeys = config.keys.map(k => ({
            ...k,
            key: k.key.slice(0, 12) + '...'
        }));
        return Response.json({ requireApiKey: config.requireApiKey, keys: maskedKeys }, { headers: corsHeaders });
    }

    if (url.pathname === "/api/keys" && req.method === "POST") {
        let body: unknown;
        try {
            body = await req.json();
        } catch {
            return Response.json({ error: "Invalid JSON body" }, { status: 400, headers: corsHeaders });
        }
        if (typeof body !== 'object' || body === null) {
            return Response.json({ error: "Request body must be a JSON object" }, { status: 400, headers: corsHeaders });
        }
        const { name } = body as { name?: unknown };
        if (name !== undefined && typeof name !== 'string') {
            return Response.json({ error: "`name` must be a string if provided" }, { status: 400, headers: corsHeaders });
        }
        const config = loadAuthConfig();
        const newKey = generateApiKey(name || 'Untitled');
        config.keys.push(newKey);
        saveAuthConfig(config);
        return Response.json(newKey, { headers: corsHeaders });
    }

    if (url.pathname.startsWith("/api/keys/") && req.method === "PUT") {
        const id = url.pathname.split('/').pop();
        const { active } = await req.json();
        const config = loadAuthConfig();
        const key = config.keys.find(k => k.id === id);
        if (key) { key.active = active; saveAuthConfig(config); }
        return Response.json({ ok: true }, { headers: corsHeaders });
    }

    if (url.pathname.startsWith("/api/keys/") && req.method === "DELETE") {
        const id = url.pathname.split('/').pop();
        const config = loadAuthConfig();
        config.keys = config.keys.filter(k => k.id !== id);
        saveAuthConfig(config);
        return Response.json({ ok: true }, { headers: corsHeaders });
    }

    if (url.pathname === "/api/settings/auth" && req.method === "PUT") {
        const { requireApiKey } = await req.json();
        const config = loadAuthConfig();
        config.requireApiKey = requireApiKey;
        saveAuthConfig(config);
        return Response.json({ ok: true }, { headers: corsHeaders });
    }
    
    // ── Smart routing configuration ──────────────────────────────────────
    if (url.pathname === "/api/settings/routing" && req.method === "GET") {
        return Response.json(getRoutingConfig(), { headers: corsHeaders });
    }
    
    if (url.pathname === "/api/settings/routing" && req.method === "PUT") {
        const config = await req.json();
        setRoutingConfig(config);
        return Response.json({ ok: true }, { headers: corsHeaders });
    }

    // ── Upstream (copilot-api) key management ────────────────────────
    if (url.pathname === "/api/upstream-keys" && req.method === "GET") {
        const keys = getUpstreamApiKeys();
        const masked = keys.map(k => k.slice(0, 14) + '...' + k.slice(-4));
        return Response.json({ keys: masked, count: keys.length }, { headers: corsHeaders });
    }

    if (url.pathname === "/api/upstream-keys" && req.method === "POST") {
        try {
            const newKey = createUpstreamApiKey();
            return Response.json({ key: newKey }, { headers: corsHeaders });
        } catch (e: any) {
            return Response.json({ error: e?.message || 'Failed to create key' }, { status: 500, headers: corsHeaders });
        }
    }

    if (url.pathname.startsWith("/api/upstream-keys/") && req.method === "DELETE") {
        const keyPrefix = decodeURIComponent(url.pathname.split('/').pop() || '');
        const keys = getUpstreamApiKeys();
        const match = keys.find(k => k.startsWith(keyPrefix) || k.endsWith(keyPrefix));
        if (match) {
            deleteUpstreamApiKey(match);
            return Response.json({ ok: true }, { headers: corsHeaders });
        }
        return Response.json({ error: 'Key not found' }, { status: 404, headers: corsHeaders });
    }

    // ── Dashboard API: public tunnel info ─────────────────────────────
    if (url.pathname === "/api/tunnel" && req.method === "GET") {
        return Response.json(getTunnelState(), { headers: corsHeaders });
    }
    if (url.pathname === "/api/tunnel/configure-cursor" && req.method === "POST") {
        const result = configureCursor();
        return Response.json(result, {
            status: result.ok ? 200 : 400,
            headers: corsHeaders,
        });
    }
    if (url.pathname === "/api/tunnel" && req.method === "POST") {
        const result = configureCursor();
        return Response.json(result, {
            status: result.ok ? 200 : 400,
            headers: corsHeaders,
        });
    }
    if (url.pathname === "/api/tunnel/stream") {
        const stream = new ReadableStream({
            start(controller) {
                const encoder = new TextEncoder();
                const send = (s: ReturnType<typeof getTunnelState>) => {
                    try {
                        controller.enqueue(encoder.encode(`data: ${JSON.stringify(s)}\n\n`));
                    } catch {}
                };
                const unsub = subscribeTunnel(send);
                (controller as any)._tunnelUnsub = unsub;
            },
            cancel(controller) {
                const unsub = (controller as any)?._tunnelUnsub;
                if (typeof unsub === 'function') unsub();
            },
        });
        return new Response(stream, {
            headers: {
                "Content-Type": "text/event-stream",
                "Cache-Control": "no-cache",
                "Connection": "keep-alive",
                "Access-Control-Allow-Origin": "*",
            },
        });
    }

    // ── Dashboard API: model list (bypasses API key auth) ──────────────
    if (url.pathname === "/api/models" && req.method === "GET") {
        try {
            const modelsUrl = new URL('/v1/models', TARGET_URL);
            const response = await fetch(modelsUrl.toString(), {
                headers: { 'Authorization': getUpstreamAuthHeader() },
            });
            const data = await mergeModelsResponse(await response.json());
            return new Response(JSON.stringify(data), {
                status: response.status,
                headers: { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" }
            });
        } catch (e: any) {
            return Response.json({ error: e?.message || 'Failed to fetch models' }, { status: 502, headers: corsHeaders });
        }
    }

    // ── Proxy logic ───────────────────────────────────────────────────────
    const targetUrl = new URL(url.pathname + url.search, TARGET_URL);

    if (req.method === "OPTIONS") {
      return new Response(null, {
        headers: {
          "Access-Control-Allow-Origin": "*",
          "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
          "Access-Control-Allow-Headers": "Content-Type, Authorization",
        },
      });
    }

    // ── Enforce API key auth on all /v1/* routes ──────────────────────────
    if (url.pathname.startsWith("/v1/")) {
        const authConfig = loadAuthConfig();
        if (authConfig.requireApiKey) {
            const authHeader = req.headers.get('authorization');
            const providedKey = authHeader?.replace('Bearer ', '');
            if (!providedKey || !validateApiKey(providedKey)) {
                return Response.json(
                    { error: { message: "Invalid API key. Generate one from the dashboard.", type: "invalid_api_key" } },
                    { status: 401, headers: { "Access-Control-Allow-Origin": "*" } }
                );
            }
        }
        
        // ── Check budget limits ───────────────────────────────────────────────
        if (checkBudgetExceeded()) {
            return Response.json(
                { error: { message: "Budget limit exceeded. Please check your dashboard.", type: "budget_exceeded" } },
                { status: 429, headers: { "Access-Control-Allow-Origin": "*" } }
            );
        }
    }

    try {
      const isV1JsonPost = req.method === "POST"
        && url.pathname.startsWith("/v1/")
        && (req.headers.get("content-type") || "").includes("json");
      let parsedJson: any | undefined;
      if (isV1JsonPost) {
        parsedJson = await req.json();
        if (personalUpstream && parsedJson && !shouldUseCopilot(parsedJson.model)) {
          return await forwardToPersonal(req, url, parsedJson, Date.now());
        }
      }

      if (req.method === "POST" && url.pathname.includes("/chat/completions")) {
        const startTime = Date.now();
        let json = parsedJson ?? await req.json();

        logIncomingRequest(json);

        if (personalUpstream && !shouldUseCopilot(json.model)) {
          return await forwardToPersonal(req, url, json, startTime);
        }

        const originalModel = json.model;
        
        // ── Smart routing (optional) ──────────────────────────────────────
        const routingDecision = selectModel(originalModel, json.messages || []);
        if (routingDecision.selectedModel !== originalModel) {
            console.log(`🎯 Smart routing: ${originalModel} → ${routingDecision.selectedModel}`);
            console.log(`   Reason: ${routingDecision.reason}`);
            json.model = routingDecision.selectedModel;
        }
        
        const targetModel = resolveModelForUpstream(json.model || '', PREFIX);
        json.model = targetModel;
        if (originalModel !== targetModel && routingDecision.selectedModel === originalModel) {
          console.log(`🔄 Rewriting model: ${originalModel} -> ${targetModel}`);
        }

        // Claude 4.6 adaptive thinking streams empty content unless reasoning is capped.
        if (needsLowReasoningEffort(targetModel) && json.reasoning_effort == null) {
          json.reasoning_effort = 'low';
          console.log(`🧠 Set reasoning_effort=low for ${targetModel}`);
        }

        const isClaude = targetModel.toLowerCase().includes('claude');

        normalizeRequest(json, isClaude);

        logTransformedRequest(json);

        // ── Context compaction ────────────────────────────────────────────
        // Always run: with --max this compacts aggressively at 80%; without --max
        // it acts as a safety net at 95% so long Cursor sessions don't overflow.
        json = await compactIfNeeded(json, targetModel, TARGET_URL);

        const headers = new Headers(req.headers);
        headers.set("host", targetUrl.host);
        headers.set("authorization", getUpstreamAuthHeader());

        const shouldUseResponsesAPI = needsResponsesAPI(targetModel);
        
        if (shouldUseResponsesAPI && json.max_tokens) {
            json.max_completion_tokens = json.max_tokens;
            delete json.max_tokens;
            console.log(`🔧 Converted max_tokens → max_completion_tokens`);
        }

        if (shouldUseResponsesAPI) {
            console.log(`🔀 Model ${targetModel} — using Responses API bridge`);
            const chatId = `chatcmpl-proxy-${++responseCounter}`;
            try {
                const bridgeResult = await handleResponsesAPIBridge(json, req, chatId, TARGET_URL);
                addRequestLog({
                    id: getNextRequestId(), timestamp: startTime, model: targetModel,
                    promptTokens: bridgeResult.usage.promptTokens,
                    completionTokens: bridgeResult.usage.completionTokens,
                    totalTokens: bridgeResult.usage.totalTokens,
                    status: bridgeResult.response.status, duration: Date.now() - startTime, stream: !!json.stream,
                });
                return bridgeResult.response;
            } catch (e: any) {
                console.error(`❌ Responses API bridge failed for ${targetModel}:`, e?.message || e);
                return new Response(
                    JSON.stringify({ error: { message: `Responses API bridge failed: ${e?.message || 'Unknown error'}`, type: "proxy_error" } }),
                    { status: 502, headers: { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" } }
                );
            }
        }

        const hasVisionContent = (messages: any[]) => messages?.some(msg => 
            Array.isArray(msg.content) && msg.content.some((p: any) => p.type === 'image_url')
        );

        if (!isClaude && json.messages && hasVisionContent(json.messages)) {
             headers.set("Copilot-Vision-Request", "true");
        }

        const body = JSON.stringify(json);
        headers.set("content-length", String(new TextEncoder().encode(body).length));

        const retryResult = await retryFetch(targetUrl.toString(), {
          method: "POST",
          headers: headers,
          body: body,
        });

        if (!retryResult.success) {
            console.error(`❌ All retries failed after ${retryResult.attempts} attempts:`, retryResult.error);
            addRequestLog({
                id: getNextRequestId(), timestamp: startTime, model: targetModel,
                promptTokens: 0, completionTokens: 0, totalTokens: 0,
                status: 502, duration: retryResult.totalDuration, stream: !!json.stream,
            });
            return new Response(
                JSON.stringify({ error: { message: `All retries exhausted: ${retryResult.error?.message || 'Unknown error'}`, type: "proxy_error" } }),
                { status: 502, headers: { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" } }
            );
        }

        const response = retryResult.result!;
        if (retryResult.attempts > 1) {
            console.log(`✅ Request succeeded after ${retryResult.attempts} attempts (${retryResult.totalDuration}ms total)`);
        }

        const responseHeaders = new Headers(response.headers);
        responseHeaders.set("Access-Control-Allow-Origin", "*");
        console.log(`📡 Upstream response: ${response.status} | content-type: ${response.headers.get('content-type')}`);
        
        if (!response.ok) {
            const errText = await response.text();
            console.error(`❌ Upstream Error (${response.status}):`, errText);
            addRequestLog({
                id: getNextRequestId(), timestamp: startTime, model: targetModel,
                promptTokens: 0, completionTokens: 0, totalTokens: 0,
                status: response.status, duration: Date.now() - startTime, stream: !!json.stream,
            });
            return new Response(errText, { status: response.status, headers: responseHeaders });
        }

        if (json.stream && response.body) {
            return createStreamProxy(response.body, responseHeaders, (usage) => {
                addRequestLog({
                    id: getNextRequestId(), timestamp: startTime, model: targetModel,
                    promptTokens: usage.promptTokens, completionTokens: usage.completionTokens,
                    totalTokens: usage.totalTokens,
                    status: response.status, duration: Date.now() - startTime, stream: true,
                });
            });
        }

        // Non-streaming: clone and parse to extract usage
        const cloned = response.clone();
        let promptTokens = 0, completionTokens = 0, totalTokens = 0;
        try {
            const respJson = await cloned.json();
            if (respJson.usage) {
                promptTokens = respJson.usage.prompt_tokens || 0;
                completionTokens = respJson.usage.completion_tokens || 0;
                totalTokens = respJson.usage.total_tokens || promptTokens + completionTokens;
            }
        } catch { /* ignore parse errors */ }
        addRequestLog({
            id: getNextRequestId(), timestamp: startTime, model: targetModel,
            promptTokens, completionTokens, totalTokens,
            status: response.status, duration: Date.now() - startTime, stream: false,
        });

        return new Response(response.body, {
          status: response.status,
          headers: responseHeaders,
        });
      }

      if (req.method === "GET" && url.pathname.includes("/models")) {
        const headers = new Headers(req.headers);
        headers.set("host", targetUrl.host);
        headers.set("authorization", getUpstreamAuthHeader());
        const response = await fetch(targetUrl.toString(), { method: "GET", headers: headers });
        const data = await mergeModelsResponse(await response.json());
        return new Response(JSON.stringify(data), {
            status: response.status,
            headers: { ...Object.fromEntries(response.headers), "Access-Control-Allow-Origin": "*" }
        });
      }

      const headers = new Headers(req.headers);
      headers.set("host", targetUrl.host);
      headers.set("authorization", getUpstreamAuthHeader());
      const copilotBody = parsedJson !== undefined ? JSON.stringify(parsedJson) : req.body;
      if (parsedJson !== undefined) {
        headers.set("content-length", String(new TextEncoder().encode(copilotBody as string).length));
      }
      const response = await fetch(targetUrl.toString(), {
        method: req.method,
        headers: headers,
        body: copilotBody,
      });
      const responseHeaders = new Headers(response.headers);
      responseHeaders.set("Access-Control-Allow-Origin", "*");
      return new Response(response.body, { status: response.status, headers: responseHeaders });

    } catch (error) {
      console.error("Proxy Error:", error);
      return new Response(JSON.stringify({ error: "Proxy Error", details: String(error) }), {
        status: 500,
        headers: { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" },
      });
    }
  },
});
