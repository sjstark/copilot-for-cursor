export function needsResponsesAPI(model: string): boolean {
    return /^(?:gpt-5\.(?:[2-9]|\d{2,})(?:-codex)?|o\d+|goldeneye)/i.test(model);
}

/**
 * Normalizes a model ID by converting version-number dashes to dots.
 * e.g. "claude-sonnet-4-6" → "claude-sonnet-4.6"
 *      "gpt-5-mini"        → "gpt-5-mini"  (unchanged: "mini" is not a digit)
 */
export function normalizeModelId(model: string): string {
    return model.replace(/(\d)-(\d)/g, '$1.$2');
}
