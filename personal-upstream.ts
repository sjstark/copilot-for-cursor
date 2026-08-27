import { existsSync, readFileSync } from 'fs';
import { homedir } from 'os';
import { join } from 'path';

export interface PersonalUpstream {
    baseUrl: string;
    apiKey: string;
}

function readProxyConfig(): Record<string, unknown> {
    const path = join(homedir(), '.copilot-proxy', 'config.json');
    try {
        if (!existsSync(path)) return {};
        const parsed = JSON.parse(readFileSync(path, 'utf-8'));
        return parsed && typeof parsed === 'object' ? parsed : {};
    } catch {
        return {};
    }
}

export function normalizeUpstreamBaseUrl(url: string): string {
    return url.trim().replace(/\/+$/, '');
}

function stringConfig(cfg: Record<string, unknown>, ...keys: string[]): string {
    for (const key of keys) {
        const value = cfg[key];
        if (typeof value === 'string' && value.trim()) return value.trim();
    }
    return '';
}

/** Personal (no `cus-` prefix) OpenAI-compatible upstream. */
export function getPersonalUpstream(): PersonalUpstream | null {
    const cfg = readProxyConfig();
    const baseUrl = normalizeUpstreamBaseUrl(
        process.env.CURSOR_UPSTREAM_URL
            || process.env.PERSONAL_API_BASE_URL
            || stringConfig(cfg, 'cursorUpstreamUrl', 'personalApiBaseUrl')
            || '',
    );
    const apiKey =
        process.env.CURSOR_UPSTREAM_KEY?.trim()
        || process.env.PERSONAL_API_KEY?.trim()
        || stringConfig(cfg, 'cursorUpstreamKey', 'personalApiKey');

    if (!baseUrl || !apiKey) return null;
    return { baseUrl, apiKey };
}

export function isPersonalRoutingEnabled(): boolean {
    return getPersonalUpstream() !== null;
}

export function personalAuthHeader(upstream: PersonalUpstream): string {
    return `Bearer ${upstream.apiKey}`;
}

/**
 * Join a proxy path like `/v1/chat/completions` onto an upstream base that
 * may or may not already include `/v1`.
 */
export function joinUpstreamPath(baseUrl: string, pathname: string, search = ''): URL {
    const base = normalizeUpstreamBaseUrl(baseUrl) + '/';
    let path = pathname.startsWith('/') ? pathname.slice(1) : pathname;
    if (normalizeUpstreamBaseUrl(baseUrl).endsWith('/v1') && path.startsWith('v1/')) {
        path = path.slice(3);
    }
    return new URL(path + search, base);
}

export function personalModelsUrl(upstream: PersonalUpstream): string {
    return joinUpstreamPath(upstream.baseUrl, '/v1/models').toString();
}

export function extraPersonalModelIds(): string[] {
    const raw = process.env.CURSOR_UPSTREAM_MODELS || process.env.PERSONAL_API_MODELS || '';
    return raw.split(',').map(s => s.trim()).filter(Boolean);
}
