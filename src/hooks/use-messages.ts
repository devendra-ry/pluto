'use client';

import { useState, useEffect, useCallback } from 'react';
import { createClient } from '@/utils/supabase/client';
import { type Attachment } from '@/lib/types';
import { cleanupThreadAttachments } from '@/lib/uploads';

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

function sortMessagesByCreatedAt(messages: Message[]) {
    return [...messages].sort((a, b) => {
        const byCreatedAt = a.created_at.localeCompare(b.created_at);
        if (byCreatedAt !== 0) return byCreatedAt;
        return a.id.localeCompare(b.id);
    });
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
        attachments: Array.isArray(record.attachments) ? record.attachments as Attachment[] : [],
        reasoning: typeof record.reasoning === 'string' ? record.reasoning : undefined,
        model_id: typeof record.model_id === 'string' ? record.model_id : undefined,
        created_at: record.created_at,
    };
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
    return (data ?? []) as Message[];
}

// Get all messages for a thread
export function useMessages(threadId: string | null) {
    const [messages, setMessages] = useState<Message[] | null>(() => (threadId ? null : []));
    const [supabase] = useState(() => createClient());
    const refreshMessages = useCallback(async () => {
        if (!threadId) return;

        const { data, error } = await supabase
            .from('messages')
            .select(MESSAGE_SELECT_COLUMNS)
            .eq('thread_id', threadId)
            .order('created_at', { ascending: true })
            .order('id', { ascending: true });

        if (error) {
            return;
        }
        if (data) {
            setMessages(data as Message[]);
        }
    }, [threadId, supabase]);

    useEffect(() => {
        if (!threadId) {
            return;
        }

        let isActive = true;

        const fetchMessages = async () => {
            const { data, error } = await supabase
                .from('messages')
                .select(MESSAGE_SELECT_COLUMNS)
                .eq('thread_id', threadId)
                .order('created_at', { ascending: true })
                .order('id', { ascending: true });

            if (!isActive || error) {
                return;
            }
            if (data) {
                setMessages(data as Message[]);
            }
        };

        void fetchMessages();

        // Realtime subscription
        const channel = supabase
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

        return () => {
            isActive = false;
            supabase.removeChannel(channel);
        };
    }, [threadId, supabase]);

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
            attachments,
            reasoning,
            model_id: modelId,
        })
        .select()
        .single();

    if (error) throw error;
    return data;
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
