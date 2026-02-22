import { ApiRequestError } from './api-security';

export class SimpleRateLimiter {
    private storage = new Map<string, number[]>();
    private readonly limit: number;
    private readonly windowMs: number;
    private readonly maxEntries: number;

    constructor(limit: number, windowMs: number, maxEntries = 10000) {
        this.limit = limit;
        this.windowMs = windowMs;
        this.maxEntries = maxEntries;
    }

    /**
     * Checks if the request should be allowed for the given key.
     * @returns true if allowed, false if rate limited.
     */
    check(key: string): boolean {
        const now = Date.now();
        let timestamps = this.storage.get(key) || [];

        // Filter out timestamps outside the current window
        const windowStart = now - this.windowMs;
        timestamps = timestamps.filter(ts => ts > windowStart);

        if (timestamps.length >= this.limit) {
            // Even if rate limited, we update its position to "recently used"
            this.storage.delete(key);
            this.storage.set(key, timestamps);
            return false;
        }

        timestamps.push(now);

        // LRU Eviction: if we have too many keys, evict the least recently used (the one at the start of the Map)
        if (this.storage.size >= this.maxEntries && !this.storage.has(key)) {
            const lruKey = this.storage.keys().next().value;
            if (lruKey) this.storage.delete(lruKey);
        }

        // Re-set to move the key to the end of the insertion order (making it the "most recently used")
        this.storage.delete(key);
        this.storage.set(key, timestamps);
        return true;
    }

    /**
     * Periodically clean up old entries from the storage.
     */
    cleanup() {
        const now = Date.now();
        for (const [key, timestamps] of this.storage.entries()) {
            const valid = timestamps.filter(ts => ts > now - this.windowMs);
            if (valid.length === 0) {
                this.storage.delete(key);
            } else if (valid.length !== timestamps.length) {
                this.storage.set(key, valid);
            }
        }
    }
}

// Export pre-configured limiters for different endpoint types
// Limits are per user per minute
export const chatRateLimiter = new SimpleRateLimiter(20, 60 * 1000);
export const imageRateLimiter = new SimpleRateLimiter(5, 60 * 1000);
export const videoRateLimiter = new SimpleRateLimiter(2, 60 * 1000);
export const uploadRateLimiter = new SimpleRateLimiter(10, 60 * 1000);

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
export function assertRateLimit(userId: string, limiter: SimpleRateLimiter) {
    if (!limiter.check(userId)) {
        throw new ApiRequestError(429, 'Too many requests. Please try again later.');
    }
}
