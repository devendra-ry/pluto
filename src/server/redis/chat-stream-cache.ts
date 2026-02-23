import 'server-only';

import { randomUUID } from 'node:crypto';

import { getRedisClient, redisKey } from '@/server/redis/client';

interface CachedChatStream {
    events: string[];
    createdAt: number;
}

function readPositiveInt(value: string | undefined, fallback: number) {
    const parsed = Number.parseInt(value ?? '', 10);
    if (!Number.isFinite(parsed) || parsed <= 0) return fallback;
    return parsed;
}

const CHAT_STREAM_CACHE_TTL_MS = readPositiveInt(process.env.CHAT_STREAM_CACHE_TTL_MS, 15 * 60 * 1000);
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

function parseCached(value: unknown): CachedChatStream | null {
    if (typeof value !== 'string') return null;
    try {
        const parsed = JSON.parse(value) as Record<string, unknown>;
        if (!parsed || typeof parsed !== 'object') return null;
        if (!Array.isArray(parsed.events)) return null;
        const events = parsed.events.filter((event): event is string => typeof event === 'string');
        if (events.length === 0) return null;
        return {
            events,
            createdAt: typeof parsed.createdAt === 'number' ? parsed.createdAt : Date.now(),
        };
    } catch {
        return null;
    }
}

export async function getCachedChatStreamEvents(userId: string, streamId: string) {
    const redis = getRedisClient();
    if (!redis) return null;

    try {
        const raw = await redis.get<unknown>(streamKey(userId, streamId));
        if (!raw) return null;
        return parseCached(raw);
    } catch (error) {
        console.warn(`[chat-stream-cache] failed to read key user=${userId} stream=${streamId}`, error);
        return null;
    }
}

export async function setCachedChatStreamEvents(userId: string, streamId: string, events: string[]) {
    const redis = getRedisClient();
    if (!redis) return;
    if (events.length === 0) return;

    const payload: CachedChatStream = {
        events: events.slice(-CHAT_STREAM_MAX_EVENTS),
        createdAt: Date.now(),
    };

    try {
        await redis.set(streamKey(userId, streamId), JSON.stringify(payload), {
            px: CHAT_STREAM_CACHE_TTL_MS,
        });
    } catch (error) {
        console.warn(`[chat-stream-cache] failed to write key user=${userId} stream=${streamId}`, error);
    }
}

export async function reserveChatStreamLock(userId: string, streamId: string) {
    const redis = getRedisClient();
    if (!redis) return 'local-no-redis';

    const key = streamLockKey(userId, streamId);
    const token = randomUUID();
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

export function buildSseReplayResponse(events: string[], offset: number = 0) {
    const encoder = new TextEncoder();
    const startIndex = Math.max(0, Math.min(offset, events.length));
    const replayEvents = events.slice(startIndex);

    const stream = new ReadableStream({
        start(controller) {
            for (const event of replayEvents) {
                controller.enqueue(encoder.encode(`data: ${event}\n\n`));
            }
            if (replayEvents.length === 0 || replayEvents[replayEvents.length - 1] !== '[DONE]') {
                controller.enqueue(encoder.encode('data: [DONE]\n\n'));
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
