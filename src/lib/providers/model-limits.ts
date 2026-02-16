import type { ModelConfig } from '@/lib/constants';
import { getChutesApiKey } from '@/lib/chutes';

const DEFAULT_CONTEXT_WINDOW_TOKENS = 128000;
const DEFAULT_PROVIDER_MAX_OUTPUT_TOKENS = 65536;
const DEFAULT_LIMITS_CACHE_TTL_MS = 30 * 60 * 1000;

export type LimitsSource = 'google' | 'openrouter' | 'chutes' | 'fallback';

export interface ResolvedModelLimits {
    contextWindowTokens: number;
    maxOutputTokens: number | null;
    source: LimitsSource;
}

interface CachedLimitsEntry {
    value: ResolvedModelLimits;
    expiresAt: number;
}

const LIMITS_CACHE_TTL_MS = readPositiveInt(process.env.CHAT_LIMITS_CACHE_TTL_MS, DEFAULT_LIMITS_CACHE_TTL_MS);
const limitsCache = new Map<string, CachedLimitsEntry>();
const DEBUG_MODEL_LIMITS = process.env.CHAT_DEBUG_MODEL_LIMITS === '1';

function readPositiveInt(value: string | undefined, fallback: number) {
    if (!value) return fallback;
    const parsed = Number.parseInt(value, 10);
    if (!Number.isFinite(parsed) || parsed <= 0) {
        return fallback;
    }
    return parsed;
}

function toPositiveInt(value: unknown): number | null {
    if (typeof value === 'number' && Number.isFinite(value) && value > 0) {
        return Math.floor(value);
    }
    if (typeof value === 'string') {
        const parsed = Number.parseInt(value, 10);
        if (Number.isFinite(parsed) && parsed > 0) {
            return parsed;
        }
    }
    return null;
}

export function resolveOutputTokenCap(maxOutputTokens: number | null | undefined) {
    const parsed = toPositiveInt(maxOutputTokens);
    return parsed ?? DEFAULT_PROVIDER_MAX_OUTPUT_TOKENS;
}

export function logModelLimits(label: string, payload: Record<string, unknown>) {
    if (!DEBUG_MODEL_LIMITS) return;
    try {
        console.log(`[chat][limits] ${label} ${JSON.stringify(payload)}`);
    } catch {
        console.log(`[chat][limits] ${label}`);
    }
}

function getCachedLimits(cacheKey: string): ResolvedModelLimits | null {
    const cached = limitsCache.get(cacheKey);
    if (!cached) return null;
    if (cached.expiresAt <= Date.now()) {
        limitsCache.delete(cacheKey);
        return null;
    }
    return cached.value;
}

function setCachedLimits(cacheKey: string, value: ResolvedModelLimits) {
    limitsCache.set(cacheKey, {
        value,
        expiresAt: Date.now() + LIMITS_CACHE_TTL_MS,
    });
}

function getFallbackLimits(): ResolvedModelLimits {
    return {
        contextWindowTokens: DEFAULT_CONTEXT_WINDOW_TOKENS,
        maxOutputTokens: null,
        source: 'fallback',
    };
}

export async function resolveModelLimits(model: string, modelConfig: ModelConfig, signal?: AbortSignal): Promise<ResolvedModelLimits> {
    const cacheKey = `${modelConfig.provider}:${model}`;
    const cached = getCachedLimits(cacheKey);
    if (cached) return cached;

    let resolved: ResolvedModelLimits | null = null;
    try {
        if (modelConfig.provider === 'google') {
            resolved = await resolveGoogleModelLimits(model, signal);
        } else if (modelConfig.provider === 'openrouter') {
            resolved = await resolveOpenRouterModelLimits(model, signal);
        } else {
            resolved = await resolveChutesModelLimits(model, signal);
        }
    } catch (error) {
        console.warn(`[chat] failed to resolve provider limits for model=${model}`, error);
    }

    const finalLimits = resolved ?? getFallbackLimits();
    logModelLimits('resolved-model-limits', {
        model,
        provider: modelConfig.provider,
        source: finalLimits.source,
        contextWindowTokens: finalLimits.contextWindowTokens,
        maxOutputTokens: finalLimits.maxOutputTokens,
    });
    setCachedLimits(cacheKey, finalLimits);
    return finalLimits;
}

async function resolveGoogleModelLimits(model: string, signal?: AbortSignal): Promise<ResolvedModelLimits | null> {
    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey) return null;

    const modelId = model.startsWith('models/') ? model.slice('models/'.length) : model;
    const url = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(modelId)}?key=${encodeURIComponent(apiKey)}`;
    const response = await fetch(url, { method: 'GET', signal });
    if (!response.ok) return null;

    const payload = await response.json() as Record<string, unknown>;
    const contextWindowTokens = toPositiveInt(payload.inputTokenLimit);
    if (!contextWindowTokens) return null;

    const resolvedMaxOutput = toPositiveInt(payload.outputTokenLimit);
    logModelLimits('google-model-limits', {
        model,
        raw: {
            inputTokenLimit: payload.inputTokenLimit,
            outputTokenLimit: payload.outputTokenLimit,
        },
        resolved: {
            contextWindowTokens,
            maxOutputTokens: resolvedMaxOutput,
        },
    });

    return {
        contextWindowTokens,
        maxOutputTokens: resolvedMaxOutput,
        source: 'google',
    };
}

async function resolveOpenRouterModelLimits(model: string, signal?: AbortSignal): Promise<ResolvedModelLimits | null> {
    const apiKey = process.env.OPENROUTER_API_KEY;
    if (!apiKey) return null;

    const response = await fetch('https://openrouter.ai/api/v1/models', {
        method: 'GET',
        headers: {
            'Authorization': `Bearer ${apiKey}`,
        },
        signal,
    });

    if (!response.ok) return null;

    const payload = await response.json() as Record<string, unknown>;
    const data = payload.data;
    if (!Array.isArray(data)) return null;

    const modelEntry = data.find((item) => {
        if (!item || typeof item !== 'object') return false;
        const record = item as Record<string, unknown>;
        return record.id === model;
    }) as Record<string, unknown> | undefined;

    if (!modelEntry) return null;

    const topProvider = (modelEntry.top_provider && typeof modelEntry.top_provider === 'object')
        ? modelEntry.top_provider as Record<string, unknown>
        : null;

    const contextWindowTokens =
        toPositiveInt(modelEntry.context_length) ??
        toPositiveInt(topProvider?.context_length);

    if (!contextWindowTokens) return null;

    const resolvedMaxOutput =
        toPositiveInt(topProvider?.max_completion_tokens) ??
        toPositiveInt(modelEntry.max_completion_tokens) ??
        toPositiveInt(modelEntry.max_output_length);
    logModelLimits('openrouter-model-limits', {
        model,
        raw: {
            context_length: modelEntry.context_length,
            top_provider_context_length: topProvider?.context_length,
            max_completion_tokens: modelEntry.max_completion_tokens,
            top_provider_max_completion_tokens: topProvider?.max_completion_tokens,
            max_output_length: modelEntry.max_output_length,
        },
        resolved: {
            contextWindowTokens,
            maxOutputTokens: resolvedMaxOutput,
        },
    });

    return {
        contextWindowTokens,
        maxOutputTokens: resolvedMaxOutput,
        source: 'openrouter',
    };
}

async function resolveChutesModelLimits(model: string, signal?: AbortSignal): Promise<ResolvedModelLimits | null> {
    const apiKey = getChutesApiKey();
    if (!apiKey) return null;

    const response = await fetch('https://llm.chutes.ai/v1/models', {
        method: 'GET',
        headers: {
            'Authorization': `Bearer ${apiKey}`,
        },
        signal,
    });

    if (!response.ok) return null;

    const payload = await response.json() as Record<string, unknown>;
    const data = payload.data;
    if (!Array.isArray(data)) return null;

    const modelEntry = data.find((item) => {
        if (!item || typeof item !== 'object') return false;
        const record = item as Record<string, unknown>;
        return record.id === model;
    }) as Record<string, unknown> | undefined;

    if (!modelEntry) return null;

    const contextWindowTokens =
        toPositiveInt(modelEntry.context_length) ??
        toPositiveInt(modelEntry.max_prompt_tokens) ??
        toPositiveInt(modelEntry.input_token_limit);

    if (!contextWindowTokens) return null;

    const resolvedMaxOutput =
        toPositiveInt(modelEntry.max_completion_tokens) ??
        toPositiveInt(modelEntry.max_output_tokens) ??
        toPositiveInt(modelEntry.output_token_limit) ??
        toPositiveInt(modelEntry.max_output_length);
    logModelLimits('chutes-model-limits', {
        model,
        raw: {
            context_length: modelEntry.context_length,
            max_prompt_tokens: modelEntry.max_prompt_tokens,
            input_token_limit: modelEntry.input_token_limit,
            max_completion_tokens: modelEntry.max_completion_tokens,
            max_output_tokens: modelEntry.max_output_tokens,
            output_token_limit: modelEntry.output_token_limit,
            max_output_length: modelEntry.max_output_length,
        },
        resolved: {
            contextWindowTokens,
            maxOutputTokens: resolvedMaxOutput,
        },
    });

    return {
        contextWindowTokens,
        maxOutputTokens: resolvedMaxOutput,
        source: 'chutes',
    };
}
