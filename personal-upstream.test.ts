import { describe, it, expect } from 'bun:test';
import { joinUpstreamPath, normalizeUpstreamBaseUrl, extraPersonalModelIds } from './personal-upstream';

describe('joinUpstreamPath', () => {
    it('keeps /v1 when the base has no version suffix', () => {
        expect(joinUpstreamPath('https://api.openai.com', '/v1/chat/completions').toString())
            .toBe('https://api.openai.com/v1/chat/completions');
    });

    it('does not double /v1 when the base already ends with it', () => {
        expect(joinUpstreamPath('https://api.openai.com/v1', '/v1/chat/completions').toString())
            .toBe('https://api.openai.com/v1/chat/completions');
        expect(joinUpstreamPath('https://api.openai.com/v1/', '/v1/models').toString())
            .toBe('https://api.openai.com/v1/models');
    });
});

describe('normalizeUpstreamBaseUrl', () => {
    it('strips trailing slashes', () => {
        expect(normalizeUpstreamBaseUrl('https://api.openai.com/v1/')).toBe('https://api.openai.com/v1');
    });
});

describe('extraPersonalModelIds', () => {
    it('parses a comma-separated env list', () => {
        const prev = process.env.CURSOR_UPSTREAM_MODELS;
        process.env.CURSOR_UPSTREAM_MODELS = 'gpt-5.4, claude-4.6-sonnet';
        expect(extraPersonalModelIds()).toEqual(['gpt-5.4', 'claude-4.6-sonnet']);
        if (prev === undefined) delete process.env.CURSOR_UPSTREAM_MODELS;
        else process.env.CURSOR_UPSTREAM_MODELS = prev;
    });
});
