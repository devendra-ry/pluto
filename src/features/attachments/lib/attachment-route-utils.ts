import 'server-only';

import { DEFAULT_ATTACHMENTS_BUCKET } from './attachments';
import { buildAttachmentProxyUrl } from './attachment-url';
import { readFirstOptionalServerEnv } from '@/shared/config/server';

export function getAttachmentsBucketName() {
    return readFirstOptionalServerEnv(
        'SUPABASE_ATTACHMENTS_BUCKET',
        'NEXT_PUBLIC_SUPABASE_ATTACHMENTS_BUCKET'
    )
        || DEFAULT_ATTACHMENTS_BUCKET;
}

export function buildAttachmentUrl(threadId: string, path: string) {
    return buildAttachmentProxyUrl(threadId, path);
}

export function jsonResponse(payload: Record<string, unknown>, status: number = 200) {
    return new Response(JSON.stringify(payload), {
        status,
        headers: { 'Content-Type': 'application/json' },
    });
}
