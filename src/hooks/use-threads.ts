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

export const REFRESH_THREADS_EVENT = 'pluto:refresh_threads';

// Get all threads sorted by most recent
export function useThreads() {
    const [threads, setThreads] = useState<Thread[]>([]);
    // Use useState to ensure client is created once and stable
    const [supabase] = useState(() => createClient());

    const refreshThreads = async () => {
        try {
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
        } catch (err) {
            console.error('[useThreads] Unexpected error in refreshThreads:', err);
        }
    };

    useEffect(() => {
        let isActive = true;

        const fetchThreads = async () => {
            try {
                const { data, error } = await supabase
                    .from('threads')
                    .select('*')
                    .order('updated_at', { ascending: false });

                if (error) {
                    console.error('[useThreads] Error fetching threads:', error);
                    return;
                }

                if (data && isActive) {
                    setThreads(data);
                }
            } catch (err) {
                console.error('[useThreads] Unexpected error in fetchThreads:', err);
            }
        };

        void fetchThreads();

        // 1. Realtime subscription
        const channel = supabase
            .channel('threads_changes')
            .on('postgres_changes', { event: '*', schema: 'public', table: 'threads' }, (payload) => {
                console.log('[useThreads] Realtime change detected:', payload);
                void fetchThreads();
            })
            .subscribe((status) => {
                if (status === 'CHANNEL_ERROR') {
                    console.error('[useThreads] Realtime channel error');
                } else {
                    console.log('[useThreads] Realtime subscription status:', status);
                }
            });

        // 2. Local CustomEvent sync for immediate updates
        const handleRefresh = () => {
            console.log('[useThreads] Refresh event received');
            void fetchThreads();
        };
        window.addEventListener(REFRESH_THREADS_EVENT, handleRefresh);

        return () => {
            isActive = false;
            supabase.removeChannel(channel);
            window.removeEventListener(REFRESH_THREADS_EVENT, handleRefresh);
        };
    }, [supabase]);

    return { threads, refreshThreads };
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

// Helper to trigger thread refresh
const triggerRefresh = () => {
    window.dispatchEvent(new CustomEvent(REFRESH_THREADS_EVENT));
};

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

    triggerRefresh();
    return data;
}

// Update thread title
export async function updateThreadTitle(id: string, title: string) {
    const supabase = createClient();
    const { error } = await supabase
        .from('threads')
        .update({ title, updated_at: new Date().toISOString() })
        .eq('id', id);

    if (!error) triggerRefresh();
}

// Update thread model
export async function updateThreadModel(id: string, model: string) {
    const supabase = createClient();
    const { error } = await supabase
        .from('threads')
        .update({ model, updated_at: new Date().toISOString() })
        .eq('id', id);

    if (!error) triggerRefresh();
}

// Update thread reasoning effort
export async function updateReasoningEffort(id: string, effort: ReasoningEffort) {
    const supabase = createClient();
    const { error } = await supabase
        .from('threads')
        .update({ reasoning_effort: effort, updated_at: new Date().toISOString() })
        .eq('id', id);

    if (!error) triggerRefresh();
}

// Toggle thread pin
export async function toggleThreadPin(id: string, isPinned: boolean) {
    const supabase = createClient();
    const { error } = await supabase
        .from('threads')
        .update({ is_pinned: isPinned, updated_at: new Date().toISOString() })
        .eq('id', id);

    if (!error) triggerRefresh();
}

// Update thread timestamp (for sorting)
export async function touchThread(id: string) {
    const supabase = createClient();
    const { error } = await supabase
        .from('threads')
        .update({ updated_at: new Date().toISOString() })
        .eq('id', id);

    if (!error) triggerRefresh();
}

// Delete a thread and all its messages
export async function deleteThread(id: string) {
    const supabase = createClient();
    const { error } = await supabase.from('threads').delete().eq('id', id);

    if (!error) triggerRefresh();
}

// Cleanup empty threads (titled "New Chat" and have no messages)
export async function cleanupEmptyThreads(excludeId?: string) {
    const supabase = createClient();

    const { data: threads } = await supabase
        .from('threads')
        .select('id, title')
        .eq('title', 'New Chat')
        .neq('id', excludeId);

    if (threads && threads.length > 0) {
        let deletedAny = false;
        for (const thread of threads) {
            const { count } = await supabase
                .from('messages')
                .select('*', { count: 'exact', head: true })
                .eq('thread_id', thread.id);

            if (count === 0) {
                await supabase.from('threads').delete().eq('id', thread.id);
                deletedAny = true;
            }
        }
        if (deletedAny) triggerRefresh();
    }
}

