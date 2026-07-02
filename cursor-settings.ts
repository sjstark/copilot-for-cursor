import { Database } from 'bun:sqlite';
import { existsSync } from 'fs';
import { homedir } from 'os';
import { join } from 'path';

const CURSOR_DB = join(
    homedir(),
    'Library/Application Support/Cursor/User/globalStorage/state.vscdb',
);
const CURSOR_REACTIVE_KEY =
    'src.vs.platform.reactivestorage.browser.reactiveStorageServiceImpl.persistentStorage.applicationUser';
const CURSOR_AUTH_BASE_URL_KEY = 'cursorAuth/openAIBaseUrl';
const CURSOR_AUTH_API_KEY = 'cursorAuth/openAIKey';
const DEFAULT_OPENAI_KEY = 'dummy';

export interface CursorConfigureResult {
    ok: boolean;
    message: string;
    restartRequired?: boolean;
}

export function getCursorDbPath(): string {
    return CURSOR_DB;
}

function upsertItem(db: Database, key: string, value: string): void {
    db.run(
        'INSERT INTO ItemTable (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value',
        [key, value],
    );
}

function mergeUniqueStrings(existing: unknown, additions: string[]): string[] {
    const base = Array.isArray(existing) ? existing.filter((v): v is string => typeof v === 'string') : [];
    return [...new Set([...base, ...additions])];
}

export function configureCursorOpenAIBaseUrl(
    baseUrl: string,
    modelIds: string[] = [],
): CursorConfigureResult {
    if (process.platform !== 'darwin') {
        return { ok: false, message: 'Cursor auto-configure is only supported on macOS' };
    }

    if (!existsSync(CURSOR_DB)) {
        return {
            ok: false,
            message: `Cursor DB not found at ${CURSOR_DB}. Open Cursor once, then retry.`,
        };
    }

    try {
        const db = new Database(CURSOR_DB);
        const row = db
            .query('SELECT value FROM ItemTable WHERE key = ?')
            .get(CURSOR_REACTIVE_KEY) as { value: string } | null;

        if (!row?.value) {
            return { ok: false, message: 'Cursor reactive storage key not found in state.vscdb' };
        }

        const data = JSON.parse(row.value);
        data.openAIBaseUrl = baseUrl;
        data.useOpenAIKey = true;
        if (modelIds.length > 0) {
            data.availableAPIKeyModels = mergeUniqueStrings(data.availableAPIKeyModels, modelIds);
            const aiSettings = data.aiSettings && typeof data.aiSettings === 'object'
                ? data.aiSettings
                : {};
            aiSettings.userAddedModels = mergeUniqueStrings(aiSettings.userAddedModels, modelIds);
            aiSettings.modelOverrideEnabled = mergeUniqueStrings(aiSettings.modelOverrideEnabled, modelIds);
            data.aiSettings = aiSettings;
        }

        db.run('UPDATE ItemTable SET value = ? WHERE key = ?', [
            JSON.stringify(data),
            CURSOR_REACTIVE_KEY,
        ]);

        // Cursor also reads the override URL from cursorAuth/* keys.
        upsertItem(db, CURSOR_AUTH_BASE_URL_KEY, baseUrl);
        upsertItem(db, CURSOR_AUTH_API_KEY, DEFAULT_OPENAI_KEY);

        return {
            ok: true,
            message: `Cursor OpenAI base URL set to ${baseUrl}. Quit and reopen Cursor for it to take effect.`,
            restartRequired: true,
        };
    } catch (err: any) {
        return { ok: false, message: err?.message || String(err) };
    }
}

export function readCursorOpenAIBaseUrl(): string | null {
    if (!existsSync(CURSOR_DB)) return null;
    try {
        const db = new Database(CURSOR_DB, { readonly: true });
        const authRow = db
            .query('SELECT value FROM ItemTable WHERE key = ?')
            .get(CURSOR_AUTH_BASE_URL_KEY) as { value: string } | null;
        if (authRow?.value) return authRow.value;

        const reactiveRow = db
            .query('SELECT value FROM ItemTable WHERE key = ?')
            .get(CURSOR_REACTIVE_KEY) as { value: string } | null;
        if (!reactiveRow?.value) return null;
        const data = JSON.parse(reactiveRow.value);
        return typeof data.openAIBaseUrl === 'string' ? data.openAIBaseUrl : null;
    } catch {
        return null;
    }
}

export function notifyMac(title: string, message: string, isError = false): void {
    if (process.platform !== 'darwin') return;
    try {
        const sound = isError ? 'Basso' : 'Submarine';
        Bun.spawn([
            'osascript',
            '-e',
            `display notification "${message.replace(/"/g, '\\"')}" with title "${title.replace(/"/g, '\\"')}" sound name "${sound}"`,
        ]);
    } catch {}
}
