import 'server-only';

import { ApiRequestError } from '@/utils/api-security';
import { getRedisClient, redisKey } from '@/server/redis/client';

function readPositiveInt(value: string | undefined, fallback: number) {
    const parsed = Number.parseInt(value ?? '', 10);
    if (!Number.isFinite(parsed) || parsed <= 0) return fallback;
    return parsed;
}

const ABUSE_WINDOW_MS = readPositiveInt(process.env.ABUSE_SIGNAL_WINDOW_MS, 10 * 60 * 1000);
const ABUSE_BLOCK_MS = readPositiveInt(process.env.ABUSE_BLOCK_MS, 15 * 60 * 1000);
const ABUSE_THRESHOLD = readPositiveInt(process.env.ABUSE_THRESHOLD, 12);

function blockKey(userId: string, scope: string) {
    return redisKey('abuse', 'block', scope, userId);
}

function counterKey(userId: string, scope: string) {
    return redisKey('abuse', 'count', scope, userId);
}

export async function assertNotTemporarilyBlocked(userId: string, scope: string) {
    const redis = getRedisClient();
    if (!redis) return;

    try {
        const blocked = await redis.get<string>(blockKey(userId, scope));
        if (blocked) {
            throw new ApiRequestError(429, 'Too many failed requests. Please try again later.');
        }
    } catch (error) {
        if (error instanceof ApiRequestError) throw error;
        console.warn(`[abuse] failed to check block state user=${userId} scope=${scope}`, error);
    }
}

export async function recordAbuseSignal(userId: string, scope: string, reason: string) {
    const redis = getRedisClient();
    if (!redis) return;

    const cKey = counterKey(userId, scope);
    const bKey = blockKey(userId, scope);
    try {
        const count = await redis.incr(cKey);
        if (count === 1) {
            await redis.pexpire(cKey, ABUSE_WINDOW_MS);
        }

        if (count >= ABUSE_THRESHOLD) {
            await redis.set(bKey, reason, { px: ABUSE_BLOCK_MS });
            await redis.del(cKey);
        }
    } catch (error) {
        console.warn(`[abuse] failed to record signal user=${userId} scope=${scope} reason=${reason}`, error);
    }
}
