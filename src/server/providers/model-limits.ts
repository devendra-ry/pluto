import type { ModelConfig } from '@/shared/core/constants';
import { logModelLimits } from '@/server/providers/limits-utils';
import { resolveChatProvider } from '@/server/providers/provider-registry';
import { getRedisClient, redisKey } from '@/server/redis/client';
import type { ResolvedModelLimits } from '@/server/providers/provider-types';
import { readPositiveInt } from '@/shared/lib/read-positive-int';
export type { ResolvedModelLimits } from '@/server/providers/provider-types';
export { logModelLimits, resolveOutputTokenCap } from '@/server/providers/limits-utils';

const DEFAULT_CONTEXT_WINDOW_TOKENS = 128000;
const DEFAULT_LIMITS_CACHE_TTL_MS = 30 * 60 * 1000;

interface CachedLimitsEntry {
    value: ResolvedModelLimits;
    expiresAt: number;
}

const LIMITS_CACHE_TTL_MS = readPositiveInt(process.env.CHAT_LIMITS_CACHE_TTL_MS, DEFAULT_LIMITS_CACHE_TTL_MS);
const limitsCache = new Map<string, CachedLimitsEntry>();

function isResolvedModelLimits(value: unknown): value is ResolvedModelLimits {
    if (!value || typeof value !== 'object') return false;
    const record = value as Record<string, unknown>;
    if (typeof record.contextWindowTokens !== 'number' || !Number.isFinite(record.contextWindowTokens) || record.contextWindowTokens <= 0) {
        return false;
    }
    if (record.maxOutputTokens !== null && (typeof record.maxOutputTokens !== 'number' || !Number.isFinite(record.maxOutputTokens))) {
        return false;
    }
    return typeof record.source === 'string' && record.source.length > 0;
}

function getCachedLimitsFromMemory(cacheKey: string): ResolvedModelLimits | null {
    const cached = limitsCache.get(cacheKey);
    if (!cached) return null;
    if (cached.expiresAt <= Date.now()) {
        limitsCache.delete(cacheKey);
        return null;
    }
    return cached.value;
}

function setCachedLimitsInMemory(cacheKey: string, value: ResolvedModelLimits) {
    limitsCache.set(cacheKey, {
        value,
        expiresAt: Date.now() + LIMITS_CACHE_TTL_MS,
    });
}

async function getCachedLimits(cacheKey: string): Promise<ResolvedModelLimits | null> {
    const inMemory = getCachedLimitsFromMemory(cacheKey);
    if (inMemory) return inMemory;

    const redis = getRedisClient();
    if (!redis) return null;

    const keyName = redisKey('model-limits', cacheKey);
    try {
        const raw = await redis.get<unknown>(keyName);
        if (!raw) return null;

        const parsed = typeof raw === 'string' ? JSON.parse(raw) as unknown : raw;
        if (!isResolvedModelLimits(parsed)) {
            return null;
        }

        setCachedLimitsInMemory(cacheKey, parsed);
        return parsed;
    } catch (error) {
        console.warn(`[chat] failed to read model limits cache for key=${cacheKey}`, error);
        return null;
    }
}

async function setCachedLimits(cacheKey: string, value: ResolvedModelLimits): Promise<void> {
    setCachedLimitsInMemory(cacheKey, value);

    const redis = getRedisClient();
    if (!redis) return;

    const keyName = redisKey('model-limits', cacheKey);
    try {
        await redis.set(keyName, JSON.stringify(value), { px: LIMITS_CACHE_TTL_MS });
    } catch (error) {
        console.warn(`[chat] failed to write model limits cache for key=${cacheKey}`, error);
    }
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
    const cached = await getCachedLimits(cacheKey);
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
    await setCachedLimits(cacheKey, finalLimits);
    return finalLimits;
}
