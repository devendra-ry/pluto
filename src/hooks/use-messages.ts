'use client';

import { useCallback, useEffect, useMemo } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';

import { getMessagesQueryKey, getQueryClient, MESSAGE_QUERY_KEY_PREFIX } from '@/lib/query-client';
import { type Attachment } from '@/lib/types';
import { createClient } from '@/utils/supabase/client';
import type { Database, Json } from '@/utils/supabase/database.types';

export interface Message {
    id: string;
    thread_id: string;
    role: 'user' | 'assistant';
    content: string;
    attachments?: Attachment[];
    reasoning?: string;
    model_id?: string;
    created_at: string;
    deleted_at?: string | null;
}

const MESSAGE_SELECT_COLUMNS = 'id,thread_id,role,content,attachments,reasoning,model_id,created_at,deleted_at';
type MessageRow = Pick<
    Database['public']['Tables']['messages']['Row'],
    'id' | 'thread_id' | 'role' | 'content' | 'attachments' | 'reasoning' | 'model_id' | 'created_at'
> & {
    deleted_at?: string | null;
};

export type RefreshMessagesResult =
    | { ok: true }
    | { ok: false; error: string };

function isMissingDeletedAtColumnError(error: { message?: string; code?: string } | null) {
    if (!error) return false;
    if (error.code === '42703') return true;
    return (error.message ?? '').toLowerCase().includes('deleted_at');
}

function sortMessagesByCreatedAt(messages: Message[]) {
    return [...messages].sort((a, b) => {
        const byCreatedAt = a.created_at.localeCompare(b.created_at);
        if (byCreatedAt !== 0) return byCreatedAt;
        return a.id.localeCompare(b.id);
    });
}

function mergeMessagesSorted(existing: Message[], incoming: Message[]) {
    if (incoming.length === 0) return existing;
    const byId = new Map(existing.map((message) => [message.id, message]));
    for (const message of incoming) {
        byId.set(message.id, message);
    }
    return sortMessagesByCreatedAt(Array.from(byId.values()));
}

function removeMessagesById(existing: Message[], ids: Set<string>) {
    if (ids.size === 0) return existing;
    return existing.filter((message) => !ids.has(message.id));
}

function toMessage(value: unknown): Message | null {
    if (!value || typeof value !== 'object') return null;
    const record = value as Record<string, unknown>;

    if (
        typeof record.id !== 'string' ||
        typeof record.thread_id !== 'string' ||
        (record.role !== 'user' && record.role !== 'assistant') ||
        typeof record.created_at !== 'string'
    ) {
        return null;
    }

    return {
        id: record.id,
        thread_id: record.thread_id,
        role: record.role,
        content: typeof record.content === 'string' ? record.content : '',
        attachments: attachmentsFromUnknown(record.attachments),
        reasoning: typeof record.reasoning === 'string' ? record.reasoning : undefined,
        model_id: typeof record.model_id === 'string' ? record.model_id : undefined,
        created_at: record.created_at,
        deleted_at: typeof record.deleted_at === 'string' ? record.deleted_at : null,
    };
}

function attachmentsFromUnknown(value: unknown): Attachment[] {
    if (!Array.isArray(value)) return [];
    const attachments: Attachment[] = [];
    for (const item of value) {
        if (!item || typeof item !== 'object') continue;
        const record = item as Record<string, unknown>;
        if (
            typeof record.id === 'string' &&
            typeof record.name === 'string' &&
            typeof record.mimeType === 'string' &&
            typeof record.size === 'number' &&
            typeof record.path === 'string' &&
            typeof record.url === 'string'
        ) {
            attachments.push({
                id: record.id,
                name: record.name,
                mimeType: record.mimeType,
                size: record.size,
                path: record.path,
                url: record.url,
            });
        }
    }
    return attachments;
}

function mapMessageRowToMessage(row: MessageRow): Message {
    return {
        id: row.id,
        thread_id: row.thread_id,
        role: row.role === 'assistant' ? 'assistant' : 'user',
        content: row.content ?? '',
        attachments: attachmentsFromUnknown(row.attachments),
        reasoning: row.reasoning ?? undefined,
        model_id: row.model_id ?? undefined,
        created_at: row.created_at,
        deleted_at: row.deleted_at ?? null,
    };
}

async function fetchThreadMessagesWithClient(
    supabase: ReturnType<typeof createClient>,
    threadId: string
): Promise<Message[]> {
    const result = await supabase
        .from('messages')
        .select(MESSAGE_SELECT_COLUMNS)
        .eq('thread_id', threadId)
        .is('deleted_at', null)
        .order('created_at', { ascending: true })
        .order('id', { ascending: true });

    if (result.error && isMissingDeletedAtColumnError(result.error)) {
        const legacyResult = await supabase
            .from('messages')
            .select('id,thread_id,role,content,attachments,reasoning,model_id,created_at')
            .eq('thread_id', threadId)
            .order('created_at', { ascending: true })
            .order('id', { ascending: true });
        if (legacyResult.error) throw legacyResult.error;
        return (legacyResult.data ?? []).map((row) => ({
            ...mapMessageRowToMessage(row as MessageRow),
            deleted_at: null,
        }));
    }

    const { data, error } = result;
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
    const queryClient = useQueryClient();
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

    useEffect(() => {
        if (!threadId) {
            return;
        }

        const queryKey = getMessagesQueryKey(threadId);
        let isActive = true;
        let channel: ReturnType<ReturnType<typeof createClient>['channel']> | null = null;

        const applyRealtimePayload = (payload: {
            eventType: 'INSERT' | 'UPDATE' | 'DELETE';
            new: unknown;
            old: unknown;
        }) => {
            queryClient.setQueryData<Message[]>(queryKey, (previous) => {
                const existing = previous ?? [];

                if (payload.eventType === 'DELETE') {
                    const deletedId =
                        payload.old && typeof payload.old === 'object' && typeof (payload.old as { id?: unknown }).id === 'string'
                            ? (payload.old as { id: string }).id
                            : null;
                    if (!deletedId) return existing;
                    return removeMessagesById(existing, new Set([deletedId]));
                }

                const nextMessage = toMessage(payload.new);
                if (!nextMessage || nextMessage.thread_id !== threadId) {
                    return existing;
                }

                if (nextMessage.deleted_at) {
                    return removeMessagesById(existing, new Set([nextMessage.id]));
                }

                return mergeMessagesSorted(existing, [nextMessage]);
            });
        };

        const unsubscribeRealtime = () => {
            if (channel) {
                supabase.removeChannel(channel);
                channel = null;
            }
        };

        const subscribeRealtime = () => {
            if (!isActive || channel) {
                return;
            }

            channel = supabase
                .channel(`messages_${threadId}`)
                .on('postgres_changes', {
                    event: '*',
                    schema: 'public',
                    table: 'messages',
                    filter: `thread_id=eq.${threadId}`
                }, (payload) => {
                    if (!isActive) return;
                    if (payload.eventType !== 'INSERT' && payload.eventType !== 'UPDATE' && payload.eventType !== 'DELETE') {
                        return;
                    }
                    applyRealtimePayload({
                        eventType: payload.eventType,
                        new: payload.new,
                        old: payload.old,
                    });
                })
                .subscribe();
        };

        subscribeRealtime();

        const handleVisibilityChange = () => {
            if (!isActive) return;
            if (document.visibilityState === 'visible') {
                void queryClient.invalidateQueries({ queryKey });
            }
        };

        if (typeof document !== 'undefined') {
            document.addEventListener('visibilitychange', handleVisibilityChange);
        }

        return () => {
            isActive = false;
            if (typeof document !== 'undefined') {
                document.removeEventListener('visibilitychange', handleVisibilityChange);
            }
            unsubscribeRealtime();
        };
    }, [queryClient, supabase, threadId]);

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
    let { data, error } = await supabase
        .from('messages')
        .select('id')
        .eq('thread_id', threadId)
        .is('deleted_at', null);
    if (error && isMissingDeletedAtColumnError(error)) {
        const legacy = await supabase
            .from('messages')
            .select('id')
            .eq('thread_id', threadId);
        data = legacy.data;
        error = legacy.error;
    }
    if (error) throw error;

    const ids = (data ?? [])
        .map((row) => (typeof row.id === 'string' ? row.id : null))
        .filter((value): value is string => value !== null);
    await deleteMessagesByIds(ids, { reason: 'clear_thread', threadId });
}
