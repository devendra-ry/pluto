import { ApiRequestError } from './api-security';
import type { Redis } from '@upstash/redis';
import { getRedisClient, redisKey } from '@/server/redis/client';

interface FixedWindowEntry {
    count: number;
    resetAt: number;
}

export class SimpleRateLimiter {
    private storage = new Map<string, FixedWindowEntry>();
    private readonly limit: number;
    private readonly windowMs: number;
    private readonly maxEntries: number;
    private readonly scope: string;

    constructor(limit: number, windowMs: number, options?: { maxEntries?: number; scope?: string }) {
        this.limit = limit;
        this.windowMs = windowMs;
        this.maxEntries = options?.maxEntries ?? 10000;
        this.scope = options?.scope ?? `${limit}-${windowMs}`;
    }

    private async checkRedis(redis: Redis, key: string) {
        const keyName = redisKey('ratelimit', this.scope, key);
        const count = await redis.incr(keyName);
        if (count === 1) {
            await redis.pexpire(keyName, this.windowMs);
        }
        return count <= this.limit;
    }

    /**
     * Checks if the request should be allowed for the given key.
     * @returns true if allowed, false if rate limited.
     */
    async check(key: string): Promise<boolean> {
        const redis = getRedisClient();
        if (redis) {
            try {
                return await this.checkRedis(redis, key);
            } catch (error) {
                console.warn(`[rate-limit] redis check failed for scope=${this.scope}`, error);
            }
        }

        return this.checkMemory(key);
    }

    private checkMemory(key: string): boolean {
        const now = Date.now();
        const existing = this.storage.get(key);
        if (!existing || existing.resetAt <= now) {
            this.setMemoryEntry(key, { count: 1, resetAt: now + this.windowMs });
            return true;
        }

        if (existing.count >= this.limit) {
            // Even if rate limited, we update its position to "recently used"
            this.setMemoryEntry(key, existing);
            return false;
        }

        this.setMemoryEntry(key, {
            count: existing.count + 1,
            resetAt: existing.resetAt,
        });
        return true;
    }

    private setMemoryEntry(key: string, entry: FixedWindowEntry) {
        // LRU Eviction: if we have too many keys, evict the least recently used (the one at the start of the Map)
        if (this.storage.size >= this.maxEntries && !this.storage.has(key)) {
            const lruKey = this.storage.keys().next().value;
            if (lruKey) this.storage.delete(lruKey);
        }

        // Re-set to move the key to the end of the insertion order (making it the "most recently used")
        this.storage.delete(key);
        this.storage.set(key, entry);
    }

    /**
     * Periodically clean up old entries from the storage.
     */
    cleanup() {
        const now = Date.now();
        for (const [key, entry] of this.storage.entries()) {
            if (entry.resetAt <= now) {
                this.storage.delete(key);
            }
        }
    }
}

// Export pre-configured limiters for different endpoint types
// Limits are per user per minute
export const chatRateLimiter = new SimpleRateLimiter(20, 60 * 1000, { scope: 'chat' });
export const imageRateLimiter = new SimpleRateLimiter(5, 60 * 1000, { scope: 'image' });
export const videoRateLimiter = new SimpleRateLimiter(2, 60 * 1000, { scope: 'video' });
export const uploadRateLimiter = new SimpleRateLimiter(10, 60 * 1000, { scope: 'upload' });

// Set up periodic cleanup every 5 minutes
if (typeof setInterval !== 'undefined') {
    setInterval(() => {
        chatRateLimiter.cleanup();
        imageRateLimiter.cleanup();
        videoRateLimiter.cleanup();
        uploadRateLimiter.cleanup();
    }, 5 * 60 * 1000).unref?.();
}

/**
 * Asserts that the rate limit has not been exceeded for the given user and limiter.
 * @throws ApiRequestError with 429 status if rate limited.
 */
export async function assertRateLimit(userId: string, limiter: SimpleRateLimiter) {
    if (!(await limiter.check(userId))) {
        throw new ApiRequestError(429, 'Too many requests. Please try again later.');
    }
}