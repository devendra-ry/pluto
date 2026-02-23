import 'server-only';

import { randomUUID } from 'node:crypto';
import type { Redis } from '@upstash/redis';

import { getRedisClient, redisKey } from '@/server/redis/client';

const DEFAULT_IDEMPOTENCY_TTL_MS = 15 * 60 * 1000;
const DEFAULT_IDEMPOTENCY_LOCK_TTL_MS = 2 * 60 * 1000;
const DEFAULT_MAX_IDEMPOTENT_BODY_BYTES = 512 * 1024;

interface CachedIdempotencyResponse {
    status: number;
    headers: Record<string, string>;
    body: string;
    createdAt: number;
}

interface IdempotencySession {
    redis: Redis;
    responseKey: string;
    lockKey: string;
    lockToken: string;
    ttlMs: number;
    maxBodyBytes: number;
}

interface ExecuteIdempotentRequestOptions {
    req: Request;
    scope: string;
    userId: string;
    inProgressStatus?: number;
    inProgressMessage?: string;
}

function readPositiveInt(value: string | undefined, fallback: number) {
    const parsed = Number.parseInt(value ?? '', 10);
    if (!Number.isFinite(parsed) || parsed <= 0) return fallback;
    return parsed;
}

function getIdempotencyTtlMs() {
    return readPositiveInt(process.env.IDEMPOTENCY_CACHE_TTL_MS, DEFAULT_IDEMPOTENCY_TTL_MS);
}

function getIdempotencyLockTtlMs() {
    return readPositiveInt(process.env.IDEMPOTENCY_LOCK_TTL_MS, DEFAULT_IDEMPOTENCY_LOCK_TTL_MS);
}

function getMaxCachedBodyBytes() {
    return readPositiveInt(process.env.IDEMPOTENCY_MAX_BODY_BYTES, DEFAULT_MAX_IDEMPOTENT_BODY_BYTES);
}

function normalizeIdempotencyKey(raw: string | null | undefined) {
    const trimmed = (raw ?? '').trim();
    if (!trimmed) return null;
    if (trimmed.length > 200) return null;
    return trimmed;
}

function parseCachedResponse(raw: unknown): CachedIdempotencyResponse | null {
    if (typeof raw !== 'string') return null;

    try {
        const parsed = JSON.parse(raw) as Record<string, unknown>;
        if (!parsed || typeof parsed !== 'object') return null;
        if (typeof parsed.status !== 'number') return null;
        if (typeof parsed.body !== 'string') return null;
        if (!parsed.headers || typeof parsed.headers !== 'object') return null;

        const headers: Record<string, string> = {};
        for (const [key, value] of Object.entries(parsed.headers as Record<string, unknown>)) {
            if (typeof value === 'string') headers[key] = value;
        }

        return {
            status: parsed.status,
            body: parsed.body,
            headers,
            createdAt: typeof parsed.createdAt === 'number' ? parsed.createdAt : Date.now(),
        };
    } catch {
        return null;
    }
}

function toResponse(cached: CachedIdempotencyResponse) {
    return new Response(cached.body, {
        status: cached.status,
        headers: cached.headers,
    });
}

async function loadCachedResponse(responseKey: string) {
    const redis = getRedisClient();
    if (!redis) return null;

    try {
        const raw = await redis.get<unknown>(responseKey);
        if (!raw) return null;
        return parseCachedResponse(raw);
    } catch (error) {
        console.warn(`[idempotency] failed to read cached response key=${responseKey}`, error);
        return null;
    }
}

async function reserveSession(scope: string, userId: string, idempotencyKey: string): Promise<IdempotencySession | null> {
    const redis = getRedisClient();
    if (!redis) return null;

    const responseKey = redisKey('idempotency', 'response', scope, userId, idempotencyKey);
    const lockKey = redisKey('idempotency', 'lock', scope, userId, idempotencyKey);
    const lockToken = randomUUID();
    const lockTtlMs = getIdempotencyLockTtlMs();

    const existing = await loadCachedResponse(responseKey);
    if (existing) {
        return null;
    }

    try {
        const reserved = await redis.set(lockKey, lockToken, {
            nx: true,
            px: lockTtlMs,
        });
        if (reserved !== 'OK') return null;

        return {
            redis,
            responseKey,
            lockKey,
            lockToken,
            ttlMs: getIdempotencyTtlMs(),
            maxBodyBytes: getMaxCachedBodyBytes(),
        };
    } catch (error) {
        console.warn(`[idempotency] failed to reserve lock key=${lockKey}`, error);
        return null;
    }
}

async function releaseSessionLock(session: IdempotencySession) {
    try {
        const current = await session.redis.get<string>(session.lockKey);
        if (current === session.lockToken) {
            await session.redis.del(session.lockKey);
        }
    } catch (error) {
        console.warn(`[idempotency] failed to release lock key=${session.lockKey}`, error);
    }
}

async function storeResponse(session: IdempotencySession, response: Response) {
    try {
        const clone = response.clone();
        const body = await clone.text();
        const bodyBytes = Buffer.byteLength(body, 'utf8');
        if (bodyBytes > session.maxBodyBytes) {
            return;
        }

        const headers: Record<string, string> = {};
        clone.headers.forEach((value, key) => {
            headers[key] = value;
        });

        const payload: CachedIdempotencyResponse = {
            status: clone.status,
            headers,
            body,
            createdAt: Date.now(),
        };

        await session.redis.set(session.responseKey, JSON.stringify(payload), {
            px: session.ttlMs,
        });
    } catch (error) {
        console.warn(`[idempotency] failed to cache response key=${session.responseKey}`, error);
    }
}

export function readIdempotencyKey(req: Request) {
    return normalizeIdempotencyKey(req.headers.get('x-idempotency-key'));
}

export async function executeIdempotentRequest(
    options: ExecuteIdempotentRequestOptions,
    handler: () => Promise<Response>
) {
    const idempotencyKey = readIdempotencyKey(options.req);
    if (!idempotencyKey) {
        return handler();
    }
    if (!getRedisClient()) {
        return handler();
    }

    const responseKey = redisKey('idempotency', 'response', options.scope, options.userId, idempotencyKey);
    const cached = await loadCachedResponse(responseKey);
    if (cached) {
        return toResponse(cached);
    }

    const session = await reserveSession(options.scope, options.userId, idempotencyKey);
    if (!session) {
        const afterReserveCached = await loadCachedResponse(responseKey);
        if (afterReserveCached) {
            return toResponse(afterReserveCached);
        }

        return new Response(
            JSON.stringify({
                error: options.inProgressMessage ?? 'An equivalent request is already being processed.',
            }),
            {
                status: options.inProgressStatus ?? 409,
                headers: { 'Content-Type': 'application/json' },
            }
        );
    }

    try {
        const response = await handler();
        await storeResponse(session, response);
        return response;
    } finally {
        await releaseSessionLock(session);
    }
}
