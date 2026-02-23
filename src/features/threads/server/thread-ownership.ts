import { createClient } from '@/utils/supabase/server';

type ServerSupabaseClient = ReturnType<typeof createClient>;

export async function assertThreadOwnership(
    supabase: ServerSupabaseClient,
    threadId: string,
    userId: string,
    createDeniedError?: () => Error
) {
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