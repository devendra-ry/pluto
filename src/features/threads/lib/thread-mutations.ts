import { cleanupThreadAttachments } from '@/features/uploads';
import { sanitizeThreadTitle } from './sanitize-thread-title';
import { triggerThreadRefresh } from './thread-events';
import { mapThreadRowToThread } from './thread-model';
import type { Thread } from '@/shared/contracts/thread';
import type { ReasoningEffort } from '@/shared/core/types';
import { createClient } from '@/utils/supabase/client';

export async function cleanupEmptyThreads(excludeId?: string) {
    const supabase = createClient();
    const { data, error } = await supabase.rpc('cleanup_empty_new_chat_threads', {
        exclude_thread_id: excludeId,
    });
    if (error) {
        throw new Error(`Cleanup failed (${error.message}). Apply the Supabase migrations and retry.`);
    }
    return typeof data === 'number' ? data : 0;
}

export async function createThread(
    model: string,
    reasoningEffort?: ReasoningEffort,
    systemPrompt?: string | null
): Promise<Thread> {
    const supabase = createClient();
    const { data: { user }, error: authError } = await supabase.auth.getUser();
    if (authError) throw authError;
    if (!user) throw new Error('You must be signed in to create a chat.');

    const { data, error } = await supabase
        .from('threads')
        .insert({
            title: 'New Chat',
            model,
            reasoning_effort: reasoningEffort,
            system_prompt: systemPrompt?.trim() || null,
            user_id: user.id,
        })
        .select()
        .single();
    if (error) throw error;

    try {
        await cleanupEmptyThreads(data.id);
    } catch (cleanupError) {
        console.error('[threads] Failed to cleanup empty threads after create:', cleanupError);
    }
    triggerThreadRefresh();
    return mapThreadRowToThread(data);
}

async function updateThreadFields(id: string, fields: Record<string, string | boolean | null>) {
    const supabase = createClient();
    const { error } = await supabase
        .from('threads')
        .update({ ...fields, updated_at: new Date().toISOString() })
        .eq('id', id);
    if (error) throw error;
    triggerThreadRefresh();
}

export async function updateThreadTitle(id: string, title: string) {
    await updateThreadFields(id, { title: sanitizeThreadTitle(title) });
}

export async function updateThreadTitleIfNewChat(id: string, title: string): Promise<boolean> {
    const supabase = createClient();
    const { data, error } = await supabase
        .from('threads')
        .update({ title: sanitizeThreadTitle(title), updated_at: new Date().toISOString() })
        .eq('id', id)
        .eq('title', 'New Chat')
        .select('id');
    if (error) throw error;
    const updated = Array.isArray(data) && data.length > 0;
    if (updated) triggerThreadRefresh();
    return updated;
}

export async function updateThreadModel(id: string, model: string) {
    await updateThreadFields(id, { model });
}

export async function updateReasoningEffort(id: string, effort: ReasoningEffort) {
    await updateThreadFields(id, { reasoning_effort: effort });
}

export async function updateThreadSystemPrompt(id: string, systemPrompt: string | null) {
    await updateThreadFields(id, { system_prompt: systemPrompt?.trim() || null });
}

export async function toggleThreadPin(id: string, isPinned: boolean) {
    await updateThreadFields(id, { is_pinned: isPinned });
}

export async function touchThread(id: string) {
    await updateThreadFields(id, {});
}

export async function deleteThread(id: string) {
    const supabase = createClient();
    await cleanupThreadAttachments(id);
    const { error } = await supabase.from('threads').delete().eq('id', id);
    if (error) throw error;
    try {
        await cleanupEmptyThreads();
    } catch (cleanupError) {
        console.error('[threads] Failed to cleanup empty threads after delete:', cleanupError);
    }
    triggerThreadRefresh();
}
