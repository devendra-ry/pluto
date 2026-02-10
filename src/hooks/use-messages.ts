'use client';

import { useState, useEffect } from 'react';
import { createClient } from '@/utils/supabase/client';

export interface Message {
    id: string;
    thread_id: string;
    role: 'user' | 'assistant';
    content: string;
    reasoning?: string;
    created_at: string;
}

// Get all messages for a thread
export function useMessages(threadId: string | null) {
    const [messages, setMessages] = useState<Message[] | null>(null);
    const supabase = createClient();

    useEffect(() => {
        if (!threadId) {
            setMessages([]);
            return;
        }

        const fetchMessages = async () => {
            const { data } = await supabase
                .from('messages')
                .select('*')
                .eq('thread_id', threadId)
                .order('created_at', { ascending: true });
            if (data) setMessages(data);
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
            supabase.removeChannel(channel);
        };
    }, [threadId, supabase]);

    return messages;
}

// Add a new message to a thread
export async function addMessage(
    threadId: string,
    role: 'user' | 'assistant',
    content: string,
    reasoning?: string
): Promise<Message> {
    const supabase = createClient();
    const { data, error } = await supabase
        .from('messages')
        .insert({
            thread_id: threadId,
            role,
            content,
            reasoning,
        })
        .select()
        .single();

    if (error) throw error;
    return data;
}

// Update message content (for streaming updates)
export async function updateMessage(id: string, content: string, reasoning?: string) {
    const supabase = createClient();
    await supabase
        .from('messages')
        .update({ content, reasoning })
        .eq('id', id);
}

// Delete a message
export async function deleteMessage(id: string) {
    const supabase = createClient();
    await supabase.from('messages').delete().eq('id', id);
}

// Clear all messages in a thread
export async function clearThreadMessages(threadId: string) {
    const supabase = createClient();
    await supabase.from('messages').delete().eq('thread_id', threadId);
}
