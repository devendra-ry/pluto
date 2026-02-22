import 'server-only';

export interface CachedAttachment {
    name: string;
    mimeType: string;
    base64Data: string;
}

interface CacheEntry {
    attachment: CachedAttachment;
    expiresAt: number;
    byteLength: number;
}

export class AttachmentCache {
    private cache = new Map<string, CacheEntry>();
    private readonly maxEntries: number;
    private readonly ttlMs: number;

    constructor(maxEntries = 20, ttlMs = 5 * 60 * 1000) {
        this.maxEntries = maxEntries;
        this.ttlMs = ttlMs;
    }

    get(key: string): { attachment: CachedAttachment; byteLength: number } | undefined {
        const entry = this.cache.get(key);
        if (!entry) return undefined;

        if (Date.now() > entry.expiresAt) {
            this.cache.delete(key);
            return undefined;
        }

        // Move to end (LRU)
        this.cache.delete(key);
        this.cache.set(key, entry);

        return { attachment: entry.attachment, byteLength: entry.byteLength };
    }

    set(key: string, attachment: CachedAttachment, byteLength: number): void {
        if (this.cache.has(key)) {
            this.cache.delete(key);
        } else if (this.cache.size >= this.maxEntries) {
            // Evict oldest
            const oldestKey = this.cache.keys().next().value;
            if (oldestKey) this.cache.delete(oldestKey);
        }

        this.cache.set(key, {
            attachment,
            expiresAt: Date.now() + this.ttlMs,
            byteLength
        });
    }

    // Helper to generate key
    static generateKey(userId: string, path: string): string {
        return `${userId}:${path}`;
    }
}

// Global instance
export const attachmentCache = new AttachmentCache();
