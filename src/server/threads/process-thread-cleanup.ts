import 'server-only';

import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database } from '@/shared/lib/supabase/database.types';
import { withResultSpan } from '@/server/observability/tracing';

export interface CleanupClaim {
    job_id: string;
    thread_id: string;
    claim_token: string;
    paths: string[];
}

/** Storage removal must finish before the fenced database deletion commits. */
export async function processThreadCleanup(
    supabase: SupabaseClient<Database>, bucket: string, userId: string, claim: CleanupClaim,
): Promise<boolean> {
    try {
        const paths = [...new Set(claim.paths)];
        if (paths.some(path => !path.startsWith(`${userId}/`) || path.split('/').length !== 3)) {
            throw new Error('Invalid cleanup object scope');
        }
        for (let offset = 0; offset < paths.length; offset += 100) {
            const batch = paths.slice(offset, offset + 100);
            const { data, error } = await withResultSpan('storage.cleanup', { 'storage.object_count': batch.length },
                () => supabase.storage.from(bucket).remove(batch));
            if (error) throw new Error('Storage cleanup failed');
            // Storage may silently skip paths that RLS denies. Do not commit
            // a thread deletion based only on an HTTP success status.
            const removed = new Set((data ?? []).map(object => object.name));
            if (batch.some(path => !removed.has(path))) {
                throw new Error('Storage cleanup incomplete');
            }
        }
        const { data, error } = await withResultSpan('db.cleanup.finish', {}, () => supabase.rpc('finish_thread_cleanup_job', {
            p_job_id: claim.job_id, p_claim_token: claim.claim_token,
        }));
        if (error || data !== true) throw new Error('Cleanup completion failed');
        return true;
    } catch {
        // Persist a generic diagnostic; database/storage errors can contain
        // object names and credentials. A failed job remains retryable.
        await supabase.rpc('fail_thread_cleanup_job', {
            p_job_id: claim.job_id, p_claim_token: claim.claim_token,
            p_error: 'Thread attachment cleanup did not complete',
        });
        return false;
    }
}
