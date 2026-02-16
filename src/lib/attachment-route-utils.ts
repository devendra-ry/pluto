import { DEFAULT_ATTACHMENTS_BUCKET } from '@/lib/attachments';

export function getAttachmentsBucketName() {
    return process.env.SUPABASE_ATTACHMENTS_BUCKET
        || process.env.NEXT_PUBLIC_SUPABASE_ATTACHMENTS_BUCKET
        || DEFAULT_ATTACHMENTS_BUCKET;
}

export function buildAttachmentUrl(threadId: string, path: string) {
    const query = new URLSearchParams({ threadId, path });
    return `/api/uploads?${query.toString()}`;
}

export function jsonResponse(payload: Record<string, unknown>, status: number = 200) {
    return new Response(JSON.stringify(payload), {
        status,
        headers: { 'Content-Type': 'application/json' },
    });
}
