'use client';

import { useState, useEffect } from 'react';
import { createClient } from '@/utils/supabase/client';
import { type Attachment } from '@/lib/types';

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

    return threadId ? messages : [];
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
    const { error } = await supabase.from('messages').delete().in('id', ids);
    if (error) throw error;
}

// Clear all messages in a thread
export async function clearThreadMessages(threadId: string) {
    const supabase = createClient();
    const { error } = await supabase.from('messages').delete().eq('thread_id', threadId);
    if (error) throw error;
}
