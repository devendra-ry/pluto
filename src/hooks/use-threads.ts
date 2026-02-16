'use client';

import { useState, useEffect, useRef, useCallback } from 'react';
import { createClient } from '@/utils/supabase/client';
import { type ReasoningEffort } from '@/lib/types';
import { cleanupThreadAttachments } from '@/lib/uploads';
import { sanitizeThreadTitle } from '@/lib/sanitize';
import { DEFAULT_MODEL } from '@/lib/constants';
import type { Database } from '@/utils/supabase/database.types';

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
const THREADS_PAGE_SIZE = 50;
type ThreadRow = Database['public']['Tables']['threads']['Row'];

function compareThreadsByUpdatedAtDesc(a: Thread, b: Thread) {
    const byUpdatedAt = b.updated_at.localeCompare(a.updated_at);
    if (byUpdatedAt !== 0) return byUpdatedAt;
    return b.id.localeCompare(a.id);
}

function upsertThreadSorted(threads: Thread[], nextThread: Thread): Thread[] {
    const withoutNext = threads.filter((thread) => thread.id !== nextThread.id);
    let insertAt = withoutNext.length;
    for (let i = 0; i < withoutNext.length; i += 1) {
        if (compareThreadsByUpdatedAtDesc(nextThread, withoutNext[i]) < 0) {
            insertAt = i;
            break;
        }
    }

    return [
        ...withoutNext.slice(0, insertAt),
        nextThread,
        ...withoutNext.slice(insertAt),
    ];
}

function mergeThreadsSorted(existing: Thread[], incoming: Thread[]) {
    if (incoming.length === 0) return existing;

    const byId = new Map(existing.map((thread) => [thread.id, thread]));
    for (const thread of incoming) {
        // Keep local/realtime-updated thread versions if already present.
        if (!byId.has(thread.id)) {
            byId.set(thread.id, thread);
        }
    }

    return Array.from(byId.values()).sort(compareThreadsByUpdatedAtDesc);
}

function toReasoningEffort(value: unknown): ReasoningEffort | undefined {
    if (value === 'low' || value === 'medium' || value === 'high') {
        return value;
    }
    return undefined;
}

function mapThreadRowToThread(row: ThreadRow): Thread {
    return {
        id: row.id,
        title: row.title ?? 'New Chat',
        model: row.model ?? DEFAULT_MODEL,
        reasoning_effort: toReasoningEffort(row.reasoning_effort),
        system_prompt: row.system_prompt,
        is_pinned: row.is_pinned ?? undefined,
        created_at: row.created_at,
        updated_at: row.updated_at,
        user_id: row.user_id,
    };
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
        reasoning_effort: toReasoningEffort(record.reasoning_effort),
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
    const backfillRunRef = useRef(0);
    // Use useState to ensure client is created once and stable
    const [supabase] = useState(() => createClient());

    const fetchThreadsPage = useCallback(async (userId: string, offset: number) => {
        return await supabase
            .from('threads')
            .select(THREAD_SELECT_COLUMNS)
            .eq('user_id', userId)
            .order('updated_at', { ascending: false })
            .order('id', { ascending: false })
            .range(offset, offset + THREADS_PAGE_SIZE - 1);
    }, [supabase]);

    const loadThreadsPaged = useCallback(async (userId: string, isActive: () => boolean = () => true) => {
        const runId = ++backfillRunRef.current;
        const isCurrentRun = () => isActive() && backfillRunRef.current === runId;

        try {
            const { data, error } = await fetchThreadsPage(userId, 0);
            if (!isCurrentRun()) return;
            if (error) {
                console.error('[useThreads] Error fetching threads:', error);
                return;
            }

            const firstPage = (data ?? []).map(mapThreadRowToThread);
            setThreads(firstPage);

            if (firstPage.length < THREADS_PAGE_SIZE) {
                return;
            }

            let offset = THREADS_PAGE_SIZE;
            while (isCurrentRun()) {
                const next = await fetchThreadsPage(userId, offset);
                if (!isCurrentRun()) return;

                if (next.error) {
                    console.error('[useThreads] Error fetching threads page:', next.error);
                    return;
                }

                const page = (next.data ?? []).map(mapThreadRowToThread);
                if (page.length === 0) {
                    return;
                }

                setThreads((prev) => mergeThreadsSorted(prev, page));

                if (page.length < THREADS_PAGE_SIZE) {
                    return;
                }
                offset += THREADS_PAGE_SIZE;
            }
        } catch (err) {
            if (!isCurrentRun()) return;
            console.error('[useThreads] Unexpected error in loadThreadsPaged:', err);
        }
    }, [fetchThreadsPage]);

    const refreshThreads = useCallback(async () => {
        if (!currentUserId) {
            setThreads([]);
            return;
        }
        await loadThreadsPaged(currentUserId);
    }, [currentUserId, loadThreadsPaged]);

    useEffect(() => {
        let isActive = true;
        let localUserId: string | null = null;

        const unsubscribeRealtime = () => {
            if (channelRef.current) {
                supabase.removeChannel(channelRef.current);
                channelRef.current = null;
            }
        };

        const subscribeRealtime = () => {
            if (!isActive || !localUserId || channelRef.current) {
                return;
            }
            if (typeof document !== 'undefined' && document.visibilityState === 'hidden') {
                return;
            }

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
                        return upsertThreadSorted(prev, nextThread);
                    });
                })
                .subscribe((status) => {
                    if (status === 'CHANNEL_ERROR') {
                        console.error('[useThreads] Realtime channel error');
                    }
                });
            channelRef.current = channel;
        };

        const fetchThreads = async () => {
            if (!localUserId) {
                if (isActive) {
                    setThreads([]);
                }
                return;
            }

            await loadThreadsPaged(localUserId, () => isActive);
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
                setCurrentUserId(localUserId);
            } catch (err) {
                if (!isActive) return;
                console.error('[useThreads] Unexpected error resolving current user:', err);
                return;
            }

            if (!localUserId) {
                setThreads([]);
                unsubscribeRealtime();
                return;
            }

            await fetchThreads();
            if (!isActive) {
                return;
            }

            unsubscribeRealtime();
            subscribeRealtime();
        };

        void setup();

        // Local CustomEvent sync for immediate updates
        const handleRefresh = () => {
            void fetchThreads();
        };
        window.addEventListener(REFRESH_THREADS_EVENT, handleRefresh);

        const handleVisibilityChange = () => {
            if (!isActive || !localUserId) return;
            if (document.visibilityState === 'hidden') {
                unsubscribeRealtime();
                return;
            }
            void (async () => {
                await fetchThreads();
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
            window.removeEventListener(REFRESH_THREADS_EVENT, handleRefresh);
        };
    }, [supabase, loadThreadsPaged]);

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
            if (data) setThread(mapThreadRowToThread(data));
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

    const { data: authData, error: authError } = await supabase.auth.getUser();
    if (authError) {
        throw authError;
    }
    const userId = authData.user?.id ?? null;
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
    return mapThreadRowToThread(data);
}

// Update thread title
export async function updateThreadTitle(id: string, title: string) {
    const supabase = createClient();
    const normalizedTitle = sanitizeThreadTitle(title);
    const { error } = await supabase
        .from('threads')
        .update({ title: normalizedTitle, updated_at: new Date().toISOString() })
        .eq('id', id);

    if (error) throw error;
    triggerRefresh();
}

// Update thread title only if it's still the default "New Chat".
// Returns true when a row was updated, false when no-op (already renamed elsewhere).
export async function updateThreadTitleIfNewChat(id: string, title: string): Promise<boolean> {
    const supabase = createClient();
    const normalizedTitle = sanitizeThreadTitle(title);
    const { data, error } = await supabase
        .from('threads')
        .update({ title: normalizedTitle, updated_at: new Date().toISOString() })
        .eq('id', id)
        .eq('title', 'New Chat')
        .select('id');

    if (error) throw error;
    const updated = Array.isArray(data) && data.length > 0;
    if (updated) {
        triggerRefresh();
    }
    return updated;
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
    await cleanupThreadAttachments(id);
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
        exclude_thread_id: excludeId,
    });
    if (error) {
        throw error;
    }
    if (typeof data === 'number' && data > 0) {
        triggerRefresh();
    }
}

