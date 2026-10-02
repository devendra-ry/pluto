'use client';

import { useCallback, useLayoutEffect, useMemo, useRef } from 'react';
import { useInfiniteQuery } from '@tanstack/react-query';

import { getMessagesQueryKey, getQueryClient, MESSAGE_QUERY_KEY_PREFIX } from '@/shared/lib/query-client';
import { type Attachment, type ChatResponseStats } from '@/shared/core/types';
import { createClient } from '@/shared/lib/supabase/client';
import type { Json } from '@/shared/lib/supabase/database.types';

import {
    type Message,
    MESSAGE_SELECT_COLUMNS,
    mapMessageRowToMessage,
    mergeMessagesSorted,
    removeMessagesById
} from '../lib/message-helpers';
import { canonicalMessageAttachments, loadMessagePage, type MessageCursor, type MessagePage } from '../lib/load-thread-messages';
import { flattenMessagePages, updateMessagePages, type MessagePages } from '../lib/message-pages';
import { executeSoftDelete, restoreMessagesForFailedDelete } from '../lib/message-mutations';
import { useMessageSubscription } from './use-message-subscription';

export type RefreshMessagesResult =
    | { ok: true }
    | { ok: false; error: string };

function updateCachedThreadMessages(
    threadId: string,
    updater: (previous: Message[]) => Message[]
) {
    const queryClient = getQueryClient();
    queryClient.setQueryData<MessagePages>(getMessagesQueryKey(threadId), previous => updateMessagePages(previous, updater));
}

function invalidateAllThreadMessages() {
    const queryClient = getQueryClient();
    void queryClient.invalidateQueries({ queryKey: [MESSAGE_QUERY_KEY_PREFIX] });
}

export async function refreshThreadMessage(
    threadId: string,
    messageId: string
): Promise<RefreshMessagesResult> {
    const supabase = createClient();
    const { data, error } = await supabase
        .from('messages')
        .select(MESSAGE_SELECT_COLUMNS)
        .eq('thread_id', threadId)
        .eq('id', messageId)
        .is('deleted_at', null)
        .maybeSingle();

    if (error) {
        return { ok: false, error: error.message || 'Failed to refresh message' };
    }
    if (data) {
        const message = canonicalMessageAttachments(mapMessageRowToMessage(data));
        updateCachedThreadMessages(threadId, (previous) => mergeMessagesSorted(previous, [message]));
    }
    return { ok: true };
}

export async function refreshThreadReply(
    threadId: string,
    userMessageId: string
): Promise<RefreshMessagesResult> {
    const supabase = createClient();
    const { data, error } = await supabase
        .from('messages')
        .select(MESSAGE_SELECT_COLUMNS)
        .eq('thread_id', threadId)
        .eq('reply_to_message_id', userMessageId)
        .is('deleted_at', null)
        .order('created_at', { ascending: false })
        .limit(1)
        .maybeSingle();

    if (error) {
        return { ok: false, error: error.message || 'Failed to refresh response' };
    }
    if (data) {
        const message = canonicalMessageAttachments(mapMessageRowToMessage(data));
        updateCachedThreadMessages(threadId, (previous) => mergeMessagesSorted(previous, [message]));
    }
    return { ok: true };
}

// Load the recent window, then fetch older history on demand.
export function useMessages(threadId: string | null) {
    const supabase = useMemo(() => createClient(), []);
    const activeThreadIdRef = useRef(threadId);
    useLayoutEffect(() => {
        activeThreadIdRef.current = threadId;
        return () => {
            if (activeThreadIdRef.current === threadId) activeThreadIdRef.current = null;
        };
    }, [threadId]);

    const query = useInfiniteQuery<MessagePage, Error, MessagePages, readonly unknown[], MessageCursor | null>({
        queryKey: threadId ? getMessagesQueryKey(threadId) : [MESSAGE_QUERY_KEY_PREFIX, '__idle__'],
        enabled: Boolean(threadId),
        initialPageParam: null as MessageCursor | null,
        getNextPageParam: page => page.olderCursor,
        queryFn: async ({ signal, pageParam }) => {
            if (!threadId) return { messages: [], olderCursor: null };
            return loadMessagePage(supabase, threadId, pageParam, signal);
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
    const syncStatus = useMessageSubscription(threadId);

    const messages = useMemo(() => {
        if (!threadId) return [] as Message[] | null;
        if (query.data) return flattenMessagePages(query.data);
        if (query.isPending) return null;
        return [];
    }, [query.data, query.isPending, threadId]);

    const loadMessagesThroughMessage = useCallback(async (
        messageId: string,
        shouldContinue: () => boolean = () => true,
    ) => {
        if (!threadId) return false;
        const requestedThreadId = threadId;
        const requestedKey = getMessagesQueryKey(requestedThreadId);
        while (shouldContinue() && activeThreadIdRef.current === requestedThreadId) {
            const currentData = getQueryClient().getQueryData<MessagePages>(requestedKey);
            if (flattenMessagePages(currentData).some(message => message.id === messageId)) return true;
            const cursor = currentData?.pages.at(-1)?.olderCursor;
            if (!cursor) return false;

            const result = await query.fetchNextPage({ cancelRefetch: false });
            if (!shouldContinue() || activeThreadIdRef.current !== requestedThreadId) return false;
            if (result.error) throw result.error;
        }
        return false;
    }, [query, threadId]);

    return {
        messages,
        error: query.isFetchNextPageError ? null : query.error,
        isLoading: query.isPending,
        refreshMessages,
        hasOlderMessages: query.hasNextPage,
        isLoadingOlder: query.isFetchingNextPage,
        olderMessagesError: query.isFetchNextPageError ? 'Could not load older messages. Try again.' : null,
        loadOlderMessages: () => query.isFetching ? Promise.resolve() : query.fetchNextPage({ cancelRefetch: false }),
        loadMessagesThroughMessage,
        syncStatus,
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
    const nextMessage = canonicalMessageAttachments(mapMessageRowToMessage(data));
    updateCachedThreadMessages(threadId, (previous) => mergeMessagesSorted(previous, [nextMessage]));
    return nextMessage;
}

export async function editUserMessageAtomically(input: {
    threadId: string;
    messageId: string;
    content: string;
    modelId: string;
    attachments: Attachment[];
}): Promise<{ userMessageId: string; deletedMessageIds: string[] }> {
    const supabase = createClient();
    const attachments = JSON.parse(JSON.stringify(input.attachments)) as Json;
    const { data, error } = await supabase.rpc('edit_user_message', {
        p_thread_id: input.threadId,
        p_message_id: input.messageId,
        p_content: input.content,
        p_model_id: input.modelId,
        p_attachments: attachments,
    });

    if (error) {
        throw new Error(`Message edit failed (${error.message}). Apply the Supabase migrations and retry.`);
    }

    const result = data?.[0];
    if (!result?.user_message_id) {
        throw new Error('The edited message could not be saved. Please try again.');
    }

    const deletedMessageIds = Array.isArray(result.deleted_message_ids)
        ? result.deleted_message_ids.filter((id): id is string => typeof id === 'string')
        : [];
    updateCachedThreadMessages(input.threadId, (previous) => removeMessagesById(previous, new Set(deletedMessageIds)));

    return {
        userMessageId: result.user_message_id,
        deletedMessageIds,
    };
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
    const queryClient = getQueryClient();
    const threadId = options?.threadId;
    const queryKey = threadId ? getMessagesQueryKey(threadId) : null;
    const previousPages = queryKey ? queryClient.getQueryData<MessagePages>(queryKey) : undefined;
    const previousMessages = previousPages ? flattenMessagePages(previousPages) : undefined;
    if (queryKey) {
        const idsToRemove = new Set(ids);
        updateCachedThreadMessages(threadId!, (previous) => removeMessagesById(previous, idsToRemove));
    }

    await executeSoftDelete(
        async () => await supabase.rpc('soft_delete_messages', {
            p_message_ids: ids,
            p_reason: options?.reason ?? 'manual',
            p_anchor_message_id: options?.anchorMessageId ?? null,
        }),
        () => {
            if (queryKey && previousMessages) {
                queryClient.setQueryData<MessagePages>(queryKey, current =>
                    updateMessagePages(current ?? previousPages, messages => restoreMessagesForFailedDelete(messages, previousMessages, ids)),
                );
            } else if (queryKey) {
                queryClient.removeQueries({ queryKey, exact: true });
            }
            if (queryKey) {
                void queryClient.invalidateQueries({ queryKey, exact: true }).catch((invalidateError: unknown) => {
                    console.error('[messages] Failed to refresh after soft-delete failure:', invalidateError);
                });
            }
        },
    );

    if (queryKey) {
        return;
    }
    invalidateAllThreadMessages();
}
