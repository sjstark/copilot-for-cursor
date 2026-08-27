#!/usr/bin/env bun
/**
 * One-command startup: launches copilot-api (port 4141) + proxy-router (port 4142)
 * Usage: bun run start.ts
 */

import { spawn, sleep } from 'bun';
import { existsSync } from 'fs';
import { getUpstreamAuthHeader } from './upstream-auth';
import { fetchAndCacheModelLimits, enableMaxMode, isMaxMode } from './max-mode';
import { fetchAndCachePricing } from './cost-tracking';
import { configureCursorOpenAIBaseUrl, notifyMac } from './cursor-settings';
import { getCursorEndpoint, getPublicUrl, shouldAutoConfigureCursor } from './public-config';
import { withCopilotPrefix, COPILOT_MODEL_PREFIX, normalizeModelId } from './model-routing';
import { getPersonalUpstream, personalAuthHeader, personalModelsUrl, extraPersonalModelIds } from './personal-upstream';
// Import dashboard-auth to initialize it
import './dashboard-auth';

// ── Parse CLI flags ──────────────────────────────────────────────────────────
const args = process.argv.slice(2);
if (args.includes('--max')) {
    enableMaxMode();
}

const COPILOT_API_PORT = 4141;
const PROXY_PORT = 4142;

// Colors for distinguishing output
const RED = '\x1b[31m';
const GREEN = '\x1b[32m';
const YELLOW = '\x1b[33m';
const CYAN = '\x1b[36m';
const RESET = '\x1b[0m';

async function isPortInUse(port: number): Promise<boolean> {
    try {
        await fetch(`http://localhost:${port}/`, { signal: AbortSignal.timeout(2000) });
        return true;
    } catch {
        return false;
    }
}

async function waitForPort(port: number, timeoutMs = 30000): Promise<boolean> {
    const start = Date.now();
    while (Date.now() - start < timeoutMs) {
        try {
            const resp = await fetch(`http://localhost:${port}/v1/models`, {
                headers: { 'Authorization': getUpstreamAuthHeader() },
            });
            if (resp.ok) return true;
        } catch {}
        await sleep(500);
    }
    return false;
}

async function main() {
    console.log(`${CYAN}🚀 Starting Copilot Proxy Stack...${RESET}\n`);

    // 1. Check if copilot-api is already running
    const copilotAlreadyRunning = await isPortInUse(COPILOT_API_PORT);
    let copilotProc: ReturnType<typeof spawn> | null = null;

    if (copilotAlreadyRunning) {
        console.log(`${GREEN}✅ copilot-api already running on port ${COPILOT_API_PORT}${RESET}`);
    } else {
        console.log(`${YELLOW}⏳ Starting copilot-api on port ${COPILOT_API_PORT}...${RESET}`);

        // Detect npx path
        const isWindows = process.platform === 'win32';
        const npxCmd = isWindows ? 'npx.cmd' : 'npx';

        copilotProc = spawn([npxCmd, '@jeffreycao/copilot-api@latest', 'start'], {
            stdout: 'pipe',
            stderr: 'pipe',
        });

        // Stream copilot-api output with prefix
        (async () => {
            const reader = copilotProc!.stdout.getReader();
            const decoder = new TextDecoder();
            while (true) {
                const { done, value } = await reader.read();
                if (done) break;
                const text = decoder.decode(value, { stream: true });
                for (const line of text.split('\n').filter(Boolean)) {
                    console.log(`${RED}[copilot-api]${RESET} ${line}`);
                }
            }
        })();

        (async () => {
            const reader = copilotProc!.stderr.getReader();
            const decoder = new TextDecoder();
            while (true) {
                const { done, value } = await reader.read();
                if (done) break;
                const text = decoder.decode(value, { stream: true });
                for (const line of text.split('\n').filter(Boolean)) {
                    console.log(`${RED}[copilot-api]${RESET} ${line}`);
                }
            }
        })();

        // Wait for copilot-api to be ready
        console.log(`${YELLOW}⏳ Waiting for copilot-api to be ready...${RESET}`);
        const ready = await waitForPort(COPILOT_API_PORT);
        if (!ready) {
            console.error(`${RED}❌ copilot-api failed to start within 30s${RESET}`);
            copilotProc.kill();
            process.exit(1);
        }
        console.log(`${GREEN}✅ copilot-api is ready on port ${COPILOT_API_PORT}${RESET}`);
    }

    // 1.5 Pre-fetch and cache model token limits (used by both --max soft compaction
    // and the always-on hard-threshold safety net).
    if (isMaxMode()) {
        console.log(`${CYAN}🔥 Max mode enabled — will auto-compact long conversations at 80%${RESET}`);
    } else {
        console.log(`${CYAN}🛡️  Safety-net compaction enabled (auto-compact at 95% of model limit)${RESET}`);
    }
    await fetchAndCacheModelLimits(`http://localhost:${COPILOT_API_PORT}`);
    
    // 1.6 Pre-fetch and cache model pricing for cost tracking
    await fetchAndCachePricing(`http://localhost:${COPILOT_API_PORT}`);

    const publicUrl = getPublicUrl();
    const cursorEndpoint = getCursorEndpoint();
    console.log(`${CYAN}🌐 Public URL: ${publicUrl}${RESET}`);
    console.log(`${CYAN}   Cursor endpoint: ${cursorEndpoint}${RESET}`);

    // Register Copilot models as cus-* and optional personal (unprefixed) models
    let modelIds: string[] = [];
    try {
        const modelsResp = await fetch(`http://localhost:${COPILOT_API_PORT}/v1/models`, {
            headers: { 'Authorization': getUpstreamAuthHeader() },
        });
        if (modelsResp.ok) {
            const modelsData = await modelsResp.json() as { data?: Array<{ id?: string }> };
            modelIds = (modelsData.data || [])
                .map(m => m.id)
                .filter((id): id is string => typeof id === 'string' && id.length > 0)
                .map(id => withCopilotPrefix(normalizeModelId(id), COPILOT_MODEL_PREFIX));
        }
    } catch {}

    const personal = getPersonalUpstream();
    if (personal) {
        try {
            const personalResp = await fetch(personalModelsUrl(personal), {
                headers: { Authorization: personalAuthHeader(personal) },
            });
            if (personalResp.ok) {
                const personalData = await personalResp.json() as { data?: Array<{ id?: string }> };
                for (const m of personalData.data || []) {
                    if (typeof m.id === 'string' && m.id && !m.id.startsWith(COPILOT_MODEL_PREFIX)) {
                        modelIds.push(m.id);
                    }
                }
            }
        } catch {}
        modelIds.push(...extraPersonalModelIds());
        modelIds = [...new Set(modelIds)];
        console.log(`${CYAN}👤 Personal upstream: ${personal.baseUrl}${RESET}`);
    }

    if (shouldAutoConfigureCursor() && modelIds.length > 0) {
        const result = configureCursorOpenAIBaseUrl(cursorEndpoint, modelIds);
        if (result.ok) {
            console.log(`${GREEN}✅ ${result.message}${RESET}`);
            console.log(`${GREEN}   Registered ${modelIds.length} models: ${modelIds.slice(0, 3).join(', ')}${modelIds.length > 3 ? ', ...' : ''}${RESET}`);
        } else {
            console.log(`${YELLOW}⚠️  Cursor auto-config skipped: ${result.message}${RESET}`);
        }
    }

    // 2. Check if proxy is already running
    const proxyAlreadyRunning = await isPortInUse(PROXY_PORT);
    if (proxyAlreadyRunning) {
        console.log(`${GREEN}✅ proxy-router already running on port ${PROXY_PORT}${RESET}`);
        console.log(`\n${CYAN}🎉 Everything is running!${RESET}`);
        console.log(`${CYAN}   Local:  http://localhost:${PROXY_PORT}/v1${RESET}`);
        console.log(`${CYAN}   Public: ${cursorEndpoint}${RESET}`);
        // Keep alive if we started copilot-api
        if (copilotProc) await copilotProc.exited;
        return;
    }

    // 3. Start proxy-router in the same process
    console.log(`${YELLOW}⏳ Starting proxy-router on port ${PROXY_PORT}...${RESET}`);
    await import('./proxy-router');

    console.log(`\n${CYAN}🎉 All services running!${RESET}`);
    console.log(`${CYAN}   copilot-api:   http://localhost:${COPILOT_API_PORT}${RESET}`);
    console.log(`${CYAN}   proxy-router:  http://localhost:${PROXY_PORT}${RESET}`);
    console.log(`${CYAN}   dashboard:     http://localhost:${PROXY_PORT}/${RESET}`);
    console.log(`${CYAN}   Local Cursor:  http://localhost:${PROXY_PORT}/v1${RESET}`);
    console.log(`${CYAN}   Public Cursor: ${cursorEndpoint}${RESET}`);

    notifyMac('Copilot for Cursor', `Ready: ${cursorEndpoint}`);

    // Handle graceful shutdown
    process.on('SIGINT', async () => {
        console.log(`\n${YELLOW}🛑 Shutting down...${RESET}`);
        if (copilotProc) copilotProc.kill();
        process.exit(0);
    });
    process.on('SIGTERM', async () => {
        if (copilotProc) copilotProc.kill();
        process.exit(0);
    });

    // Keep alive
    if (copilotProc) await copilotProc.exited;
}

main().catch(err => {
    console.error(`${RED}❌ Fatal error:${RESET}`, err);
    process.exit(1);
});
