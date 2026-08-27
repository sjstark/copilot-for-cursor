// ── Smart Model Router ────────────────────────────────────────────────────────
// Automatically route requests to optimal models based on prompt complexity,
// cost constraints, and performance requirements.

import { getPricing, type ModelPricing } from './cost-tracking';

// ── Types ────────────────────────────────────────────────────────────────────

export interface RoutingConfig {
    enabled: boolean;
    preferCost: boolean;        // true = minimize cost, false = maximize quality
    maxCostPerRequest: number;  // Max cost in USD (0 = no limit)
    complexityThreshold: {
        simple: number;         // Token count threshold for simple queries
        medium: number;         // Token count threshold for medium queries
    };
}

export interface ModelCapabilities {
    family: string;
    speed: 'fast' | 'medium' | 'slow';
    quality: 'high' | 'medium' | 'low';
    costTier: 'premium' | 'standard' | 'budget';
    strengths: string[];
}

export interface RoutingDecision {
    selectedModel: string;
    reason: string;
    originalModel: string;
    estimatedCost: number;
    complexity: 'simple' | 'medium' | 'complex';
}

// ── Configuration ────────────────────────────────────────────────────────────

let routingConfig: RoutingConfig = {
    enabled: false,
    preferCost: false,
    maxCostPerRequest: 0,
    complexityThreshold: {
        simple: 1000,   // <1k tokens = simple
        medium: 5000,   // 1k-5k tokens = medium
    },
};

export function setRoutingConfig(config: Partial<RoutingConfig>): void {
    routingConfig = { ...routingConfig, ...config };
}

export function getRoutingConfig(): RoutingConfig {
    return { ...routingConfig };
}

export function enableSmartRouting(preferCost: boolean = false): void {
    routingConfig.enabled = true;
    routingConfig.preferCost = preferCost;
}

export function disableSmartRouting(): void {
    routingConfig.enabled = false;
}

// ── Model Capabilities Database ──────────────────────────────────────────────

const modelCapabilities: Record<string, ModelCapabilities> = {
    // Claude models
    'claude-fable-5': {
        family: 'claude',
        speed: 'slow',
        quality: 'high',
        costTier: 'premium',
        strengths: ['reasoning', 'long-context', 'planning', 'complex-tasks'],
    },
    'claude-opus-4.8': {
        family: 'claude',
        speed: 'slow',
        quality: 'high',
        costTier: 'premium',
        strengths: ['reasoning', 'creative-writing', 'analysis'],
    },
    'claude-opus-4.6': {
        family: 'claude',
        speed: 'slow',
        quality: 'high',
        costTier: 'premium',
        strengths: ['reasoning', 'creative-writing', 'analysis'],
    },
    'claude-sonnet-4.6': {
        family: 'claude',
        speed: 'medium',
        quality: 'high',
        costTier: 'standard',
        strengths: ['balanced', 'coding', 'general-purpose'],
    },
    'claude-sonnet-4.5': {
        family: 'claude',
        speed: 'medium',
        quality: 'high',
        costTier: 'standard',
        strengths: ['balanced', 'coding', 'general-purpose'],
    },
    'claude-haiku-4.5': {
        family: 'claude',
        speed: 'fast',
        quality: 'medium',
        costTier: 'budget',
        strengths: ['speed', 'simple-tasks', 'quick-responses'],
    },
    
    // GPT models
    'gpt-5.4': {
        family: 'gpt',
        speed: 'medium',
        quality: 'high',
        costTier: 'standard',
        strengths: ['general-purpose', 'reasoning', 'coding'],
    },
    'gpt-5.3-codex': {
        family: 'gpt',
        speed: 'medium',
        quality: 'high',
        costTier: 'standard',
        strengths: ['coding', 'technical-tasks', 'debugging'],
    },
    'gpt-5-mini': {
        family: 'gpt',
        speed: 'fast',
        quality: 'medium',
        costTier: 'budget',
        strengths: ['speed', 'simple-tasks', 'cost-effective'],
    },
    
    // Gemini models
    'gemini-3.1-pro-preview': {
        family: 'gemini',
        speed: 'medium',
        quality: 'high',
        costTier: 'standard',
        strengths: ['multimodal', 'reasoning', 'long-context'],
    },
    'gemini-3-flash-preview': {
        family: 'gemini',
        speed: 'fast',
        quality: 'medium',
        costTier: 'budget',
        strengths: ['speed', 'multimodal', 'quick-responses'],
    },
};

// ── Complexity Analysis ──────────────────────────────────────────────────────

function estimateTokens(messages: any[]): number {
    // Rough estimation: ~4 chars per token
    let totalChars = 0;
    for (const msg of messages) {
        if (typeof msg.content === 'string') {
            totalChars += msg.content.length;
        } else if (Array.isArray(msg.content)) {
            for (const part of msg.content) {
                if (part.type === 'text' && typeof part.text === 'string') {
                    totalChars += part.text.length;
                }
            }
        }
    }
    return Math.ceil(totalChars / 4);
}

function analyzeComplexity(messages: any[]): 'simple' | 'medium' | 'complex' {
    const tokens = estimateTokens(messages);
    
    if (tokens < routingConfig.complexityThreshold.simple) {
        return 'simple';
    } else if (tokens < routingConfig.complexityThreshold.medium) {
        return 'medium';
    } else {
        return 'complex';
    }
}

function hasCodeTask(messages: any[]): boolean {
    const lastMessage = messages[messages.length - 1];
    if (!lastMessage) return false;
    
    const content = typeof lastMessage.content === 'string' 
        ? lastMessage.content 
        : lastMessage.content?.find((p: any) => p.type === 'text')?.text || '';
    
    const codeKeywords = ['function', 'class', 'import', 'const', 'let', 'var', 'def', 'async', 'await', 'code', 'debug', 'fix', 'refactor'];
    return codeKeywords.some(kw => content.toLowerCase().includes(kw));
}

function hasReasoningTask(messages: any[]): boolean {
    const lastMessage = messages[messages.length - 1];
    if (!lastMessage) return false;
    
    const content = typeof lastMessage.content === 'string' 
        ? lastMessage.content 
        : lastMessage.content?.find((p: any) => p.type === 'text')?.text || '';
    
    const reasoningKeywords = ['analyze', 'explain', 'why', 'how', 'compare', 'evaluate', 'reason', 'think', 'consider'];
    return reasoningKeywords.some(kw => content.toLowerCase().includes(kw));
}

// ── Model Selection ──────────────────────────────────────────────────────────

function getBestModelForComplexity(
    complexity: 'simple' | 'medium' | 'complex',
    family: string,
    preferCost: boolean
): string | null {
    const models = Object.entries(modelCapabilities)
        .filter(([id, caps]) => caps.family === family)
        .map(([id, caps]) => ({ id, caps, pricing: getPricing(id) }));
    
    if (models.length === 0) return null;
    
    // Filter by complexity
    let candidates = models;
    if (complexity === 'simple') {
        candidates = models.filter(m => m.caps.costTier === 'budget' || m.caps.speed === 'fast');
    } else if (complexity === 'medium') {
        candidates = models.filter(m => m.caps.costTier !== 'premium' || m.caps.quality === 'high');
    }
    // For complex, keep all models
    
    if (candidates.length === 0) candidates = models;
    
    // Sort by preference
    if (preferCost) {
        // Minimize cost: sort by input price ascending
        candidates.sort((a, b) => a.pricing.inputPrice - b.pricing.inputPrice);
    } else {
        // Maximize quality: prefer high quality, then standard cost tier
        candidates.sort((a, b) => {
            if (a.caps.quality !== b.caps.quality) {
                return a.caps.quality === 'high' ? -1 : 1;
            }
            return a.pricing.inputPrice - b.pricing.inputPrice; // tie-breaker
        });
    }
    
    return candidates[0]?.id || null;
}

export function selectModel(
    requestedModel: string,
    messages: any[],
    config?: Partial<RoutingConfig>
): RoutingDecision {
    const cfg = { ...routingConfig, ...config };
    
    // If routing disabled, use requested model
    if (!cfg.enabled) {
        return {
            selectedModel: requestedModel,
            reason: 'Smart routing disabled',
            originalModel: requestedModel,
            estimatedCost: 0,
            complexity: 'medium',
        };
    }
    
    // Analyze request
    const complexity = analyzeComplexity(messages);
    const isCodeTask = hasCodeTask(messages);
    const isReasoningTask = hasReasoningTask(messages);
    
    // Determine model family from requested model
    const requestedCaps = modelCapabilities[requestedModel];
    const family = requestedCaps?.family || 'claude';
    
    // Special routing for specific task types
    let selectedModel = requestedModel;
    let reason = 'Using requested model';
    
    // Route coding tasks to codex models
    if (isCodeTask && family === 'gpt') {
        const codexModel = 'gpt-5.3-codex';
        if (modelCapabilities[codexModel]) {
            selectedModel = codexModel;
            reason = 'Routed to Codex for coding task';
        }
    }
    
    // Route simple tasks to faster/cheaper models
    if (complexity === 'simple' && cfg.preferCost) {
        const cheapModel = getBestModelForComplexity('simple', family, true);
        if (cheapModel && cheapModel !== requestedModel) {
            selectedModel = cheapModel;
            reason = `Routed to ${cheapModel} for simple query (cost optimization)`;
        }
    }
    
    // Route complex reasoning to premium models
    if (complexity === 'complex' && isReasoningTask && !cfg.preferCost) {
        const bestModel = getBestModelForComplexity('complex', family, false);
        if (bestModel) {
            selectedModel = bestModel;
            reason = `Routed to ${bestModel} for complex reasoning task`;
        }
    }
    
    // Estimate cost
    const pricing = getPricing(selectedModel);
    const estimatedTokens = estimateTokens(messages);
    const estimatedCost = (estimatedTokens / 1_000_000) * pricing.inputPrice;
    
    // Check cost limit
    if (cfg.maxCostPerRequest > 0 && estimatedCost > cfg.maxCostPerRequest) {
        const cheapModel = getBestModelForComplexity(complexity, family, true);
        if (cheapModel && cheapModel !== selectedModel) {
            selectedModel = cheapModel;
            reason = `Routed to ${cheapModel} due to cost limit ($${cfg.maxCostPerRequest})`;
        }
    }
    
    return {
        selectedModel,
        reason,
        originalModel: requestedModel,
        estimatedCost,
        complexity,
    };
}

// ── Suggested models based on task type ──────────────────────────────────────

export function suggestModelForTask(taskType: string): string[] {
    const suggestions: Record<string, string[]> = {
        'coding': ['gpt-5.3-codex', 'claude-sonnet-4.6', 'gpt-5.4'],
        'reasoning': ['claude-opus-4.8', 'claude-fable-5', 'gpt-5.4'],
        'writing': ['claude-opus-4.8', 'claude-sonnet-4.6', 'gpt-5.4'],
        'simple': ['claude-haiku-4.5', 'gpt-5-mini', 'gemini-3-flash-preview'],
        'analysis': ['claude-opus-4.8', 'gpt-5.4', 'gemini-3.1-pro-preview'],
        'speed': ['claude-haiku-4.5', 'gpt-5-mini', 'gemini-3-flash-preview'],
        'cost': ['claude-haiku-4.5', 'gpt-5-mini', 'gemini-3-flash-preview'],
    };
    
    return suggestions[taskType.toLowerCase()] || ['claude-sonnet-4.6', 'gpt-5.4'];
}
