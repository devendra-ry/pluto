import 'server-only';

import { createClient } from '@/server/supabase/server';

type ServerSupabaseClient = ReturnType<typeof createClient>;

export async function assertThreadOwnership(
    supabase: ServerSupabaseClient,
    threadId: string,
    userId: string,
    createDeniedError?: () => Error
) {
    // Always resolve ownership under current RLS. A cached grant can outlive
    // deletion or an account change and authorize access to a tombstoned thread.
    const { data, error } = await supabase
        .from('threads')
        .select('id')
        .eq('id', threadId)
        .eq('user_id', userId)
        .single();

    if (error || !data) {
        throw createDeniedError?.() ?? new Error('Thread not found or access denied');
    }
}
