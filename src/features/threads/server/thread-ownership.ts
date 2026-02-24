import { createClient } from '@/utils/supabase/server';
import { getRedisClient, redisKey } from '@/server/redis/client';
import { readPositiveInt } from '@/shared/lib/read-positive-int';

type ServerSupabaseClient = ReturnType<typeof createClient>;

const THREAD_OWNERSHIP_CACHE_TTL_MS = readPositiveInt(process.env.THREAD_OWNERSHIP_CACHE_TTL_MS, 5 * 60 * 1000);

export async function assertThreadOwnership(
    supabase: ServerSupabaseClient,
    threadId: string,
    userId: string,
    createDeniedError?: () => Error
) {
    const cacheKey = redisKey('thread-owner', threadId, userId);
    const redis = getRedisClient();
    if (redis) {
        try {
            const cached = await redis.get<string>(cacheKey);
            if (cached === '1') return;
        } catch (error) {
            console.warn(`[thread-ownership] failed to read cache key=${cacheKey}`, error);
        }
    }

    const { data, error } = await supabase
        .from('threads')
        .select('id')
        .eq('id', threadId)
        .eq('user_id', userId)
        .single();

    if (error || !data) {
        throw createDeniedError?.() ?? new Error('Thread not found or access denied');
    }

    if (redis) {
        try {
            await redis.set(cacheKey, '1', { px: THREAD_OWNERSHIP_CACHE_TTL_MS });
        } catch (cacheError) {
            console.warn(`[thread-ownership] failed to write cache key=${cacheKey}`, cacheError);
        }
    }
}
