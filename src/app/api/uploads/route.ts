import { createClient } from '@/utils/supabase/server';
import {
    MAX_ATTACHMENT_BYTES,
    isSupportedAttachmentMimeType,
} from '@/lib/attachments';
import { buildAttachmentUrl, getAttachmentsBucketName, jsonResponse } from '@/lib/attachment-route-utils';
import { assertThreadOwnership } from '@/lib/thread-ownership';
import { type Attachment } from '@/lib/types';
import { ApiRequestError, assertValidPostOrigin, requireUser, toJsonErrorResponse } from '@/utils/api-security';

export const runtime = 'nodejs';

function sanitizeFileName(fileName: string) {
    return fileName
        .replace(/[^\w.\-]+/g, '_')
        .replace(/_+/g, '_')
        .slice(0, 120);
}

function toContentDispositionFallbackFilename(fileName: string) {
    const sanitized = fileName
        .replace(/[\r\n"]/g, '')
        .replace(/[^ -~]+/g, '_')
        .trim();
    return sanitized || 'attachment';
}

function encodeRfc5987Value(value: string) {
    return encodeURIComponent(value).replace(/['()*]/g, (char) =>
        `%${char.charCodeAt(0).toString(16).toUpperCase()}`
    );
}

function uniquePaths(paths: string[]) {
    return Array.from(new Set(paths.filter((path) => typeof path === 'string' && path.length > 0)));
}

function mapStorageErrorStatus(message: string) {
    const normalized = message.toLowerCase();
    if (normalized.includes('not found')) return 404;
    if (normalized.includes('forbidden') || normalized.includes('denied') || normalized.includes('unauthorized')) return 403;
    if (normalized.includes('invalid') || normalized.includes('bad request')) return 400;
    return 500;
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
            const message = error.message || 'Failed to list thread attachments';
            throw new ApiRequestError(mapStorageErrorStatus(message), message);
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
            const message = error.message || 'Failed to delete attachments';
            throw new ApiRequestError(mapStorageErrorStatus(message), message);
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

    const bucket = getAttachmentsBucketName();
    const contentType = (req.headers.get('content-type') || '').toLowerCase();

    const validateUpload = (mimeType: string, size: number) => {
        if (!isSupportedAttachmentMimeType(mimeType)) {
            return jsonResponse({
                error: 'Unsupported file type. Allowed: PNG, JPG, WEBP, GIF, PDF, TXT',
            }, 400);
        }
        if (!Number.isFinite(size) || !Number.isInteger(size)) {
            return jsonResponse({ error: 'Invalid file size' }, 400);
        }
        if (size <= 0) {
            return jsonResponse({ error: 'File is empty' }, 400);
        }
        if (size > MAX_ATTACHMENT_BYTES) {
            return jsonResponse({
                error: `File is too large. Maximum ${Math.floor(MAX_ATTACHMENT_BYTES / (1024 * 1024))}MB`,
            }, 400);
        }
        return null;
    };

    if (contentType.includes('application/json')) {
        const body = await req.json().catch(() => null);
        if (!body || typeof body !== 'object') {
            return jsonResponse({ error: 'Invalid JSON body' }, 400);
        }

        const record = body as Record<string, unknown>;
        const threadId = typeof record.threadId === 'string' ? record.threadId.trim() : '';
        const fileName = typeof record.fileName === 'string' ? record.fileName : '';
        const mimeType = typeof record.mimeType === 'string' && record.mimeType
            ? record.mimeType
            : 'application/octet-stream';
        const size = typeof record.size === 'number' ? record.size : Number.NaN;

        if (!threadId) {
            return jsonResponse({ error: 'threadId is required' }, 400);
        }
        if (!fileName.trim()) {
            return jsonResponse({ error: 'fileName is required' }, 400);
        }

        const validationError = validateUpload(mimeType, size);
        if (validationError) {
            return validationError;
        }

        try {
            await assertThreadOwnership(
                supabase,
                threadId,
                user.id,
                () => new ApiRequestError(403, 'Thread not found or access denied')
            );

            const attachmentId = crypto.randomUUID();
            const sanitizedName = sanitizeFileName(fileName || 'upload');
            const objectPath = `${user.id}/${threadId}/${Date.now()}-${attachmentId}-${sanitizedName}`;
            const { data: signedUpload, error: signedUploadError } = await supabase.storage
                .from(bucket)
                .createSignedUploadUrl(objectPath, { upsert: false });

            if (signedUploadError || !signedUpload?.signedUrl) {
                return jsonResponse({ error: signedUploadError?.message || 'Failed to initialize upload' }, 500);
            }

            const attachment: Attachment = {
                id: attachmentId,
                name: fileName || sanitizedName,
                mimeType,
                size,
                path: objectPath,
                url: buildAttachmentUrl(threadId, objectPath),
            };

            return jsonResponse({
                upload: {
                    signedUrl: signedUpload.signedUrl,
                    path: signedUpload.path,
                },
                attachment,
            });
        } catch (error) {
            const response = toJsonErrorResponse(error);
            if (response) {
                return response;
            }
            const message = error instanceof Error ? error.message : 'Upload failed';
            return jsonResponse({ error: message }, 500);
        }
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

    const mimeType = file.type || 'application/octet-stream';
    const validationError = validateUpload(mimeType, file.size);
    if (validationError) {
        return validationError;
    }

    try {
        await assertThreadOwnership(
            supabase,
            threadId,
            user.id,
            () => new ApiRequestError(403, 'Thread not found or access denied')
        );

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
        const response = toJsonErrorResponse(error);
        if (response) {
            return response;
        }
        const message = error instanceof Error ? error.message : 'Upload failed';
        return jsonResponse({ error: message }, 500);
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
        await assertThreadOwnership(
            supabase,
            threadId,
            user.id,
            () => new ApiRequestError(403, 'Thread not found or access denied')
        );
        const bucket = getAttachmentsBucketName();
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
        const response = toJsonErrorResponse(error);
        if (response) {
            return response;
        }
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
        await assertThreadOwnership(
            supabase,
            threadId,
            user.id,
            () => new ApiRequestError(403, 'Thread not found or access denied')
        );
        if (!path.startsWith(`${user.id}/${threadId}/`)) {
            return new Response('Forbidden', { status: 403 });
        }

        const bucket = getAttachmentsBucketName();
        const { data, error } = await supabase.storage.from(bucket).download(path);
        if (error || !data) {
            return new Response('Not found', { status: 404 });
        }

        const contentType = data.type || 'application/octet-stream';
        const filename = path.split('/').pop() || 'attachment';
        const fallbackFilename = toContentDispositionFallbackFilename(filename);
        const encodedFilename = encodeRfc5987Value(filename);

        return new Response(data, {
            status: 200,
            headers: {
                'Content-Type': contentType,
                'Cache-Control': 'private, max-age=3600',
                'Content-Disposition': `inline; filename="${fallbackFilename}"; filename*=UTF-8''${encodedFilename}`,
            },
        });
    } catch (error) {
        const response = toJsonErrorResponse(error);
        if (response) {
            return response;
        }
        const message = error instanceof Error ? error.message : 'Forbidden';
        return new Response(message, { status: 403 });
    }
}
