import { getUpstreamAuthHeader } from './upstream-auth';

// ── Types ────────────────────────────────────────────────────────────────────

export interface ModelPricing {
    inputPrice: number;      // cents per million tokens (500 = $5/M tokens)
    outputPrice: number;     // cents per million tokens  
    cachePrice?: number;     // cents per million tokens (cache reads)
    cacheWritePrice?: number; // cents per million tokens (cache writes)
}

export interface CostEstimate {
    inputCost: number;
    outputCost: number;
    totalCost: number;
    currency: string;
}

// ── State ────────────────────────────────────────────────────────────────────

const pricingCache = new Map<string, ModelPricing>();

// Fallback pricing (in cents per million tokens) — only used when upstream doesn't provide pricing.
// These match GitHub Copilot's bulk pricing, which is significantly lower than retail Anthropic/OpenAI pricing.
// Note: These are in CENTS, so 500 = $5.00 per million tokens
const DEFAULT_PRICING: Record<string, ModelPricing> = {
    // Claude models (Copilot bulk pricing in cents/M tokens)
    'claude-opus-4.8': { inputPrice: 500, outputPrice: 2500 },  // $5 input, $25 output per M
    'claude-opus-4.6': { inputPrice: 500, outputPrice: 2500 },
    'claude-opus-4.5': { inputPrice: 500, outputPrice: 2500 },
    'claude-sonnet-4.6': { inputPrice: 300, outputPrice: 1500 },  // $3 input, $15 output per M
    'claude-sonnet-4.5': { inputPrice: 300, outputPrice: 1500 },
    'claude-sonnet-4': { inputPrice: 300, outputPrice: 1500 },
    'claude-haiku-4.5': { inputPrice: 100, outputPrice: 500 },  // $1 input, $5 output per M
    'claude-fable-5': { inputPrice: 1000, outputPrice: 5000 },  // $10 input, $50 output per M (estimated)
    
    // GPT models (Copilot bulk pricing in cents/M tokens)
    'gpt-5.4': { inputPrice: 250, outputPrice: 1250 },
    'gpt-5.4-mini': { inputPrice: 30, outputPrice: 150 },
    'gpt-5.3-codex': { inputPrice: 175, outputPrice: 1400 },
    'gpt-5.2': { inputPrice: 150, outputPrice: 900 },
    'gpt-5.2-codex': { inputPrice: 150, outputPrice: 900 },
    'gpt-5.1': { inputPrice: 100, outputPrice: 600 },
    'gpt-5-mini': { inputPrice: 25, outputPrice: 200 },
    'gpt-4o': { inputPrice: 250, outputPrice: 1000 },
    'gpt-4.1': { inputPrice: 300, outputPrice: 1200 },
    
    // Gemini models (Copilot bulk pricing in cents/M tokens)
    'gemini-3.1-pro-preview': { inputPrice: 125, outputPrice: 500 },
    'gemini-3-flash-preview': { inputPrice: 38, outputPrice: 150 },
    'gemini-2.5-pro': { inputPrice: 125, outputPrice: 375 },
    
    // Default fallback
    'default': { inputPrice: 100, outputPrice: 500 },
};

function getDefaultPricing(model: string): ModelPricing {
    const lower = model.toLowerCase();
    // Try exact match first
    if (DEFAULT_PRICING[lower]) return DEFAULT_PRICING[lower];
    
    // Try prefix match
    for (const [key, pricing] of Object.entries(DEFAULT_PRICING)) {
        if (key !== 'default' && lower.includes(key)) return pricing;
    }
    
    return DEFAULT_PRICING['default'];
}

// ── Fetch pricing from upstream ──────────────────────────────────────────────

export async function fetchAndCachePricing(targetUrl: string): Promise<void> {
    try {
        const resp = await fetch(new URL('/v1/models', targetUrl).toString(), {
            headers: { 'Authorization': getUpstreamAuthHeader() },
            signal: AbortSignal.timeout(10000),
        });
        
        if (!resp.ok) {
            console.warn(`⚠️ Cost tracking: failed to fetch pricing (${resp.status})`);
            return;
        }
        
        const data = await resp.json() as any;
        if (!data.data || !Array.isArray(data.data)) return;

        let cached = 0;
        for (const model of data.data) {
            const billing = model.billing?.token_prices?.default;
            if (billing) {
                const pricing: ModelPricing = {
                    inputPrice: billing.input_price || 0,
                    outputPrice: billing.output_price || 0,
                    cachePrice: billing.cache_price,
                    cacheWritePrice: billing.cache_write_price,
                };
                
                // Cache both the original ID and normalized version
                pricingCache.set(model.id, pricing);
                const normalized = model.id.replace(/(\d)-(\d)/g, '$1.$2');
                if (normalized !== model.id) {
                    pricingCache.set(normalized, pricing);
                }
                cached++;
            }
        }
        
        console.log(`💰 Cost tracking: cached pricing for ${cached} models`);
        if (cached > 0) {
            const sample = Array.from(pricingCache.entries()).slice(0, 3);
            for (const [id, price] of sample) {
                console.log(`   ${id}: $${price.inputPrice}/M in, $${price.outputPrice}/M out`);
            }
            if (pricingCache.size > 3) {
                console.log(`   ... and ${pricingCache.size - 3} more`);
            }
        }
    } catch (e: any) {
        console.warn(`⚠️ Cost tracking: failed to fetch pricing: ${e?.message || e}`);
    }
}

// ── Calculate costs ──────────────────────────────────────────────────────────

export function calculateCost(
    model: string,
    promptTokens: number,
    completionTokens: number,
): CostEstimate {
    const pricing = pricingCache.get(model) || getDefaultPricing(model);
    
    // Prices are in cents per million tokens
    // Convert to dollars: (tokens / 1M) * (cents / 100)
    const inputCost = (promptTokens / 1_000_000) * (pricing.inputPrice / 100);
    const outputCost = (completionTokens / 1_000_000) * (pricing.outputPrice / 100);
    const totalCost = inputCost + outputCost;
    
    return {
        inputCost: parseFloat(inputCost.toFixed(6)),
        outputCost: parseFloat(outputCost.toFixed(6)),
        totalCost: parseFloat(totalCost.toFixed(6)),
        currency: 'USD',
    };
}

export function getPricing(model: string): ModelPricing {
    return pricingCache.get(model) || getDefaultPricing(model);
}

export function formatCost(cost: number): string {
    if (cost < 0.01) {
        return `$${(cost * 1000).toFixed(3)}‰`; // per mille symbol for very small amounts
    }
    return `$${cost.toFixed(4)}`;
}

// ── Budget tracking ──────────────────────────────────────────────────────────

interface BudgetConfig {
    dailyLimit?: number;
    monthlyLimit?: number;
    perModelLimits?: Record<string, number>;
}

interface BudgetStatus {
    dailySpent: number;
    monthlySpent: number;
    dailyRemaining: number;
    monthlyRemaining: number;
    dailyPercentage: number;
    monthlyPercentage: number;
    alerts: string[];
}

let budgetConfig: BudgetConfig = {};
let dailySpend = 0;
let monthlySpend = 0;
let lastResetDate = new Date().toISOString().slice(0, 10);
let lastResetMonth = new Date().toISOString().slice(0, 7);

export function setBudget(config: BudgetConfig): void {
    budgetConfig = config;
    console.log(`💰 Budget configured:`, config);
}

export function trackSpending(cost: number): void {
    const today = new Date().toISOString().slice(0, 10);
    const month = new Date().toISOString().slice(0, 7);
    
    // Reset counters if day/month changed
    if (today !== lastResetDate) {
        dailySpend = 0;
        lastResetDate = today;
    }
    if (month !== lastResetMonth) {
        monthlySpend = 0;
        lastResetMonth = month;
    }
    
    dailySpend += cost;
    monthlySpend += cost;
}

export function getBudgetStatus(): BudgetStatus {
    const alerts: string[] = [];
    
    const dailyRemaining = budgetConfig.dailyLimit 
        ? Math.max(0, budgetConfig.dailyLimit - dailySpend)
        : Infinity;
    const monthlyRemaining = budgetConfig.monthlyLimit
        ? Math.max(0, budgetConfig.monthlyLimit - monthlySpend)
        : Infinity;
    
    const dailyPercentage = budgetConfig.dailyLimit
        ? (dailySpend / budgetConfig.dailyLimit) * 100
        : 0;
    const monthlyPercentage = budgetConfig.monthlyLimit
        ? (monthlySpend / budgetConfig.monthlyLimit) * 100
        : 0;
    
    // Generate alerts
    if (budgetConfig.dailyLimit && dailyPercentage >= 100) {
        alerts.push('Daily budget exceeded');
    } else if (budgetConfig.dailyLimit && dailyPercentage >= 90) {
        alerts.push('Daily budget at 90%');
    } else if (budgetConfig.dailyLimit && dailyPercentage >= 75) {
        alerts.push('Daily budget at 75%');
    }
    
    if (budgetConfig.monthlyLimit && monthlyPercentage >= 100) {
        alerts.push('Monthly budget exceeded');
    } else if (budgetConfig.monthlyLimit && monthlyPercentage >= 90) {
        alerts.push('Monthly budget at 90%');
    } else if (budgetConfig.monthlyLimit && monthlyPercentage >= 75) {
        alerts.push('Monthly budget at 75%');
    }
    
    return {
        dailySpent: parseFloat(dailySpend.toFixed(4)),
        monthlySpent: parseFloat(monthlySpend.toFixed(4)),
        dailyRemaining: isFinite(dailyRemaining) ? parseFloat(dailyRemaining.toFixed(4)) : Infinity,
        monthlyRemaining: isFinite(monthlyRemaining) ? parseFloat(monthlyRemaining.toFixed(4)) : Infinity,
        dailyPercentage: parseFloat(dailyPercentage.toFixed(2)),
        monthlyPercentage: parseFloat(monthlyPercentage.toFixed(2)),
        alerts,
    };
}

export function checkBudgetExceeded(): boolean {
    const status = getBudgetStatus();
    return status.dailyPercentage >= 100 || status.monthlyPercentage >= 100;
}
