interface CacheEntry<T> {
    value: T;
    expiresAt: number;
}

export class AttachmentCache<T> {
    private cache: Map<string, CacheEntry<T>>;
    private readonly maxItems: number;
    private readonly ttlMs: number;

    constructor(maxItems: number = 20, ttlMs: number = 5 * 60 * 1000) {
        this.cache = new Map();
        this.maxItems = maxItems;
        this.ttlMs = ttlMs;
    }

    get(key: string): T | undefined {
        const entry = this.cache.get(key);
        if (!entry) {
            return undefined;
        }

        const now = Date.now();
        if (now > entry.expiresAt) {
            this.cache.delete(key);
            return undefined;
        }

        // Refresh LRU order: delete and re-insert
        this.cache.delete(key);
        // Extend TTL on access (sliding window)
        entry.expiresAt = now + this.ttlMs;
        this.cache.set(key, entry);

        return entry.value;
    }

    set(key: string, value: T): void {
        const now = Date.now();

        // If key exists, remove it first so it's re-inserted at the end
        if (this.cache.has(key)) {
            this.cache.delete(key);
        } else if (this.cache.size >= this.maxItems) {
            // Evict least recently used (first item in Map iteration order)
            const firstKey = this.cache.keys().next().value;
            if (firstKey !== undefined) {
                this.cache.delete(firstKey);
            }
        }

        this.cache.set(key, {
            value,
            expiresAt: now + this.ttlMs,
        });
    }

    clear(): void {
        this.cache.clear();
    }
}