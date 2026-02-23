import { getRedisClient, redisKey } from '@/server/redis/client';

const SIGNED_ATTACHMENT_URL_TTL_SECONDS = 60 * 60 * 24 * 365 * 10; // 10 years
const SIGNED_ATTACHMENT_CACHE_TTL_MS = 15 * 60 * 1000;

const inMemorySignedUrlCache = new Map<string, { url: string; expiresAt: number }>();

type StorageCreateSignedUrlResponse = {
    data: { signedUrl?: string } | null;
    error: { message?: string } | null;
};

type StorageClientWithSignedUrl = {
    storage: {
        from: (bucket: string) => {
            createSignedUrl: (path: string, expiresIn: number) => Promise<StorageCreateSignedUrlResponse>;
        };
    };
};

function getCacheKey(bucket: string, path: string) {
    return redisKey('signed-url', bucket, path);
}

function getCachedFromMemory(cacheKey: string) {
    const cached = inMemorySignedUrlCache.get(cacheKey);
    if (!cached) return null;
    if (cached.expiresAt <= Date.now()) {
        inMemorySignedUrlCache.delete(cacheKey);
        return null;
    }
    return cached.url;
}

function setCachedInMemory(cacheKey: string, url: string) {
    inMemorySignedUrlCache.set(cacheKey, {
        url,
        expiresAt: Date.now() + SIGNED_ATTACHMENT_CACHE_TTL_MS,
    });
}

export async function createSignedAttachmentUrl(
    supabase: StorageClientWithSignedUrl,
    bucket: string,
    path: string
) {
    const cacheKey = getCacheKey(bucket, path);
    const inMemory = getCachedFromMemory(cacheKey);
    if (inMemory) return inMemory;

    const redis = getRedisClient();
    if (redis) {
        try {
            const cached = await redis.get<string>(cacheKey);
            if (typeof cached === 'string' && cached.length > 0) {
                setCachedInMemory(cacheKey, cached);
                return cached;
            }
        } catch (error) {
            console.warn(`[attachments] failed to read signed URL cache key=${cacheKey}`, error);
        }
    }

    const { data, error } = await supabase.storage
        .from(bucket)
        .createSignedUrl(path, SIGNED_ATTACHMENT_URL_TTL_SECONDS);

    if (error || !data?.signedUrl) {
        return null;
    }

    setCachedInMemory(cacheKey, data.signedUrl);
    if (redis) {
        try {
            await redis.set(cacheKey, data.signedUrl, { px: SIGNED_ATTACHMENT_CACHE_TTL_MS });
        } catch (cacheError) {
            console.warn(`[attachments] failed to write signed URL cache key=${cacheKey}`, cacheError);
        }
    }

    return data.signedUrl;
}
