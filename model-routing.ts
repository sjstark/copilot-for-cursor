export function needsResponsesAPI(model: string): boolean {
    return /^(?:gpt-5\.(?:[2-9]|\d{2,})(?:-codex)?|o\d+|goldeneye)/i.test(model);
}

/**
 * Claude Fable 5 is a frontier model that may need extended thinking support.
 * Returns true if the model is Claude Fable or Mythos.
 */
export function isFableModel(model: string): boolean {
    const id = resolveModelForUpstream(model).toLowerCase();
    return /claude-(?:fable|mythos)-\d+/.test(id);
}

/**
 * Normalizes a model ID by converting version-number dashes to dots.
 * e.g. "claude-sonnet-4-6" → "claude-sonnet-4.6"
 *      "gpt-5-mini"        → "gpt-5-mini"  (unchanged: "mini" is not a digit)
 */
export function normalizeModelId(model: string): string {
    return model.replace(/(\d)-(\d)/g, '$1.$2');
}

export const COPILOT_MODEL_PREFIX = 'cus-';

/** True when Cursor asked for a Copilot (work) model via the `cus-` prefix. */
export function isCopilotRoutedModel(model: string, prefix = COPILOT_MODEL_PREFIX): boolean {
    return typeof model === 'string' && model.startsWith(prefix);
}

/** Prefix a Copilot model id unless it already has one. */
export function withCopilotPrefix(model: string, prefix = COPILOT_MODEL_PREFIX): string {
    return isCopilotRoutedModel(model, prefix) ? model : prefix + model;
}

/** Strip the Cursor proxy prefix (e.g. "cus-") if present. */
export function stripModelPrefix(model: string, prefix = COPILOT_MODEL_PREFIX): string {
    return model.startsWith(prefix) ? model.slice(prefix.length) : model;
}

/** Resolve the model ID to send upstream: strip prefix + normalize version dashes. */
export function resolveModelForUpstream(model: string, prefix = COPILOT_MODEL_PREFIX): string {
    return normalizeModelId(stripModelPrefix(model, prefix));
}

/**
 * Claude 4.6 models use adaptive thinking by default, which streams
 * reasoning_text with empty content and can exhaust max_tokens before
 * any visible reply — Cursor treats that as a broken model.
 */
export function needsLowReasoningEffort(model: string): boolean {
    const id = resolveModelForUpstream(model).toLowerCase();
    return /claude-(?:opus|sonnet)-4\.6/.test(id);
}
