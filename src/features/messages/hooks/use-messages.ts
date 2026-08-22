'use client';

import { useCallback, useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';

import { getMessagesQueryKey, getQueryClient, MESSAGE_QUERY_KEY_PREFIX } from '@/shared/lib/query-client';
import { type Attachment, type ChatResponseStats } from '@/shared/core/types';
import { createClient } from '@/shared/lib/supabase/client';
import type { Json } from '@/shared/lib/supabase/database.types';

import {
    type Message,
    mapMessageRowToMessage,
    mergeMessagesSorted,
    removeMessagesById
} from '../lib/message-helpers';
import { loadThreadMessages } from '../lib/load-thread-messages';
import { useMessageSubscription } from './use-message-subscription';

export type RefreshMessagesResult =
    | { ok: true }
    | { ok: false; error: string };

function updateCachedThreadMessages(
    threadId: string,
    updater: (previous: Message[]) => Message[]
) {
    const queryClient = getQueryClient();
    queryClient.setQueryData<Message[]>(getMessagesQueryKey(threadId), (previous) => updater(previous ?? []));
}

function invalidateAllThreadMessages() {
    const queryClient = getQueryClient();
    void queryClient.invalidateQueries({ queryKey: [MESSAGE_QUERY_KEY_PREFIX] });
}

// Fetch canonical message history for a thread
export async function getThreadMessages(threadId: string): Promise<Message[]> {
    const supabase = createClient();
    return loadThreadMessages(supabase, threadId);
}

// Get all messages for a thread
export function useMessages(threadId: string | null) {
    const supabase = useMemo(() => createClient(), []);

    const query = useQuery({
        queryKey: threadId ? getMessagesQueryKey(threadId) : [MESSAGE_QUERY_KEY_PREFIX, '__idle__'],
        enabled: Boolean(threadId),
        queryFn: async () => {
            if (!threadId) return [];
            return loadThreadMessages(supabase, threadId);
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
    attachments: Attachment[] = [],
    replyStats?: ChatResponseStats,
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
            reply_stats: replyStats ? replyStats as Json : null,
        })
        .select()
        .single();

    if (error) throw error;
    const nextMessage = mapMessageRowToMessage(data);
    updateCachedThreadMessages(threadId, (previous) => mergeMessagesSorted(previous, [nextMessage]));
    return nextMessage;
}

interface DeleteMessagesOptions {
    reason?: string;
    anchorMessageId?: string | null;
    threadId?: string;
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
        throw new Error(`Soft-delete failed (${error.message}). Apply the Supabase migrations and retry.`);
    }

    if (options?.threadId) {
        const idsToRemove = new Set(ids);
        updateCachedThreadMessages(options.threadId, (previous) => removeMessagesById(previous, idsToRemove));
        return;
    }
    invalidateAllThreadMessages();
}

