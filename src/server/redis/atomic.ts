import 'server-only';

import type { Redis } from '@upstash/redis';

// INCR + PEXPIRE atomically. The PTTL re-arm heals keys left without a TTL by
// a crash between the old non-atomic INCR/PEXPIRE pair — otherwise such keys
// only ever grow and permanently rate-lock their owner.
const INCR_WITH_TTL_SCRIPT = [
    "local count = redis.call('INCR', KEYS[1])",
    "if count == 1 or redis.call('PTTL', KEYS[1]) < 0 then",
    "    redis.call('PEXPIRE', KEYS[1], ARGV[1])",
    'end',
    'return count',
].join('\n');

// Compare-and-delete so a lock holder can never release a lock that has
// already expired and been re-acquired by another request.
const COMPARE_DELETE_SCRIPT = [
    "if redis.call('GET', KEYS[1]) == ARGV[1] then",
    "    return redis.call('DEL', KEYS[1])",
    'end',
    'return 0',
].join('\n');

export async function incrWithTtl(redis: Redis, key: string, ttlMs: number): Promise<number> {
    const result = await redis.eval(INCR_WITH_TTL_SCRIPT, [key], [ttlMs]);
    return Number(result);
}

export async function releaseDistributedLock(redis: Redis, key: string, token: string): Promise<void> {
    try {
        await redis.eval(COMPARE_DELETE_SCRIPT, [key], [token]);
    } catch (error) {
        console.warn(`[redis-lock] failed to release key=${key}`, error);
    }
}
