import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'fs';
import { homedir } from 'os';
import { join } from 'path';
import { createHash, randomBytes } from 'crypto';

// ── Types ────────────────────────────────────────────────────────────────────

interface DashboardAuth {
    passwordHash: string | null;
    salt: string;
    sessions: Map<string, number>; // sessionToken -> expiry timestamp
}

// ── Config ───────────────────────────────────────────────────────────────────

const DATA_DIR = process.env.DATA_DIR || join(homedir(), '.copilot-proxy');
const AUTH_FILE = join(DATA_DIR, 'dashboard-auth.json');
const SESSION_DURATION = 24 * 60 * 60 * 1000; // 24 hours

// ── State ────────────────────────────────────────────────────────────────────

let auth: DashboardAuth = {
    passwordHash: null,
    salt: randomBytes(16).toString('hex'),
    sessions: new Map(),
};

// ── Persistence ──────────────────────────────────────────────────────────────

function loadAuth(): void {
    try {
        if (!existsSync(DATA_DIR)) {
            mkdirSync(DATA_DIR, { recursive: true });
        }
        
        if (existsSync(AUTH_FILE)) {
            const data = JSON.parse(readFileSync(AUTH_FILE, 'utf-8'));
            auth.passwordHash = data.passwordHash || null;
            auth.salt = data.salt || randomBytes(16).toString('hex');
            auth.sessions = new Map(Object.entries(data.sessions || {}));
            
            // Clean expired sessions on load
            cleanExpiredSessions();
        }
    } catch (e) {
        console.warn('Failed to load dashboard auth:', e);
    }
}

function saveAuth(): void {
    try {
        const data = {
            passwordHash: auth.passwordHash,
            salt: auth.salt,
            sessions: Object.fromEntries(auth.sessions),
        };
        writeFileSync(AUTH_FILE, JSON.stringify(data, null, 2), 'utf-8');
    } catch (e) {
        console.error('Failed to save dashboard auth:', e);
    }
}

// ── Session Management ───────────────────────────────────────────────────────

function cleanExpiredSessions(): void {
    const now = Date.now();
    let cleaned = 0;
    for (const [token, expiry] of auth.sessions.entries()) {
        if (expiry < now) {
            auth.sessions.delete(token);
            cleaned++;
        }
    }
    if (cleaned > 0) {
        saveAuth();
    }
}

function generateSessionToken(): string {
    return randomBytes(32).toString('hex');
}

function createSession(): string {
    cleanExpiredSessions();
    const token = generateSessionToken();
    const expiry = Date.now() + SESSION_DURATION;
    auth.sessions.set(token, expiry);
    saveAuth();
    return token;
}

function validateSession(token: string): boolean {
    if (!token) return false;
    cleanExpiredSessions();
    const expiry = auth.sessions.get(token);
    return expiry ? expiry > Date.now() : false;
}

function invalidateSession(token: string): void {
    auth.sessions.delete(token);
    saveAuth();
}

// ── Password Management ──────────────────────────────────────────────────────

function hashPassword(password: string, salt: string): string {
    return createHash('sha256')
        .update(password + salt)
        .digest('hex');
}

export function isPasswordSet(): boolean {
    return auth.passwordHash !== null;
}

export function setPassword(password: string): void {
    if (auth.passwordHash !== null) {
        throw new Error('Password already set. Reset required.');
    }
    
    if (password.length < 6) {
        throw new Error('Password must be at least 6 characters');
    }
    
    auth.passwordHash = hashPassword(password, auth.salt);
    saveAuth();
    console.log('🔒 Dashboard password set');
}

export function verifyPassword(password: string): boolean {
    if (auth.passwordHash === null) {
        return false;
    }
    
    const hash = hashPassword(password, auth.salt);
    return hash === auth.passwordHash;
}

export function resetPassword(): void {
    auth.passwordHash = null;
    auth.salt = randomBytes(16).toString('hex');
    auth.sessions.clear();
    saveAuth();
    console.log('🔓 Dashboard password reset');
}

// ── Session API ──────────────────────────────────────────────────────────────

export function createAuthSession(password: string): string | null {
    if (!isPasswordSet()) {
        // First time setup
        try {
            setPassword(password);
            return createSession();
        } catch (e: any) {
            return null;
        }
    }
    
    // Login
    if (verifyPassword(password)) {
        return createSession();
    }
    
    return null;
}

export function checkAuthSession(token: string): boolean {
    return validateSession(token);
}

export function destroyAuthSession(token: string): void {
    invalidateSession(token);
}

export function getAuthStatus(): { passwordSet: boolean; sessionCount: number } {
    cleanExpiredSessions();
    return {
        passwordSet: isPasswordSet(),
        sessionCount: auth.sessions.size,
    };
}

// ── Initialize ───────────────────────────────────────────────────────────────

loadAuth();

// Clean sessions periodically (every hour)
setInterval(cleanExpiredSessions, 60 * 60 * 1000);

console.log(`🔐 Dashboard auth: ${isPasswordSet() ? 'password set' : 'no password yet'}`);
