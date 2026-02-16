'use client';

import { useState, useEffect, useCallback, useRef } from 'react';
import { createClient } from '@/utils/supabase/client';
import { type Attachment } from '@/lib/types';
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
const MESSAGES_PAGE_SIZE = 80;
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

function areAttachmentsEqual(left: Attachment[] | undefined, right: Attachment[] | undefined) {
    const a = left ?? [];
    const b = right ?? [];
    if (a.length !== b.length) return false;
    for (let i = 0; i < a.length; i++) {
        if (
            a[i].id !== b[i].id
            || a[i].name !== b[i].name
            || a[i].mimeType !== b[i].mimeType
            || a[i].size !== b[i].size
            || a[i].path !== b[i].path
            || a[i].url !== b[i].url
        ) {
            return false;
        }
    }
    return true;
}

function areMessagesEqual(a: Message | undefined, b: Message | undefined) {
    if (!a || !b) return a === b;
    return (
        a.id === b.id
        && a.thread_id === b.thread_id
        && a.role === b.role
        && a.content === b.content
        && (a.reasoning ?? undefined) === (b.reasoning ?? undefined)
        && (a.model_id ?? undefined) === (b.model_id ?? undefined)
        && a.created_at === b.created_at
        && areAttachmentsEqual(a.attachments, b.attachments)
    );
}

function areMessageArraysEqual(prev: Message[] | null, next: Message[]) {
    if (!prev) return next.length === 0;
    if (prev.length !== next.length) return false;
    for (let i = 0; i < prev.length; i++) {
        if (!areMessagesEqual(prev[i], next[i])) {
            return false;
        }
    }
    return true;
}

function mergeMessagesSorted(existing: Message[], incoming: Message[]) {
    if (incoming.length === 0) return existing;

    const byId = new Map(existing.map((message) => [message.id, message]));
    for (const message of incoming) {
        // Preserve locally updated/realtime message versions when already present.
        if (!byId.has(message.id)) {
            byId.set(message.id, message);
        }
    }

    return sortMessagesByCreatedAt(Array.from(byId.values()));
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

// Fetch canonical message history for a thread
export async function getThreadMessages(threadId: string): Promise<Message[]> {
    const supabase = createClient();
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

// Get all messages for a thread
export function useMessages(threadId: string | null) {
    const [messages, setMessages] = useState<Message[] | null>(() => (threadId ? null : []));
    const [supabase] = useState(() => createClient());
    const backfillRunRef = useRef(0);

    const fetchMessagesPage = useCallback(async (targetThreadId: string, offset: number) => {
        const result = await supabase
            .from('messages')
            .select(MESSAGE_SELECT_COLUMNS)
            .eq('thread_id', targetThreadId)
            .is('deleted_at', null)
            .order('created_at', { ascending: false })
            .order('id', { ascending: false })
            .range(offset, offset + MESSAGES_PAGE_SIZE - 1);
        if (!result.error || !isMissingDeletedAtColumnError(result.error)) {
            return result;
        }

        return await supabase
            .from('messages')
            .select('id,thread_id,role,content,attachments,reasoning,model_id,created_at')
            .eq('thread_id', targetThreadId)
            .order('created_at', { ascending: false })
            .order('id', { ascending: false })
            .range(offset, offset + MESSAGES_PAGE_SIZE - 1);
    }, [supabase]);

    const startBackfillMessages = useCallback((
        targetThreadId: string,
        initialOffset: number,
        shouldContinue: () => boolean
    ) => {
        const runId = ++backfillRunRef.current;
        const shouldRun = () => shouldContinue() && backfillRunRef.current === runId;

        void (async () => {
            let offset = initialOffset;
            const bufferedMessages: Message[] = [];
            while (shouldRun()) {
                const { data, error } = await fetchMessagesPage(targetThreadId, offset);
                if (!shouldRun()) return;

                if (error) {
                    console.error('[useMessages] Error fetching messages page:', error);
                    return;
                }

                const descending = (data ?? []).map(mapMessageRowToMessage);
                if (descending.length === 0) {
                    return;
                }

                const ascending = [...descending].reverse();
                bufferedMessages.push(...ascending);

                if (descending.length < MESSAGES_PAGE_SIZE) {
                    break;
                }
                offset += MESSAGES_PAGE_SIZE;
            }

            if (!shouldRun() || bufferedMessages.length === 0) {
                return;
            }

            setMessages((prevMessages) => {
                const merged = mergeMessagesSorted(prevMessages ?? [], bufferedMessages);
                return areMessageArraysEqual(prevMessages, merged) ? prevMessages : merged;
            });
        })();
    }, [fetchMessagesPage]);

    const refreshMessages = useCallback(async (): Promise<RefreshMessagesResult> => {
        if (!threadId) return { ok: true };
        backfillRunRef.current += 1;

        const { data, error } = await fetchMessagesPage(threadId, 0);

        if (error) {
            console.error('[useMessages] Error refreshing messages:', error);
            return { ok: false, error: error.message || 'Failed to refresh messages' };
        }

        const descending = (data ?? []).map(mapMessageRowToMessage);
        const ascending = [...descending].reverse();
        setMessages((prev) => (areMessageArraysEqual(prev, ascending) ? prev : ascending));

        if (descending.length === MESSAGES_PAGE_SIZE) {
            startBackfillMessages(threadId, MESSAGES_PAGE_SIZE, () => true);
        }

        return { ok: true };
    }, [threadId, fetchMessagesPage, startBackfillMessages]);

    useEffect(() => {
        if (!threadId) {
            return;
        }

        let isActive = true;
        let channel: ReturnType<ReturnType<typeof createClient>['channel']> | null = null;
        backfillRunRef.current += 1;

        const fetchMessages = async () => {
            const { data, error } = await fetchMessagesPage(threadId, 0);

            if (!isActive) {
                return;
            }
            if (error) {
                console.error('[useMessages] Error fetching messages:', error);
                return;
            }
            const descending = (data ?? []).map(mapMessageRowToMessage);
            const ascending = [...descending].reverse();
            setMessages((prev) => (areMessageArraysEqual(prev, ascending) ? prev : ascending));

            if (descending.length === MESSAGES_PAGE_SIZE) {
                startBackfillMessages(threadId, MESSAGES_PAGE_SIZE, () => isActive);
            }
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
            if (typeof document !== 'undefined' && document.visibilityState === 'hidden') {
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

                    if (payload.eventType === 'DELETE') {
                        const deletedId = typeof payload.old?.id === 'string' ? payload.old.id : null;
                        if (!deletedId) return;
                        setMessages((prev) => prev ? prev.filter((message) => message.id !== deletedId) : prev);
                        return;
                    }

                    const nextMessage = toMessage(payload.new);
                    if (!nextMessage || nextMessage.thread_id !== threadId) {
                        return;
                    }
                    if (nextMessage.deleted_at) {
                        setMessages((prev) => prev ? prev.filter((message) => message.id !== nextMessage.id) : prev);
                        return;
                    }

                    setMessages((prev) => {
                        if (!prev) {
                            return [nextMessage];
                        }

                        const existingIndex = prev.findIndex((message) => message.id === nextMessage.id);
                        if (existingIndex === -1) {
                            const merged = sortMessagesByCreatedAt([...prev, nextMessage]);
                            return areMessageArraysEqual(prev, merged) ? prev : merged;
                        }

                        if (areMessagesEqual(prev[existingIndex], nextMessage)) {
                            return prev;
                        }

                        const updated = [...prev];
                        updated[existingIndex] = nextMessage;
                        return updated;
                    });
                })
                .subscribe();
        };

        void (async () => {
            // Only null-out if switching to a DIFFERENT thread so we don't flash stale
            // content from another thread. When re-opening the same thread, keep existing
            // messages visible while the fresh fetch completes.
            setMessages((prev) => {
                if (prev && prev.length > 0 && prev[0].thread_id !== threadId) {
                    return null;
                }
                return prev;
            });
            await fetchMessages();
            if (!isActive) return;
            subscribeRealtime();
        })();

        const handleVisibilityChange = () => {
            if (!isActive) return;
            if (document.visibilityState === 'hidden') {
                unsubscribeRealtime();
                return;
            }
            void (async () => {
                await fetchMessages();
                if (!isActive) return;
                subscribeRealtime();
            })();
        };
        if (typeof document !== 'undefined') {
            document.addEventListener('visibilitychange', handleVisibilityChange);
        }

        return () => {
            isActive = false;
            backfillRunRef.current += 1;
            if (typeof document !== 'undefined') {
                document.removeEventListener('visibilitychange', handleVisibilityChange);
            }
            unsubscribeRealtime();
        };
    }, [threadId, supabase, fetchMessagesPage, startBackfillMessages]);

    return {
        messages: threadId ? messages : [],
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
    return mapMessageRowToMessage(data);
}

// Update message content (for streaming updates)
export async function updateMessage(id: string, content: string, reasoning?: string) {
    const supabase = createClient();
    const { error } = await supabase
        .from('messages')
        .update({ content, reasoning })
        .eq('id', id);
    if (error) throw error;
}

interface DeleteMessagesOptions {
    reason?: string;
    anchorMessageId?: string | null;
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
}

export async function restoreMessagesByIds(ids: string[], restoreWindowMinutes: number = 1440) {
    if (ids.length === 0) return 0;
    const supabase = createClient();
    const { data, error } = await supabase.rpc('restore_soft_deleted_messages', {
        p_message_ids: ids,
        p_restore_window_minutes: restoreWindowMinutes,
    });
    if (error) throw error;
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
    await deleteMessagesByIds(ids, { reason: 'clear_thread' });
}
