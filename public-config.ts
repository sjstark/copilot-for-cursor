import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'fs';
import { homedir } from 'os';
import { join } from 'path';

const CONFIG_DIR = join(homedir(), '.copilot-proxy');
const CONFIG_PATH = join(CONFIG_DIR, 'config.json');
const DEFAULT_PUBLIC_URL = 'https://copilot-for-cursor.samstark.me';

export interface PublicConfig {
    publicUrl: string;
    cursorAutoConfigure: boolean;
}

function normalizePublicUrl(url: string): string {
    return url.replace(/\/+$/, '');
}

function readConfigFile(): Partial<PublicConfig> {
    try {
        if (!existsSync(CONFIG_PATH)) return {};
        return JSON.parse(readFileSync(CONFIG_PATH, 'utf-8'));
    } catch {
        return {};
    }
}

export function getPublicUrl(): string {
    const fromEnv = process.env.PUBLIC_URL?.trim();
    if (fromEnv) return normalizePublicUrl(fromEnv);

    const fromFile = readConfigFile().publicUrl?.trim();
    if (fromFile) return normalizePublicUrl(fromFile);

    return DEFAULT_PUBLIC_URL;
}

export function getCursorEndpoint(): string {
    return `${getPublicUrl()}/v1`;
}

export function shouldAutoConfigureCursor(): boolean {
    if (process.argv.includes('--configure-cursor')) return true;
    if (process.argv.includes('--no-configure-cursor')) return false;
    if (process.env.CURSOR_AUTO_CONFIGURE === '0') return false;
    if (process.env.CURSOR_AUTO_CONFIGURE === '1') return true;
    return readConfigFile().cursorAutoConfigure ?? true;
}

export function savePublicConfig(config: Partial<PublicConfig>): PublicConfig {
    if (!existsSync(CONFIG_DIR)) mkdirSync(CONFIG_DIR, { recursive: true });

    const current = readConfigFile();
    const merged: PublicConfig = {
        publicUrl: normalizePublicUrl(config.publicUrl || current.publicUrl || DEFAULT_PUBLIC_URL),
        cursorAutoConfigure: config.cursorAutoConfigure ?? current.cursorAutoConfigure ?? true,
    };

    writeFileSync(CONFIG_PATH, JSON.stringify(merged, null, 2), 'utf-8');
    return merged;
}

export function getConfigPath(): string {
    return CONFIG_PATH;
}
