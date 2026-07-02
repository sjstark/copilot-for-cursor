import { describe, it, expect } from 'bun:test';
import {
    normalizeModelId,
    stripModelPrefix,
    resolveModelForUpstream,
    needsLowReasoningEffort,
    needsResponsesAPI,
    isFableModel,
} from './model-routing';

describe('normalizeModelId', () => {
    it('converts version dashes to dots', () => {
        expect(normalizeModelId('claude-sonnet-4-6')).toBe('claude-sonnet-4.6');
        expect(normalizeModelId('claude-opus-4-6')).toBe('claude-opus-4.6');
    });

    it('leaves non-version dashes unchanged', () => {
        expect(normalizeModelId('gpt-5-mini')).toBe('gpt-5-mini');
        expect(normalizeModelId('gpt-5.3-codex')).toBe('gpt-5.3-codex');
    });
});

describe('resolveModelForUpstream', () => {
    it('strips cus- prefix and normalizes', () => {
        expect(resolveModelForUpstream('cus-claude-sonnet-4-6')).toBe('claude-sonnet-4.6');
    });

    it('normalizes even without prefix', () => {
        expect(resolveModelForUpstream('claude-sonnet-4-6')).toBe('claude-sonnet-4.6');
    });
});

describe('needsLowReasoningEffort', () => {
    it('matches Claude 4.6 models', () => {
        expect(needsLowReasoningEffort('claude-opus-4.6')).toBe(true);
        expect(needsLowReasoningEffort('cus-claude-sonnet-4-6')).toBe(true);
    });

    it('does not match older Claude models', () => {
        expect(needsLowReasoningEffort('claude-sonnet-4.5')).toBe(false);
        expect(needsLowReasoningEffort('claude-haiku-4.5')).toBe(false);
    });
});

describe('needsResponsesAPI', () => {
    it('matches GPT-5.2+ and codex variants', () => {
        expect(needsResponsesAPI('gpt-5.3-codex')).toBe(true);
        expect(needsResponsesAPI('gpt-5.2')).toBe(true);
    });

    it('does not match GPT-5.1 or Claude', () => {
        expect(needsResponsesAPI('gpt-5.1')).toBe(false);
        expect(needsResponsesAPI('claude-sonnet-4.6')).toBe(false);
    });
});

describe('isFableModel', () => {
    it('matches Claude Fable models', () => {
        expect(isFableModel('claude-fable-5')).toBe(true);
        expect(isFableModel('cus-claude-fable-5')).toBe(true);
        expect(isFableModel('claude-mythos-5')).toBe(true);
    });

    it('does not match other Claude models', () => {
        expect(isFableModel('claude-sonnet-4.5')).toBe(false);
        expect(isFableModel('claude-opus-4.8')).toBe(false);
        expect(isFableModel('claude-haiku-4.5')).toBe(false);
    });
});
