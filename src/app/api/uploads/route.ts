import { createClient } from '@/utils/supabase/server';
import {
    DEFAULT_ATTACHMENTS_BUCKET,
    MAX_ATTACHMENT_BYTES,
    isSupportedAttachmentMimeType,
} from '@/lib/attachments';
import { type Attachment } from '@/lib/types';
import { assertValidPostOrigin, requireUser, toJsonErrorResponse } from '@/utils/api-security';

export const runtime = 'nodejs';

function getBucketName() {
    return process.env.SUPABASE_ATTACHMENTS_BUCKET
        || process.env.NEXT_PUBLIC_SUPABASE_ATTACHMENTS_BUCKET
        || DEFAULT_ATTACHMENTS_BUCKET;
}

function sanitizeFileName(fileName: string) {
    return fileName
        .replace(/[^\w.\-]+/g, '_')
        .replace(/_+/g, '_')
        .slice(0, 120);
}

async function assertThreadOwnership(
    supabase: ReturnType<typeof createClient>,
    threadId: string,
    userId: string
) {
    const { data, error } = await supabase
        .from('threads')
        .select('id')
        .eq('id', threadId)
        .eq('user_id', userId)
        .single();

    if (error || !data) {
        throw new Error('Thread not found or access denied');
    }
}

function buildAttachmentUrl(threadId: string, path: string) {
    const query = new URLSearchParams({
        threadId,
        path,
    });
    return `/api/uploads?${query.toString()}`;
}

function jsonResponse(payload: Record<string, unknown>, status: number = 200) {
    return new Response(JSON.stringify(payload), {
        status,
        headers: { 'Content-Type': 'application/json' },
    });
}

function uniquePaths(paths: string[]) {
    return Array.from(new Set(paths.filter((path) => typeof path === 'string' && path.length > 0)));
}

async function listThreadAttachmentPaths(
    supabase: ReturnType<typeof createClient>,
    bucket: string,
    prefix: string
) {
    const allPaths: string[] = [];
    const pageSize = 100;
    let offset = 0;

    while (true) {
        const { data, error } = await supabase.storage.from(bucket).list(prefix, {
            limit: pageSize,
            offset,
            sortBy: { column: 'name', order: 'asc' },
        });

        if (error) {
            throw new Error(error.message || 'Failed to list thread attachments');
        }

        if (!data || data.length === 0) {
            break;
        }

        for (const item of data) {
            if (!item?.name || item.name.includes('/')) {
                continue;
            }
            allPaths.push(`${prefix}/${item.name}`);
        }

        if (data.length < pageSize) {
            break;
        }
        offset += data.length;
    }

    return allPaths;
}

async function removePathsInChunks(
    supabase: ReturnType<typeof createClient>,
    bucket: string,
    paths: string[]
) {
    const chunkSize = 100;
    for (let i = 0; i < paths.length; i += chunkSize) {
        const batch = paths.slice(i, i + chunkSize);
        if (batch.length === 0) continue;
        const { error } = await supabase.storage.from(bucket).remove(batch);
        if (error) {
            throw new Error(error.message || 'Failed to delete attachments');
        }
    }
}

export async function POST(req: Request) {
    let supabase: ReturnType<typeof createClient>;
    let user: Awaited<ReturnType<typeof requireUser>>['user'];
    try {
        assertValidPostOrigin(req);
        const auth = await requireUser();
        supabase = auth.supabase;
        user = auth.user;
    } catch (error) {
        const response = toJsonErrorResponse(error);
        if (response) {
            return response;
        }
        return jsonResponse({ error: 'Internal server error' }, 500);
    }

    const formData = await req.formData();
    const threadId = formData.get('threadId');
    const file = formData.get('file');

    if (typeof threadId !== 'string' || !threadId) {
        return jsonResponse({ error: 'threadId is required' }, 400);
    }
    if (!(file instanceof File)) {
        return jsonResponse({ error: 'file is required' }, 400);
    }

    const bucket = getBucketName();
    const mimeType = file.type || 'application/octet-stream';

    if (!isSupportedAttachmentMimeType(mimeType)) {
        return jsonResponse({
            error: 'Unsupported file type. Allowed: PNG, JPG, WEBP, GIF, PDF, TXT',
        }, 400);
    }
    if (file.size <= 0) {
        return jsonResponse({ error: 'File is empty' }, 400);
    }
    if (file.size > MAX_ATTACHMENT_BYTES) {
        return jsonResponse({
            error: `File is too large. Maximum ${Math.floor(MAX_ATTACHMENT_BYTES / (1024 * 1024))}MB`,
        }, 400);
    }

    try {
        await assertThreadOwnership(supabase, threadId, user.id);

        const attachmentId = crypto.randomUUID();
        const sanitizedName = sanitizeFileName(file.name || 'upload');
        const objectPath = `${user.id}/${threadId}/${Date.now()}-${attachmentId}-${sanitizedName}`;
        const arrayBuffer = await file.arrayBuffer();

        const { error: uploadError } = await supabase.storage
            .from(bucket)
            .upload(objectPath, arrayBuffer, {
                contentType: mimeType,
                upsert: false,
                cacheControl: '3600',
            });

        if (uploadError) {
            return jsonResponse({ error: uploadError.message || 'Upload failed' }, 500);
        }

        const attachment: Attachment = {
            id: attachmentId,
            name: file.name || sanitizedName,
            mimeType,
            size: file.size,
            path: objectPath,
            url: buildAttachmentUrl(threadId, objectPath),
        };

        return jsonResponse({ attachment });
    } catch (error) {
        const message = error instanceof Error ? error.message : 'Upload failed';
        return jsonResponse({ error: message }, 403);
    }
}

export async function DELETE(req: Request) {
    let supabase: ReturnType<typeof createClient>;
    let user: Awaited<ReturnType<typeof requireUser>>['user'];
    try {
        assertValidPostOrigin(req);
        const auth = await requireUser();
        supabase = auth.supabase;
        user = auth.user;
    } catch (error) {
        const response = toJsonErrorResponse(error);
        if (response) {
            return response;
        }
        return jsonResponse({ error: 'Internal server error' }, 500);
    }

    const body = await req.json().catch(() => null);
    if (!body || typeof body !== 'object') {
        return jsonResponse({ error: 'Invalid JSON body' }, 400);
    }

    const record = body as Record<string, unknown>;
    const threadId = typeof record.threadId === 'string' ? record.threadId.trim() : '';
    if (!threadId) {
        return jsonResponse({ error: 'threadId is required' }, 400);
    }

    const rawPaths = Array.isArray(record.paths)
        ? record.paths.filter((path): path is string => typeof path === 'string' && path.length > 0)
        : [];

    try {
        await assertThreadOwnership(supabase, threadId, user.id);
        const bucket = getBucketName();
        const threadPrefix = `${user.id}/${threadId}`;

        const explicitPaths = uniquePaths(rawPaths);
        for (const path of explicitPaths) {
            if (!path.startsWith(`${threadPrefix}/`)) {
                return jsonResponse({ error: 'Invalid attachment path' }, 400);
            }
        }

        const pathsToDelete = explicitPaths.length > 0
            ? explicitPaths
            : await listThreadAttachmentPaths(supabase, bucket, threadPrefix);

        if (pathsToDelete.length === 0) {
            return jsonResponse({ removed: 0 });
        }

        await removePathsInChunks(supabase, bucket, pathsToDelete);
        return jsonResponse({ removed: pathsToDelete.length });
    } catch (error) {
        const message = error instanceof Error ? error.message : 'Failed to cleanup attachments';
        return jsonResponse({ error: message }, 500);
    }
}

export async function GET(req: Request) {
    let supabase: ReturnType<typeof createClient>;
    let user: Awaited<ReturnType<typeof requireUser>>['user'];
    try {
        const auth = await requireUser();
        supabase = auth.supabase;
        user = auth.user;
    } catch (error) {
        const response = toJsonErrorResponse(error);
        if (response) {
            return response;
        }
        return new Response('Unauthorized', { status: 401 });
    }

    const url = new URL(req.url);
    const path = url.searchParams.get('path');
    const threadId = url.searchParams.get('threadId');

    if (!path || !threadId) {
        return new Response('Missing path or threadId', { status: 400 });
    }

    try {
        await assertThreadOwnership(supabase, threadId, user.id);
        if (!path.startsWith(`${user.id}/${threadId}/`)) {
            return new Response('Forbidden', { status: 403 });
        }

        const bucket = getBucketName();
        const { data, error } = await supabase.storage.from(bucket).download(path);
        if (error || !data) {
            return new Response('Not found', { status: 404 });
        }

        const contentType = data.type || 'application/octet-stream';
        const filename = path.split('/').pop() || 'attachment';

        return new Response(data, {
            status: 200,
            headers: {
                'Content-Type': contentType,
                'Cache-Control': 'private, max-age=3600',
                'Content-Disposition': `inline; filename="${filename}"`,
            },
        });
    } catch {
        return new Response('Forbidden', { status: 403 });
    }
}
