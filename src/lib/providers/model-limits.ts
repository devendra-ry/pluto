import type { ModelConfig } from '@/lib/constants';
import { logModelLimits } from '@/lib/providers/limits-utils';
import { resolveChatProvider } from '@/lib/providers/provider-registry';
import type { ResolvedModelLimits } from '@/lib/providers/provider-types';
export type { ResolvedModelLimits } from '@/lib/providers/provider-types';
export { logModelLimits, resolveOutputTokenCap } from '@/lib/providers/limits-utils';

const DEFAULT_CONTEXT_WINDOW_TOKENS = 128000;
const DEFAULT_LIMITS_CACHE_TTL_MS = 30 * 60 * 1000;

interface CachedLimitsEntry {
    value: ResolvedModelLimits;
    expiresAt: number;
}

const LIMITS_CACHE_TTL_MS = readPositiveInt(process.env.CHAT_LIMITS_CACHE_TTL_MS, DEFAULT_LIMITS_CACHE_TTL_MS);
const limitsCache = new Map<string, CachedLimitsEntry>();

function readPositiveInt(value: string | undefined, fallback: number) {
    if (!value) return fallback;
    const parsed = Number.parseInt(value, 10);
    if (!Number.isFinite(parsed) || parsed <= 0) {
        return fallback;
    }
    return parsed;
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

    const provider = resolveChatProvider(modelConfig);
    let resolved: ResolvedModelLimits | null = null;
    try {
        resolved = await provider.resolveModelLimits({ model, signal });
    } catch (error) {
        console.warn(`[chat] failed to resolve provider limits for model=${model} provider=${provider.id}`, error);
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
