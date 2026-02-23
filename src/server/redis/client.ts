import 'server-only';

import { Redis } from '@upstash/redis';

const DEFAULT_KEY_PREFIX = 'pluto';

let redisClient: Redis | null | undefined;

function normalizeKeyPart(value: string) {
    return value.trim().replace(/^:+|:+$/g, '');
}

function resolveKeyPrefix() {
    const configured = process.env.REDIS_KEY_PREFIX;
    if (!configured) return DEFAULT_KEY_PREFIX;

    const normalized = normalizeKeyPart(configured);
    return normalized || DEFAULT_KEY_PREFIX;
}

const KEY_PREFIX = resolveKeyPrefix();

export function redisKey(...parts: Array<string | number | null | undefined>) {
    const normalizedParts = parts
        .filter((part): part is string | number => part !== null && part !== undefined)
        .map((part) => normalizeKeyPart(String(part)))
        .filter((part) => part.length > 0);

    return [KEY_PREFIX, ...normalizedParts].join(':');
}

export function getRedisClient(): Redis | null {
    if (redisClient !== undefined) {
        return redisClient;
    }

    const url = process.env.UPSTASH_REDIS_REST_URL?.trim();
    const token = process.env.UPSTASH_REDIS_REST_TOKEN?.trim();
    if (!url || !token) {
        redisClient = null;
        return redisClient;
    }

    try {
        redisClient = new Redis({ url, token });
    } catch (error) {
        console.warn('[redis] failed to initialize Upstash client', error);
        redisClient = null;
    }

    return redisClient;
}
