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

// Fetch canonical message history for a thread
export async function getThreadMessages(threadId: string): Promise<Message[]> {
    const supabase = createClient();
    const { data, error } = await supabase
        .from('messages')
        .select('*')
        .eq('thread_id', threadId)
        .order('created_at', { ascending: true });

    if (error) throw error;
    return data ?? [];
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
            const { data } = await supabase
                .from('messages')
                .select('*')
                .eq('thread_id', threadId)
                .order('created_at', { ascending: true });
            if (data && isActive) {
                setMessages(data);
            }
        };

        fetchMessages();

        // Realtime subscription
        const channel = supabase
            .channel(`messages_${threadId}`)
            .on('postgres_changes', {
                event: '*',
                schema: 'public',
                table: 'messages',
                filter: `thread_id=eq.${threadId}`
            }, () => {
                fetchMessages();
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
