'use client';

import { useState, useEffect } from 'react';
import { createClient } from '@/utils/supabase/client';
import { type ReasoningEffort } from '@/lib/types';

export interface Thread {
    id: string;
    title: string;
    model: string;
    reasoning_effort?: ReasoningEffort;
    is_pinned?: boolean;
    created_at: string;
    updated_at: string;
    user_id?: string;
}

// Get all threads sorted by most recent
export function useThreads() {
    const [threads, setThreads] = useState<Thread[]>([]);
    // Use useState to ensure client is created once and stable
    const [supabase] = useState(() => createClient());

    const fetchThreads = async () => {
        // Check auth state
        const { data: { user } } = await supabase.auth.getUser();

        const { data, error } = await supabase
            .from('threads')
            .select('*')
            .order('updated_at', { ascending: false });

        if (error) {
            console.error('[useThreads] Error fetching threads:', error);
            return;
        }

        if (data) {
            setThreads(data);
        }
    };

    useEffect(() => {
        fetchThreads();

        // Realtime subscription
        const channel = supabase
            .channel('threads_changes')
            .on('postgres_changes', { event: '*', schema: 'public', table: 'threads' }, () => {
                fetchThreads();
            })
            .subscribe((status) => {
                if (status === 'CHANNEL_ERROR') {
                    console.error('[useThreads] Realtime channel error');
                }
            });

        return () => {
            supabase.removeChannel(channel);
        };
    }, [supabase]);

    return { threads, refreshThreads: fetchThreads };
}

// Get a single thread by ID
export function useThread(id: string | null) {
    const [thread, setThread] = useState<Thread | undefined>(undefined);
    const [supabase] = useState(() => createClient());

    useEffect(() => {
        if (!id) return;
        const fetchThread = async () => {
            const { data } = await supabase
                .from('threads')
                .select('*')
                .eq('id', id)
                .single();
            if (data) setThread(data);
        };

        fetchThread();
    }, [id, supabase]);

    return thread;
}

// Create a new thread
export async function createThread(model: string, reasoningEffort?: ReasoningEffort): Promise<Thread> {
    const supabase = createClient();

    const { data: authData, error: authError } = await supabase.auth.getUser();
    if (authError) {
        throw authError;
    }

    if (!authData?.user) {
        throw new Error('You must be signed in to create a chat.');
    }

    const user = authData.user;

    const insertData = {
        title: 'New Chat',
        model,
        reasoning_effort: reasoningEffort,
        user_id: user.id
    };

    const { data, error } = await supabase
        .from('threads')
        .insert(insertData)
        .select()
        .single();

    if (error) {
        throw error;
    }

    return data;
}

// Update thread title
export async function updateThreadTitle(id: string, title: string) {
    const supabase = createClient();
    await supabase
        .from('threads')
        .update({ title, updated_at: new Date().toISOString() })
        .eq('id', id);
}

// Update thread model
export async function updateThreadModel(id: string, model: string) {
    const supabase = createClient();
    await supabase
        .from('threads')
        .update({ model, updated_at: new Date().toISOString() })
        .eq('id', id);
}

// Update thread reasoning effort
export async function updateReasoningEffort(id: string, effort: ReasoningEffort) {
    const supabase = createClient();
    await supabase
        .from('threads')
        .update({ reasoning_effort: effort, updated_at: new Date().toISOString() })
        .eq('id', id);
}

// Toggle thread pin
export async function toggleThreadPin(id: string, isPinned: boolean) {
    const supabase = createClient();
    await supabase
        .from('threads')
        .update({ is_pinned: isPinned, updated_at: new Date().toISOString() })
        .eq('id', id);
}

// Update thread timestamp (for sorting)
export async function touchThread(id: string) {
    const supabase = createClient();
    await supabase
        .from('threads')
        .update({ updated_at: new Date().toISOString() })
        .eq('id', id);
}

// Delete a thread and all its messages
export async function deleteThread(id: string) {
    const supabase = createClient();
    // Cascade delete should be handled in Supabase schema (on delete cascade)
    await supabase.from('threads').delete().eq('id', id);
}

// Cleanup empty threads (titled "New Chat" and have no messages)
export async function cleanupEmptyThreads(excludeId?: string) {
    const supabase = createClient();

    // This is a bit more complex in Supabase without a custom RPC or heavy client logic.
    // For now, let's just get threads with title 'New Chat' and check them.
    const { data: threads } = await supabase
        .from('threads')
        .select('id, title')
        .eq('title', 'New Chat')
        .neq('id', excludeId);

    if (threads) {
        for (const thread of threads) {
            const { count } = await supabase
                .from('messages')
                .select('*', { count: 'exact', head: true })
                .eq('thread_id', thread.id);

            if (count === 0) {
                await supabase.from('threads').delete().eq('id', thread.id);
            }
        }
    }
}
