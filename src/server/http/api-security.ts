import 'server-only';

import { cookies } from 'next/headers';

import { serverEnv } from '@/shared/config/server';
import { MAX_JSON_REQUEST_BYTES } from '@/shared/validation/request-limits';
import { createClient } from '@/utils/supabase/server';

export class ApiRequestError extends Error {
    status: number;

    constructor(status: number, message: string) {
        super(message);
        this.status = status;
    }
}

function isJsonContentType(contentType: string | null) {
    if (!contentType) return false;
    const lower = contentType.toLowerCase();
    return lower.includes('application/json') || lower.includes('+json');
}

function toOrigin(rawUrl: string | null | undefined) {
    if (!rawUrl) return null;
    try {
        return new URL(rawUrl).origin;
    } catch {
        return null;
    }
}

function getAllowedOrigins(req: Request) {
    const allowedOrigins = new Set<string>();
    const requestOrigin = toOrigin(req.url);
    if (requestOrigin) {
        allowedOrigins.add(requestOrigin);
    }

    const appUrlOrigin = toOrigin(serverEnv.NEXT_PUBLIC_APP_URL);
    if (appUrlOrigin) {
        allowedOrigins.add(appUrlOrigin);
    }

    const internalAppUrlOrigin = toOrigin(serverEnv.APP_URL);
    if (internalAppUrlOrigin) {
        allowedOrigins.add(internalAppUrlOrigin);
    }

    const vercelUrl = serverEnv.VERCEL_URL;
    if (vercelUrl) {
        const vercelOrigin = toOrigin(vercelUrl.startsWith('http') ? vercelUrl : `https://${vercelUrl}`);
        if (vercelOrigin) {
            allowedOrigins.add(vercelOrigin);
        }
    }

    return allowedOrigins;
}

export function assertValidPostOrigin(req: Request) {
    const allowedOrigins = getAllowedOrigins(req);
    const origin = toOrigin(req.headers.get('origin'));
    if (origin) {
        if (!allowedOrigins.has(origin)) {
            throw new ApiRequestError(403, 'Forbidden: invalid request origin');
        }
        return;
    }

    const refererOrigin = toOrigin(req.headers.get('referer'));
    if (!refererOrigin || !allowedOrigins.has(refererOrigin)) {
        throw new ApiRequestError(403, 'Forbidden: missing request origin');
    }
}

export async function requireUser() {
    const cookieStore = await cookies();
    const supabase = createClient(cookieStore);
    const { data, error } = await supabase.auth.getUser();

    if (error || !data.user) {
        throw new ApiRequestError(401, 'Unauthorized');
    }

    return {
        supabase,
        user: data.user,
    };
}

export function assertJsonRequest(req: Request) {
    if (!isJsonContentType(req.headers.get('content-type'))) {
        throw new ApiRequestError(415, 'Content-Type must be application/json');
    }
}

export function assertContentLengthWithinLimit(req: Request, maxBytes: number) {
    const rawContentLength = req.headers.get('content-length');
    if (!rawContentLength) return;

    const contentLength = Number(rawContentLength);
    if (!Number.isSafeInteger(contentLength) || contentLength < 0) {
        throw new ApiRequestError(400, 'Invalid Content-Length header');
    }
    if (contentLength > maxBytes) {
        throw new ApiRequestError(413, 'Request body is too large');
    }
}

export async function parseJsonRequest(req: Request, maxBytes: number = MAX_JSON_REQUEST_BYTES) {
    assertContentLengthWithinLimit(req, maxBytes);
    if (!req.body) {
        throw new ApiRequestError(400, 'Invalid JSON body');
    }

    const reader = req.body.getReader();
    const chunks: Uint8Array[] = [];
    let totalBytes = 0;
    try {
        while (true) {
            const { done, value } = await reader.read();
            if (done) break;
            totalBytes += value.byteLength;
            if (totalBytes > maxBytes) {
                await reader.cancel();
                throw new ApiRequestError(413, 'Request body is too large');
            }
            chunks.push(value);
        }
    } finally {
        reader.releaseLock();
    }

    const bytes = new Uint8Array(totalBytes);
    let offset = 0;
    for (const chunk of chunks) {
        bytes.set(chunk, offset);
        offset += chunk.byteLength;
    }

    try {
        return JSON.parse(new TextDecoder().decode(bytes)) as unknown;
    } catch {
        throw new ApiRequestError(400, 'Invalid JSON body');
    }
}

export async function parseJsonObjectRequest(req: Request, maxBytes: number = MAX_JSON_REQUEST_BYTES) {
    const body = await parseJsonRequest(req, maxBytes);
    if (!body || typeof body !== 'object' || Array.isArray(body)) {
        throw new ApiRequestError(400, 'Invalid JSON body');
    }
    return body as Record<string, unknown>;
}

export function toJsonErrorResponse(error: unknown) {
    if (error instanceof ApiRequestError) {
        return new Response(JSON.stringify({ error: error.message }), {
            status: error.status,
            headers: { 'Content-Type': 'application/json' },
        });
    }
    return null;
}
