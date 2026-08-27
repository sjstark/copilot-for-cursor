// ── Request retry logic with exponential backoff ─────────────────────────────

export interface RetryConfig {
    maxRetries: number;
    initialDelayMs: number;
    maxDelayMs: number;
    backoffMultiplier: number;
    retryableStatusCodes: number[];
    retryableErrors: string[];
}

const DEFAULT_RETRY_CONFIG: RetryConfig = {
    maxRetries: 3,
    initialDelayMs: 1000,
    maxDelayMs: 10000,
    backoffMultiplier: 2,
    retryableStatusCodes: [408, 429, 500, 502, 503, 504],
    retryableErrors: ['ECONNRESET', 'ETIMEDOUT', 'ECONNREFUSED', 'ENOTFOUND'],
};

let retryConfig: RetryConfig = { ...DEFAULT_RETRY_CONFIG };

export function setRetryConfig(config: Partial<RetryConfig>): void {
    retryConfig = { ...retryConfig, ...config };
}

export function getRetryConfig(): RetryConfig {
    return { ...retryConfig };
}

function isRetryableStatus(status: number): boolean {
    return retryConfig.retryableStatusCodes.includes(status);
}

function isRetryableError(error: any): boolean {
    if (!error) return false;
    const code = error.code || error.errno || '';
    return retryConfig.retryableErrors.some(e => code.toString().includes(e));
}

function calculateDelay(attempt: number): number {
    const delay = retryConfig.initialDelayMs * Math.pow(retryConfig.backoffMultiplier, attempt);
    return Math.min(delay, retryConfig.maxDelayMs);
}

function addJitter(delay: number): number {
    // Add ±20% jitter to prevent thundering herd
    const jitter = delay * 0.2 * (Math.random() * 2 - 1);
    return Math.round(delay + jitter);
}

async function sleep(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
}

export interface RetryResult<T> {
    success: boolean;
    result?: T;
    error?: any;
    attempts: number;
    totalDuration: number;
}

/**
 * Retry a fetch request with exponential backoff.
 */
export async function retryFetch(
    url: string,
    options: RequestInit,
    config: Partial<RetryConfig> = {}
): Promise<RetryResult<Response>> {
    const cfg = { ...retryConfig, ...config };
    const startTime = Date.now();
    let lastError: any = null;
    
    for (let attempt = 0; attempt <= cfg.maxRetries; attempt++) {
        try {
            const response = await fetch(url, options);
            
            // Check if we should retry based on status code
            if (response.ok || !isRetryableStatus(response.status)) {
                return {
                    success: true,
                    result: response,
                    attempts: attempt + 1,
                    totalDuration: Date.now() - startTime,
                };
            }
            
            // Status is retryable, store error and continue
            lastError = new Error(`HTTP ${response.status}: ${response.statusText}`);
            
            // Don't sleep after the last attempt
            if (attempt < cfg.maxRetries) {
                const delay = addJitter(calculateDelay(attempt));
                console.warn(`⚠️ Retry attempt ${attempt + 1}/${cfg.maxRetries} after ${delay}ms (status ${response.status})`);
                await sleep(delay);
            }
            
        } catch (error: any) {
            lastError = error;
            
            // Check if error is retryable
            if (!isRetryableError(error)) {
                // Non-retryable error, fail immediately
                return {
                    success: false,
                    error: error,
                    attempts: attempt + 1,
                    totalDuration: Date.now() - startTime,
                };
            }
            
            // Don't sleep after the last attempt
            if (attempt < cfg.maxRetries) {
                const delay = addJitter(calculateDelay(attempt));
                console.warn(`⚠️ Retry attempt ${attempt + 1}/${cfg.maxRetries} after ${delay}ms (${error.code || error.message})`);
                await sleep(delay);
            }
        }
    }
    
    // All retries exhausted
    return {
        success: false,
        error: lastError,
        attempts: cfg.maxRetries + 1,
        totalDuration: Date.now() - startTime,
    };
}

/**
 * Generic retry wrapper for any async function.
 */
export async function retryAsync<T>(
    fn: () => Promise<T>,
    shouldRetry: (error: any) => boolean = () => true,
    config: Partial<RetryConfig> = {}
): Promise<RetryResult<T>> {
    const cfg = { ...retryConfig, ...config };
    const startTime = Date.now();
    let lastError: any = null;
    
    for (let attempt = 0; attempt <= cfg.maxRetries; attempt++) {
        try {
            const result = await fn();
            return {
                success: true,
                result,
                attempts: attempt + 1,
                totalDuration: Date.now() - startTime,
            };
        } catch (error: any) {
            lastError = error;
            
            // Check if we should retry
            if (!shouldRetry(error)) {
                return {
                    success: false,
                    error,
                    attempts: attempt + 1,
                    totalDuration: Date.now() - startTime,
                };
            }
            
            // Don't sleep after the last attempt
            if (attempt < cfg.maxRetries) {
                const delay = addJitter(calculateDelay(attempt));
                console.warn(`⚠️ Retry attempt ${attempt + 1}/${cfg.maxRetries} after ${delay}ms`);
                await sleep(delay);
            }
        }
    }
    
    return {
        success: false,
        error: lastError,
        attempts: cfg.maxRetries + 1,
        totalDuration: Date.now() - startTime,
    };
}

// ── Model fallback chain ─────────────────────────────────────────────────────

export interface FallbackChain {
    models: string[];
    enabled: boolean;
}

const fallbackChains: Record<string, FallbackChain> = {
    'claude-opus-4.8': {
        models: ['claude-opus-4.8', 'claude-sonnet-4.6', 'claude-haiku-4.5'],
        enabled: false,
    },
    'claude-opus-4.6': {
        models: ['claude-opus-4.6', 'claude-sonnet-4.6', 'claude-haiku-4.5'],
        enabled: false,
    },
    'claude-sonnet-4.6': {
        models: ['claude-sonnet-4.6', 'claude-haiku-4.5'],
        enabled: false,
    },
    'gpt-5.4': {
        models: ['gpt-5.4', 'gpt-5.3-codex', 'gpt-5-mini'],
        enabled: false,
    },
};

export function setFallbackChain(model: string, chain: string[], enabled: boolean = true): void {
    fallbackChains[model] = { models: chain, enabled };
}

export function getFallbackChain(model: string): string[] | null {
    const chain = fallbackChains[model];
    if (!chain || !chain.enabled) return null;
    return chain.models;
}

export function enableAllFallbacks(): void {
    for (const chain of Object.values(fallbackChains)) {
        chain.enabled = true;
    }
}

export function disableAllFallbacks(): void {
    for (const chain of Object.values(fallbackChains)) {
        chain.enabled = false;
    }
}
