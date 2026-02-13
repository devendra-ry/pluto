import { createClient } from '@/utils/supabase/server';
import { cookies } from 'next/headers';
import {
    DEFAULT_ATTACHMENTS_BUCKET,
    MAX_ATTACHMENT_BYTES,
    isSupportedAttachmentMimeType,
} from '@/lib/attachments';
import { type Attachment } from '@/lib/types';

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

export async function POST(req: Request) {
    const cookieStore = await cookies();
    const supabase = createClient(cookieStore);
    const { data: { user } } = await supabase.auth.getUser();

    if (!user) {
        return jsonResponse({ error: 'Unauthorized' }, 401);
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

export async function GET(req: Request) {
    const cookieStore = await cookies();
    const supabase = createClient(cookieStore);
    const { data: { user } } = await supabase.auth.getUser();

    if (!user) {
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
