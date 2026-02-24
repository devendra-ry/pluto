import 'server-only';

import { getRedisClient, redisKey } from '@/server/redis/client';

function readPositiveInt(value: string | undefined, fallback: number) {
    const parsed = Number.parseInt(value ?? '', 10);
    if (!Number.isFinite(parsed) || parsed <= 0) return fallback;
    return parsed;
}

const CHAT_STREAM_CACHE_TTL_SECONDS = readPositiveInt(
    process.env.CHAT_STREAM_CACHE_TTL_MS,
    15 * 60 * 1000
) / 1000;
const CHAT_STREAM_MAX_EVENTS = readPositiveInt(process.env.CHAT_STREAM_MAX_EVENTS, 12000);
const CHAT_STREAM_LOCK_TTL_MS = readPositiveInt(process.env.CHAT_STREAM_LOCK_TTL_MS, 5 * 60 * 1000);

function streamKey(userId: string, streamId: string) {
    return redisKey('chat-stream', userId, streamId);
}

function streamLockKey(userId: string, streamId: string) {
    return redisKey('chat-stream-lock', userId, streamId);
}

function normalizeStreamId(raw: string | null | undefined) {
    const trimmed = (raw ?? '').trim();
    if (!trimmed) return null;
    if (trimmed.length > 200) return null;
    return trimmed;
}

export function readChatStreamId(req: Request) {
    return normalizeStreamId(req.headers.get('x-idempotency-key'));
}

export function readChatResumeOffset(req: Request) {
    const raw = req.headers.get('x-chat-resume-offset');
    if (!raw) return 0;
    const parsed = Number.parseInt(raw, 10);
    if (!Number.isFinite(parsed) || parsed <= 0) return 0;
    return parsed;
}

// ---------------------------------------------------------------------------
// Redis Stream-backed event storage
// ---------------------------------------------------------------------------

/**
 * Append a single SSE event to the Redis Stream for this chat stream.
 * Uses XADD with approximate MAXLEN trimming to cap memory usage.
 * Callers should fire-and-forget (await is optional but recommended for backpressure).
 */
export async function appendChatStreamEvent(userId: string, streamId: string, event: string) {
    const redis = getRedisClient();
    if (!redis) return;

    const key = streamKey(userId, streamId);
    try {
        await redis.xadd(key, '*', { e: event }, {
            trim: { type: 'MAXLEN', threshold: CHAT_STREAM_MAX_EVENTS, comparison: '~' },
        });
    } catch (error) {
        console.warn(`[chat-stream-cache] XADD failed key=${key}`, error);
    }
}

/**
 * Set a TTL on the stream key so it auto-expires after the configured duration.
 * Call once after the stream is complete (or on error) — Redis Streams don't
 * have a built-in TTL, so we apply EXPIRE explicitly.
 */
export async function expireChatStream(userId: string, streamId: string) {
    const redis = getRedisClient();
    if (!redis) return;

    const key = streamKey(userId, streamId);
    try {
        await redis.expire(key, Math.ceil(CHAT_STREAM_CACHE_TTL_SECONDS));
    } catch (error) {
        console.warn(`[chat-stream-cache] EXPIRE failed key=${key}`, error);
    }
}

interface CachedStreamResult {
    events: string[];
}

/**
 * Read cached SSE events from the Redis Stream. Returns null if the stream
 * doesn't exist or has no entries.
 */
export async function getCachedChatStreamEvents(
    userId: string,
    streamId: string
): Promise<CachedStreamResult | null> {
    const redis = getRedisClient();
    if (!redis) return null;

    const key = streamKey(userId, streamId);
    try {
        // XLEN first — fast O(1) existence check before XRANGE.
        const length = await redis.xlen(key);
        if (!length || length === 0) return null;

        // Read all entries. XRANGE with '-' to '+' fetches the full stream.
        // Upstash returns Record<streamId, Record<field, value>>.
        const entries = await redis.xrange(key, '-', '+');
        if (!entries || typeof entries !== 'object') return null;

        const events: string[] = [];
        // entries is a Record<string, Record<string, unknown>> keyed by stream IDs.
        for (const streamEntryId of Object.keys(entries)) {
            const fields = (entries as Record<string, Record<string, unknown>>)[streamEntryId];
            if (fields && typeof fields === 'object') {
                const eventValue = fields.e;
                if (typeof eventValue === 'string') {
                    events.push(eventValue);
                }
            }
        }

        if (events.length === 0) return null;
        return { events };
    } catch (error) {
        console.warn(`[chat-stream-cache] XRANGE failed key=${key}`, error);
        return null;
    }
}

// ---------------------------------------------------------------------------
// Distributed lock (unchanged — uses simple SET NX)
// ---------------------------------------------------------------------------

export async function reserveChatStreamLock(userId: string, streamId: string) {
    const redis = getRedisClient();
    if (!redis) return 'local-no-redis';

    const key = streamLockKey(userId, streamId);
    const token = crypto.randomUUID();
    try {
        const reserved = await redis.set(key, token, { nx: true, px: CHAT_STREAM_LOCK_TTL_MS });
        if (reserved !== 'OK') return null;
        return token;
    } catch (error) {
        console.warn(`[chat-stream-cache] failed to reserve lock key=${key}`, error);
        return null;
    }
}

export async function releaseChatStreamLock(userId: string, streamId: string, token: string | null) {
    if (!token) return;
    const redis = getRedisClient();
    if (!redis) return;

    const key = streamLockKey(userId, streamId);
    try {
        const current = await redis.get<string>(key);
        if (current === token) {
            await redis.del(key);
        }
    } catch (error) {
        console.warn(`[chat-stream-cache] failed to release lock key=${key}`, error);
    }
}

// ---------------------------------------------------------------------------
// SSE replay response builder
// ---------------------------------------------------------------------------

/** Module-level singleton — TextEncoder is stateless. */
const sharedEncoder = new TextEncoder();

export function buildSseReplayResponse(events: string[], offset: number = 0) {
    const startIndex = Math.max(0, Math.min(offset, events.length));
    const replayEvents = events.slice(startIndex);

    const stream = new ReadableStream({
        start(controller) {
            for (const event of replayEvents) {
                controller.enqueue(sharedEncoder.encode(`data: ${event}\n\n`));
            }
            if (replayEvents.length === 0 || replayEvents[replayEvents.length - 1] !== '[DONE]') {
                controller.enqueue(sharedEncoder.encode('data: [DONE]\n\n'));
            }
            controller.close();
        }
    });

    return new Response(stream, {
        headers: {
            'Content-Type': 'text/event-stream',
            'Cache-Control': 'no-cache',
            'Connection': 'keep-alive',
        },
    });
}
