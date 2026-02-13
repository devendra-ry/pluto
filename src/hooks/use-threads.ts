'use client';

import { useState, useEffect, useRef } from 'react';
import { createClient } from '@/utils/supabase/client';
import { type ReasoningEffort } from '@/lib/types';

export interface Thread {
    id: string;
    title: string;
    model: string;
    reasoning_effort?: ReasoningEffort;
    system_prompt?: string | null;
    is_pinned?: boolean;
    created_at: string;
    updated_at: string;
    user_id?: string;
}

export const REFRESH_THREADS_EVENT = 'pluto:refresh_threads';
const THREAD_SELECT_COLUMNS = 'id,title,model,reasoning_effort,system_prompt,is_pinned,created_at,updated_at,user_id';
type BrowserSupabaseClient = ReturnType<typeof createClient>;

let cachedUserId: string | null | undefined;
let cachedUserIdPromise: Promise<string | null> | null = null;

function setCachedUserId(userId: string | null) {
    cachedUserId = userId;
}

async function getCurrentUserId(supabase: BrowserSupabaseClient): Promise<string | null> {
    if (cachedUserId !== undefined) {
        return cachedUserId;
    }

    if (!cachedUserIdPromise) {
        cachedUserIdPromise = (async () => {
            const { data, error } = await supabase.auth.getUser();
            if (error) {
                throw error;
            }
            return data.user?.id ?? null;
        })();
    }

    try {
        const userId = await cachedUserIdPromise;
        cachedUserId = userId;
        return userId;
    } finally {
        cachedUserIdPromise = null;
    }
}

function sortThreadsByUpdatedAt(threads: Thread[]) {
    return [...threads].sort((a, b) => {
        const byUpdatedAt = b.updated_at.localeCompare(a.updated_at);
        if (byUpdatedAt !== 0) return byUpdatedAt;
        return b.id.localeCompare(a.id);
    });
}

function toThread(value: unknown): Thread | null {
    if (!value || typeof value !== 'object') return null;
    const record = value as Record<string, unknown>;
    if (
        typeof record.id !== 'string' ||
        typeof record.title !== 'string' ||
        typeof record.model !== 'string' ||
        typeof record.created_at !== 'string' ||
        typeof record.updated_at !== 'string'
    ) {
        return null;
    }

    return {
        id: record.id,
        title: record.title,
        model: record.model,
        reasoning_effort: typeof record.reasoning_effort === 'string'
            ? record.reasoning_effort as ReasoningEffort
            : undefined,
        system_prompt: typeof record.system_prompt === 'string' ? record.system_prompt : null,
        is_pinned: typeof record.is_pinned === 'boolean' ? record.is_pinned : undefined,
        created_at: record.created_at,
        updated_at: record.updated_at,
        user_id: typeof record.user_id === 'string' ? record.user_id : undefined,
    };
}

// Get all threads sorted by most recent
export function useThreads() {
    const [threads, setThreads] = useState<Thread[]>([]);
    const [currentUserId, setCurrentUserId] = useState<string | null>(null);
    const channelRef = useRef<ReturnType<ReturnType<typeof createClient>['channel']> | null>(null);
    // Use useState to ensure client is created once and stable
    const [supabase] = useState(() => createClient());

    const refreshThreads = async () => {
        if (!currentUserId) {
            setThreads([]);
            return;
        }

        try {
            const { data, error } = await supabase
                .from('threads')
                .select(THREAD_SELECT_COLUMNS)
                .eq('user_id', currentUserId)
                .order('updated_at', { ascending: false });

            if (error) {
                console.error('[useThreads] Error fetching threads:', error);
                return;
            }

            if (data) {
                setThreads(data as Thread[]);
            }
        } catch (err) {
            console.error('[useThreads] Unexpected error in refreshThreads:', err);
        }
    };

    useEffect(() => {
        let isActive = true;
        let localUserId: string | null = null;

        const fetchThreads = async () => {
            if (!localUserId) {
                if (isActive) {
                    setThreads([]);
                }
                return;
            }

            try {
                const { data, error } = await supabase
                    .from('threads')
                    .select(THREAD_SELECT_COLUMNS)
                    .eq('user_id', localUserId)
                    .order('updated_at', { ascending: false });

                if (error) {
                    console.error('[useThreads] Error fetching threads:', error);
                    return;
                }

                if (data && isActive) {
                    setThreads(data as Thread[]);
                }
            } catch (err) {
                console.error('[useThreads] Unexpected error in fetchThreads:', err);
            }
        };

        const setup = async () => {
            try {
                const { data: authData, error: authError } = await supabase.auth.getUser();
                if (!isActive) return;
                if (authError) {
                    console.error('[useThreads] Error resolving current user:', authError);
                    return;
                }

                localUserId = authData?.user?.id ?? null;
                setCachedUserId(localUserId);
                setCurrentUserId(localUserId);
            } catch (err) {
                if (!isActive) return;
                console.error('[useThreads] Unexpected error resolving current user:', err);
                return;
            }

            if (!localUserId) {
                setThreads([]);
                return;
            }

            await fetchThreads();
            if (!isActive) {
                return;
            }

            if (channelRef.current) {
                supabase.removeChannel(channelRef.current);
                channelRef.current = null;
            }

            // 1. Realtime subscription scoped to current user only
            const channel = supabase
                .channel(`threads_changes_${localUserId}`)
                .on('postgres_changes', {
                    event: '*',
                    schema: 'public',
                    table: 'threads',
                    filter: `user_id=eq.${localUserId}`,
                }, (payload) => {
                    if (!isActive) return;

                    if (payload.eventType === 'DELETE') {
                        const deletedId = typeof payload.old?.id === 'string' ? payload.old.id : null;
                        if (!deletedId) return;
                        setThreads((prev) => prev.filter((thread) => thread.id !== deletedId));
                        return;
                    }

                    const nextThread = toThread(payload.new);
                    if (!nextThread) return;

                    setThreads((prev) => {
                        const existingIndex = prev.findIndex((thread) => thread.id === nextThread.id);
                        if (existingIndex === -1) {
                            return sortThreadsByUpdatedAt([...prev, nextThread]);
                        }

                        const updated = [...prev];
                        updated[existingIndex] = nextThread;
                        return sortThreadsByUpdatedAt(updated);
                    });
                })
                .subscribe((status) => {
                    if (status === 'CHANNEL_ERROR') {
                        console.error('[useThreads] Realtime channel error');
                    }
                });
            channelRef.current = channel;
        };

        void setup();

        // 2. Local CustomEvent sync for immediate updates
        const handleRefresh = () => {
            void fetchThreads();
        };
        window.addEventListener(REFRESH_THREADS_EVENT, handleRefresh);

        return () => {
            isActive = false;
            if (channelRef.current) {
                supabase.removeChannel(channelRef.current);
                channelRef.current = null;
            }
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
                .select(THREAD_SELECT_COLUMNS)
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
export async function createThread(model: string, reasoningEffort?: ReasoningEffort, systemPrompt?: string | null): Promise<Thread> {
    const supabase = createClient();

    const userId = await getCurrentUserId(supabase);
    if (!userId) {
        throw new Error('You must be signed in to create a chat.');
    }

    const insertData = {
        title: 'New Chat',
        model,
        reasoning_effort: reasoningEffort,
        system_prompt: (systemPrompt && systemPrompt.trim().length > 0) ? systemPrompt.trim() : null,
        user_id: userId
    };

    const { data, error } = await supabase
        .from('threads')
        .insert(insertData)
        .select()
        .single();

    if (error) {
        throw error;
    }

    try {
        await cleanupEmptyThreads(data.id);
    } catch (cleanupError) {
        console.error('[useThreads] Failed to cleanup empty threads after create:', cleanupError);
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

    if (error) throw error;
    triggerRefresh();
}

// Update thread model
export async function updateThreadModel(id: string, model: string) {
    const supabase = createClient();
    const { error } = await supabase
        .from('threads')
        .update({ model, updated_at: new Date().toISOString() })
        .eq('id', id);

    if (error) throw error;
    triggerRefresh();
}

// Update thread reasoning effort
export async function updateReasoningEffort(id: string, effort: ReasoningEffort) {
    const supabase = createClient();
    const { error } = await supabase
        .from('threads')
        .update({ reasoning_effort: effort, updated_at: new Date().toISOString() })
        .eq('id', id);

    if (error) throw error;
    triggerRefresh();
}

// Update thread system prompt/lore
export async function updateThreadSystemPrompt(id: string, systemPrompt: string | null) {
    const supabase = createClient();
    const normalized = systemPrompt && systemPrompt.trim().length > 0 ? systemPrompt.trim() : null;
    const { error } = await supabase
        .from('threads')
        .update({ system_prompt: normalized, updated_at: new Date().toISOString() })
        .eq('id', id);

    if (error) throw error;
    triggerRefresh();
}

// Toggle thread pin
export async function toggleThreadPin(id: string, isPinned: boolean) {
    const supabase = createClient();
    const { error } = await supabase
        .from('threads')
        .update({ is_pinned: isPinned, updated_at: new Date().toISOString() })
        .eq('id', id);

    if (error) throw error;
    triggerRefresh();
}

// Update thread timestamp (for sorting)
export async function touchThread(id: string) {
    const supabase = createClient();
    const { error } = await supabase
        .from('threads')
        .update({ updated_at: new Date().toISOString() })
        .eq('id', id);

    if (error) throw error;
    triggerRefresh();
}

// Delete a thread and all its messages
export async function deleteThread(id: string) {
    const supabase = createClient();
    const { error } = await supabase.from('threads').delete().eq('id', id);
    if (error) throw error;
    try {
        await cleanupEmptyThreads();
    } catch (cleanupError) {
        console.error('[useThreads] Failed to cleanup empty threads after delete:', cleanupError);
    }
    triggerRefresh();
}

// Cleanup empty threads (titled "New Chat" and have no messages)
export async function cleanupEmptyThreads(excludeId?: string) {
    const supabase = createClient();
    const { data, error } = await supabase.rpc('cleanup_empty_new_chat_threads', {
        exclude_thread_id: excludeId ?? null,
    });
    if (error) {
        throw error;
    }
    if (typeof data === 'number' && data > 0) {
        triggerRefresh();
    }
}

