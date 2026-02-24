import 'server-only';

import { randomUUID } from 'node:crypto';

import { getRedisClient, redisKey } from '@/server/redis/client';
import { readPositiveInt } from '@/shared/lib/read-positive-int';

export interface RedisLockHandle {
    slot: number;
    release: () => Promise<void>;
}

function getDefaultLockTtlMs() {
    return readPositiveInt(process.env.GENERATION_LOCK_TTL_MS, 5 * 60 * 1000);
}

export async function acquireScopedSlotsLock(
    scope: string,
    key: string,
    maxSlots: number,
    ttlMs: number = getDefaultLockTtlMs()
): Promise<RedisLockHandle | null> {
    const redis = getRedisClient();
    if (!redis) {
        return {
            slot: 1,
            release: async () => {},
        };
    }

    const normalizedSlots = Math.max(1, maxSlots);
    const token = randomUUID();

    for (let slot = 1; slot <= normalizedSlots; slot++) {
        const lockKey = redisKey('lock', scope, key, slot);
        try {
            const reserved = await redis.set(lockKey, token, { nx: true, px: ttlMs });
            if (reserved !== 'OK') continue;

            return {
                slot,
                release: async () => {
                    try {
                        const current = await redis.get<string>(lockKey);
                        if (current === token) {
                            await redis.del(lockKey);
                        }
                    } catch (error) {
                        console.warn(`[locks] failed to release key=${lockKey}`, error);
                    }
                },
            };
        } catch (error) {
            console.warn(`[locks] failed to reserve key=${lockKey}`, error);
        }
    }

    return null;
}
