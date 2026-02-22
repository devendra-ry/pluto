'use client';

import { useCallback, useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';

import { getMessagesQueryKey, getQueryClient, MESSAGE_QUERY_KEY_PREFIX } from '@/lib/query-client';
import { type Attachment } from '@/lib/types';
import { createClient } from '@/utils/supabase/client';
import type { Json } from '@/utils/supabase/database.types';

import {
    type Message,
    MESSAGE_SELECT_COLUMNS,
    mapMessageRowToMessage,
    mergeMessagesSorted,
    removeMessagesById
} from '@/lib/message-helpers';
import { useMessageSubscription } from '@/hooks/use-message-subscription';

// Re-export Message type for backward compatibility
export type { Message };

export type RefreshMessagesResult =
    | { ok: true }
    | { ok: false; error: string };

async function fetchThreadMessagesWithClient(
    supabase: ReturnType<typeof createClient>,
    threadId: string
): Promise<Message[]> {
    const { data, error } = await supabase
        .from('messages')
        .select(MESSAGE_SELECT_COLUMNS)
        .eq('thread_id', threadId)
        .is('deleted_at', null)
        .order('created_at', { ascending: true })
        .order('id', { ascending: true });

    if (error) throw error;
    return (data ?? []).map(mapMessageRowToMessage);
}

function updateCachedThreadMessages(
    threadId: string,
    updater: (previous: Message[]) => Message[]
) {
    const queryClient = getQueryClient();
    queryClient.setQueryData<Message[]>(getMessagesQueryKey(threadId), (previous) => updater(previous ?? []));
}

export function invalidateThreadMessages(threadId: string) {
    const queryClient = getQueryClient();
    void queryClient.invalidateQueries({ queryKey: getMessagesQueryKey(threadId) });
}

function invalidateAllThreadMessages() {
    const queryClient = getQueryClient();
    void queryClient.invalidateQueries({ queryKey: [MESSAGE_QUERY_KEY_PREFIX] });
}

// Fetch canonical message history for a thread
export async function getThreadMessages(threadId: string): Promise<Message[]> {
    const supabase = createClient();
    return fetchThreadMessagesWithClient(supabase, threadId);
}

// Get all messages for a thread
export function useMessages(threadId: string | null) {
    const supabase = useMemo(() => createClient(), []);

    const query = useQuery({
        queryKey: threadId ? getMessagesQueryKey(threadId) : [MESSAGE_QUERY_KEY_PREFIX, '__idle__'],
        enabled: Boolean(threadId),
        queryFn: async () => {
            if (!threadId) return [];
            return fetchThreadMessagesWithClient(supabase, threadId);
        },
    });

    const refreshMessages = useCallback(async (): Promise<RefreshMessagesResult> => {
        if (!threadId) return { ok: true };
        const result = await query.refetch();
        if (result.error) {
            return { ok: false, error: result.error.message || 'Failed to refresh messages' };
        }
        return { ok: true };
    }, [query, threadId]);

    // Use the new subscription hook
    useMessageSubscription(threadId);

    const messages = useMemo(() => {
        if (!threadId) return [] as Message[] | null;
        if (query.data) return query.data;
        if (query.isPending) return null;
        return [];
    }, [query.data, query.isPending, threadId]);

    return {
        messages,
        refreshMessages,
    };
}

// Add a new message to a thread
export async function addMessage(
    threadId: string,
    role: 'user' | 'assistant',
    content: string,
    reasoning?: string,
    modelId?: string,
    attachments: Attachment[] = []
): Promise<Message> {
    const supabase = createClient();
    const { data, error } = await supabase
        .from('messages')
        .insert({
            thread_id: threadId,
            role,
            content,
            attachments: attachments as Json,
            reasoning,
            model_id: modelId,
        })
        .select()
        .single();

    if (error) throw error;
    const nextMessage = mapMessageRowToMessage(data);
    updateCachedThreadMessages(threadId, (previous) => mergeMessagesSorted(previous, [nextMessage]));
    return nextMessage;
}

// Update message content (for streaming updates)
export async function updateMessage(id: string, content: string, reasoning?: string, threadId?: string) {
    const supabase = createClient();
    const { error } = await supabase
        .from('messages')
        .update({ content, reasoning })
        .eq('id', id);
    if (error) throw error;

    if (threadId) {
        updateCachedThreadMessages(threadId, (previous) => previous.map((message) => (
            message.id === id
                ? { ...message, content, reasoning }
                : message
        )));
        return;
    }
    invalidateAllThreadMessages();
}

interface DeleteMessagesOptions {
    reason?: string;
    anchorMessageId?: string | null;
    threadId?: string;
}

// Soft delete a message
export async function deleteMessage(id: string, reason: string = 'manual_single') {
    await deleteMessagesByIds([id], { reason });
}

// Soft delete multiple messages by IDs and write audit rows server-side.
export async function deleteMessagesByIds(ids: string[], options?: DeleteMessagesOptions) {
    if (ids.length === 0) return;
    const supabase = createClient();
    const { error } = await supabase.rpc('soft_delete_messages', {
        p_message_ids: ids,
        p_reason: options?.reason ?? 'manual',
        p_anchor_message_id: options?.anchorMessageId ?? null,
    });
    if (error) {
        throw new Error(`Soft-delete failed (${error.message}). Run db/message-soft-delete-audit.sql and retry.`);
    }

    if (options?.threadId) {
        const idsToRemove = new Set(ids);
        updateCachedThreadMessages(options.threadId, (previous) => removeMessagesById(previous, idsToRemove));
        return;
    }
    invalidateAllThreadMessages();
}

export async function restoreMessagesByIds(ids: string[], restoreWindowMinutes: number = 1440) {
    if (ids.length === 0) return 0;
    const supabase = createClient();
    const { data, error } = await supabase.rpc('restore_soft_deleted_messages', {
        p_message_ids: ids,
        p_restore_window_minutes: restoreWindowMinutes,
    });
    if (error) throw error;
    invalidateAllThreadMessages();
    return typeof data === 'number' ? data : 0;
}

// Soft delete all visible messages in a thread.
export async function clearThreadMessages(threadId: string) {
    const supabase = createClient();
    const { data, error } = await supabase
        .from('messages')
        .select('id')
        .eq('thread_id', threadId)
        .is('deleted_at', null);

    if (error) throw error;

    const ids = (data ?? [])
        .map((row) => (typeof row.id === 'string' ? row.id : null))
        .filter((value): value is string => value !== null);
    await deleteMessagesByIds(ids, { reason: 'clear_thread', threadId });
}
