'use client';

import { useState, useEffect, useCallback, useRef } from 'react';
import { createClient } from '@/utils/supabase/client';
import { type Attachment } from '@/lib/types';
import { cleanupThreadAttachments } from '@/lib/uploads';
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
}

const MESSAGE_SELECT_COLUMNS = 'id,thread_id,role,content,attachments,reasoning,model_id,created_at';
const MESSAGES_PAGE_SIZE = 80;
type MessageRow = Database['public']['Tables']['messages']['Row'];

export type RefreshMessagesResult =
    | { ok: true }
    | { ok: false; error: string };

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
        typeof record.content !== 'string' ||
        typeof record.created_at !== 'string'
    ) {
        return null;
    }

    return {
        id: record.id,
        thread_id: record.thread_id,
        role: record.role,
        content: record.content,
        attachments: attachmentsFromUnknown(record.attachments),
        reasoning: typeof record.reasoning === 'string' ? record.reasoning : undefined,
        model_id: typeof record.model_id === 'string' ? record.model_id : undefined,
        created_at: record.created_at,
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

function attachmentPathsFromUnknown(value: unknown) {
    if (!Array.isArray(value)) return [] as string[];
    const paths: string[] = [];
    for (const item of value) {
        if (!item || typeof item !== 'object') continue;
        const record = item as Record<string, unknown>;
        if (typeof record.path === 'string' && record.path.length > 0) {
            paths.push(record.path);
        }
    }
    return paths;
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
    };
}

// Fetch canonical message history for a thread
export async function getThreadMessages(threadId: string): Promise<Message[]> {
    const supabase = createClient();
    const { data, error } = await supabase
        .from('messages')
        .select(MESSAGE_SELECT_COLUMNS)
        .eq('thread_id', threadId)
        .order('created_at', { ascending: true })
        .order('id', { ascending: true });

    if (error) throw error;
    return (data ?? []).map(mapMessageRowToMessage);
}

// Get all messages for a thread
export function useMessages(threadId: string | null) {
    const [messages, setMessages] = useState<Message[] | null>(() => (threadId ? null : []));
    const [supabase] = useState(() => createClient());
    const backfillRunRef = useRef(0);

    const fetchMessagesPage = useCallback(async (targetThreadId: string, offset: number) => {
        return await supabase
            .from('messages')
            .select(MESSAGE_SELECT_COLUMNS)
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
                setMessages((prevMessages) => mergeMessagesSorted(prevMessages ?? [], ascending));

                if (descending.length < MESSAGES_PAGE_SIZE) {
                    return;
                }
                offset += MESSAGES_PAGE_SIZE;
            }
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
        setMessages(ascending);

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
            setMessages(ascending);

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

                    setMessages((prev) => {
                        if (!prev) {
                            return [nextMessage];
                        }

                        const existingIndex = prev.findIndex((message) => message.id === nextMessage.id);
                        if (existingIndex === -1) {
                            return sortMessagesByCreatedAt([...prev, nextMessage]);
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

// Delete a message
export async function deleteMessage(id: string) {
    const supabase = createClient();
    const { error } = await supabase.from('messages').delete().eq('id', id);
    if (error) throw error;
}

// Delete multiple messages by IDs
export async function deleteMessagesByIds(ids: string[]) {
    if (ids.length === 0) return;
    const supabase = createClient();
    const { data: messagesToDelete, error: fetchError } = await supabase
        .from('messages')
        .select('thread_id,attachments')
        .in('id', ids);
    if (fetchError) throw fetchError;

    const pathsByThread = new Map<string, Set<string>>();
    for (const message of messagesToDelete ?? []) {
        const threadId = typeof message.thread_id === 'string' ? message.thread_id : '';
        if (!threadId) continue;
        const paths = attachmentPathsFromUnknown(message.attachments);
        if (paths.length === 0) continue;
        const existing = pathsByThread.get(threadId) ?? new Set<string>();
        for (const path of paths) {
            existing.add(path);
        }
        pathsByThread.set(threadId, existing);
    }

    for (const [threadId, pathSet] of pathsByThread.entries()) {
        const paths = Array.from(pathSet);
        if (paths.length > 0) {
            await cleanupThreadAttachments(threadId, paths);
        }
    }

    const { error } = await supabase.from('messages').delete().in('id', ids);
    if (error) throw error;
}

// Clear all messages in a thread
export async function clearThreadMessages(threadId: string) {
    const supabase = createClient();
    const { data: messagesToDelete, error: fetchError } = await supabase
        .from('messages')
        .select('attachments')
        .eq('thread_id', threadId);
    if (fetchError) throw fetchError;

    const paths = (messagesToDelete ?? []).flatMap((message) => attachmentPathsFromUnknown(message.attachments));
    if (paths.length > 0) {
        await cleanupThreadAttachments(threadId, paths);
    }

    const { error } = await supabase.from('messages').delete().eq('thread_id', threadId);
    if (error) throw error;
}
