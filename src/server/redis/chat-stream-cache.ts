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
// Each stream entry now packs multiple events, so fewer entries are needed.
const CHAT_STREAM_MAX_ENTRIES = readPositiveInt(process.env.CHAT_STREAM_MAX_ENTRIES, 500);
const CHAT_STREAM_LOCK_TTL_MS = readPositiveInt(process.env.CHAT_STREAM_LOCK_TTL_MS, 5 * 60 * 1000);

/**
 * Record separator used to pack multiple SSE events into a single Redis
 * Stream entry. U+001E is a non-printable ASCII control character that
 * will never appear in SSE JSON payloads.
 */
const EVENT_PACK_SEPARATOR = '\x1e';

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
// Redis Stream-backed event storage (legacy single-event helpers)
// ---------------------------------------------------------------------------

/**
 * Append a single SSE event to the Redis Stream for this chat stream.
 * @deprecated Use `createChatStreamWriter()` for batched writes instead.
 */
export async function appendChatStreamEvent(userId: string, streamId: string, event: string) {
    const redis = getRedisClient();
    if (!redis) return;

    const key = streamKey(userId, streamId);
    try {
        await redis.xadd(key, '*', { e: event }, {
            trim: { type: 'MAXLEN', threshold: CHAT_STREAM_MAX_ENTRIES, comparison: '~' },
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

// ---------------------------------------------------------------------------
// Batched event writer — packs multiple events into single XADD entries
// ---------------------------------------------------------------------------

const BATCH_FLUSH_INTERVAL_MS = 1000;
const BATCH_FLUSH_THRESHOLD = 100;

/**
 * Buffers SSE events in memory and flushes them to a Redis Stream as
 * **packed entries** — all buffered events are joined with a record
 * separator (U+001E) and written in a single XADD per flush.
 *
 * This reduces Redis commands from ~500/response to ~10/response:
 * - 1 XADD per flush (instead of 1 per event)
 * - 1 flush per second (instead of per 500ms)
 * - 1 EXPIRE on close
 *
 * Usage:
 *   const writer = createChatStreamWriter(userId, streamId);
 *   writer.push(event);   // synchronous, non-throwing
 *   await writer.close(); // final flush + EXPIRE
 */
export class ChatStreamEventWriter {
    private buffer: string[] = [];
    private timer: ReturnType<typeof setInterval> | null = null;
    private closed = false;
    private flushPromise: Promise<void> | null = null;

    constructor(
        private readonly key: string,
        private readonly redis: NonNullable<ReturnType<typeof getRedisClient>>,
    ) {
        this.timer = setInterval(() => {
            void this.flush();
        }, BATCH_FLUSH_INTERVAL_MS);
    }

    /** Queue an event for batched writing. Synchronous, never throws. */
    push(event: string): void {
        if (this.closed) return;
        this.buffer.push(event);
        if (this.buffer.length >= BATCH_FLUSH_THRESHOLD) {
            void this.flush();
        }
    }

    /** Flush remaining events, set EXPIRE, and stop the timer. */
    async close(): Promise<void> {
        if (this.closed) return;
        this.closed = true;
        if (this.timer !== null) {
            clearInterval(this.timer);
            this.timer = null;
        }
        // Wait for any in-flight flush to finish before the final one.
        if (this.flushPromise) {
            await this.flushPromise;
        }
        await this.flushWithExpire();
    }

    private async flush(): Promise<void> {
        if (this.buffer.length === 0) return;
        const batch = this.buffer;
        this.buffer = [];
        this.flushPromise = this.executePipeline(batch, false);
        try {
            await this.flushPromise;
        } finally {
            this.flushPromise = null;
        }
    }

    private async flushWithExpire(): Promise<void> {
        const batch = this.buffer;
        this.buffer = [];
        await this.executePipeline(batch, true);
    }

    private async executePipeline(batch: string[], expire: boolean): Promise<void> {
        if (batch.length === 0 && !expire) return;

        try {
            const pipeline = this.redis.pipeline();

            if (batch.length > 0) {
                // Pack all events into a single XADD entry.
                const packed = batch.join(EVENT_PACK_SEPARATOR);
                pipeline.xadd(this.key, '*', { e: packed }, {
                    trim: { type: 'MAXLEN', threshold: CHAT_STREAM_MAX_ENTRIES, comparison: '~' },
                });
            }

            if (expire) {
                pipeline.expire(this.key, Math.ceil(CHAT_STREAM_CACHE_TTL_SECONDS));
            }

            await pipeline.exec();
        } catch (error) {
            console.warn(`[chat-stream-cache] pipeline flush failed key=${this.key} events=${batch.length}`, error);
        }
    }
}

/**
 * Create a batched event writer for the given chat stream.
 * Returns null if Redis is not configured.
 */
export function createChatStreamWriter(userId: string, streamId: string): ChatStreamEventWriter | null {
    const redis = getRedisClient();
    if (!redis) return null;
    return new ChatStreamEventWriter(streamKey(userId, streamId), redis);
}

interface CachedStreamResult {
    events: string[];
}

/**
 * Read cached SSE events from the Redis Stream. Returns null if the stream
 * doesn't exist or has no entries. Handles both packed entries (separated
 * by U+001E) and legacy single-event entries.
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
                    // Unpack: split on record separator. If the entry is a
                    // legacy single event (no separator), split returns [event].
                    const unpacked = eventValue.split(EVENT_PACK_SEPARATOR);
                    for (const ev of unpacked) {
                        if (ev) events.push(ev);
                    }
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

export function buildSseReplayResponse(events: string[], byteOffset: number = 0) {
    // Each cached event was originally sent as `data: ${event}\n\n`.
    // Reconstruct cumulative byte lengths to find the first un-acked event.
    let accumulated = 0;
    let startIndex = 0;

    if (byteOffset > 0) {
        for (let i = 0; i < events.length; i++) {
            const eventBytes = sharedEncoder.encode(`data: ${events[i]}\n\n`).byteLength;
            if (accumulated + eventBytes <= byteOffset) {
                accumulated += eventBytes;
                startIndex = i + 1;
            } else {
                break;
            }
        }
    }

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
