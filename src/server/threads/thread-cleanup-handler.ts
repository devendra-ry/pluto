import 'server-only';

import { getAttachmentsBucketName, jsonResponse } from '@/server/attachments/attachment-route-utils';
import {
    assertJsonRequest, assertValidPostOrigin, parseJsonObjectRequest,
    requireUser, toJsonErrorResponse,
} from '@/server/http/api-security';
import { processThreadCleanup } from './process-thread-cleanup';
import { responseWithRequestId, withResultSpan, withSpan } from '@/server/observability/tracing';

export async function POST(req: Request) {
    const requestId = crypto.randomUUID();
    return responseWithRequestId(await withSpan('threads.cleanup', { 'pluto.request_id': requestId }, () => handleCleanup(req)), requestId);
}

async function handleCleanup(req: Request) {
    try {
        assertValidPostOrigin(req);
        assertJsonRequest(req);
        await parseJsonObjectRequest(req);
        const { supabase, user } = await requireUser();
        const { data: claims, error } = await withResultSpan('db.cleanup.claim', {}, () => supabase.rpc('claim_thread_cleanup_jobs', {
            p_limit: 5, p_lease_seconds: 180,
        }));
        if (error) return jsonResponse({ error: 'Cleanup is temporarily unavailable' }, 503);
        let completed = 0;
        let failed = 0;
        for (const claim of claims ?? []) {
            if (await processThreadCleanup(supabase, getAttachmentsBucketName(), user.id, claim)) completed++;
            else failed++;
        }
        return jsonResponse({ claimed: claims?.length ?? 0, completed, failed });
    } catch (error) {
        return toJsonErrorResponse(error) ?? jsonResponse({ error: 'Cleanup is temporarily unavailable' }, 503);
    }
}
