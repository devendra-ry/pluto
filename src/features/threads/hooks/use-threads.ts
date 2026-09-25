'use client';

import { useCallback, useEffect, useRef, useState } from 'react';

import { REFRESH_THREADS_EVENT } from '../lib/thread-events';
import {
    mapThreadRowToThread,
    mergeThreadsSorted,
    THREAD_SELECT_COLUMNS,
    THREADS_PAGE_SIZE,
    toThread,
    upsertThreadSorted,
} from '../lib/thread-model';
import type { Thread } from '@/shared/contracts/thread';
import { createClient } from '@/shared/lib/supabase/client';

export type { Thread } from '@/shared/contracts/thread';

export function useThreads() {
    const [threads, setThreads] = useState<Thread[]>([]);
    const [currentUserId, setCurrentUserId] = useState<string | null>(null);
    const [hasMoreThreads, setHasMoreThreads] = useState(false);
    const channelRef = useRef<ReturnType<ReturnType<typeof createClient>['channel']> | null>(null);
    const backfillRunRef = useRef(0);
    const nextOffsetRef = useRef(0);
    const loadMorePromiseRef = useRef<Promise<boolean> | null>(null);
    const realtimeOverridesRef = useRef(new Map<string, Thread | null>());
    const realtimeUserIdRef = useRef<string | null>(null);
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

    const loadThreadsPaged = useCallback(async (
        userId: string,
        isActive: () => boolean = () => true
    ) => {
        const runId = ++backfillRunRef.current;
        nextOffsetRef.current = 0;
        loadMorePromiseRef.current = null;
        setHasMoreThreads(false);
        const isCurrentRun = () => isActive() && backfillRunRef.current === runId;

        const reconcilePageWithRealtime = (page: Thread[]) => {
            const byId = new Map(page.map((thread) => [thread.id, thread]));
            for (const [id, override] of realtimeOverridesRef.current) {
                if (override === null) byId.delete(id);
                else if (override.user_id === userId) byId.set(id, override);
            }
            return Array.from(byId.values()).sort((a, b) =>
                b.updated_at.localeCompare(a.updated_at) || b.id.localeCompare(a.id)
            );
        };

        try {
            const { data, error } = await fetchThreadsPage(userId, 0);
            if (!isCurrentRun()) return;
            if (error) {
                console.error('[useThreads] Error fetching threads:', error);
                return;
            }

            nextOffsetRef.current = data?.length ?? 0;
            setHasMoreThreads((data?.length ?? 0) === THREADS_PAGE_SIZE);
            const firstPage = reconcilePageWithRealtime((data ?? []).map(mapThreadRowToThread));
            setThreads((previous) => {
                // Preserve events received after this request started, including a
                // deletion that a stale first-page response cannot represent.
                const liveIds = new Set(realtimeOverridesRef.current.keys());
                const preservedLive = previous.filter((thread) => liveIds.has(thread.id));
                return reconcilePageWithRealtime(mergeThreadsSorted(firstPage, preservedLive));
            });
        } catch (error) {
            if (!isCurrentRun()) return;
            console.error('[useThreads] Unexpected error in loadThreadsPaged:', error);
        }
    }, [fetchThreadsPage]);

    const loadMoreThreads = useCallback((): Promise<boolean> => {
        if (loadMorePromiseRef.current) return loadMorePromiseRef.current;
        const userId = currentUserId;
        if (!userId || !hasMoreThreads) return Promise.resolve(false);
        const runId = backfillRunRef.current;
        const isCurrentRun = () => backfillRunRef.current === runId;
        const offset = nextOffsetRef.current;
        const loadPromise = Promise.resolve().then(async () => {
            try {
                const { data, error } = await fetchThreadsPage(userId, offset);
                if (!isCurrentRun()) return false;
                if (error) {
                    console.error('[useThreads] Error fetching older threads:', error);
                    return false;
                }

                const rows = data ?? [];
                nextOffsetRef.current = offset + rows.length;
                const hasNextPage = rows.length === THREADS_PAGE_SIZE;
                setHasMoreThreads(hasNextPage);
                if (rows.length === 0) return false;
                const page = Array.from(realtimeOverridesRef.current.entries()).reduce<Thread[]>(
                    (result, [id, override]) => {
                        if (override === null) return result.filter((thread) => thread.id !== id);
                        if (override.user_id !== userId) return result;
                        return upsertThreadSorted(result, override);
                    },
                    rows.map(mapThreadRowToThread)
                );
                setThreads((previous) => mergeThreadsSorted(previous, page));
                return hasNextPage;
            } catch (error) {
                if (isCurrentRun()) {
                    console.error('[useThreads] Unexpected error loading older threads:', error);
                }
                return false;
            } finally {
                if (loadMorePromiseRef.current === loadPromise) {
                    loadMorePromiseRef.current = null;
                }
            }
        });
        loadMorePromiseRef.current = loadPromise;
        return loadPromise;
    }, [currentUserId, hasMoreThreads, fetchThreadsPage]);

    const refreshThreads = useCallback(async () => {
        if (!currentUserId) {
            setThreads([]);
            setHasMoreThreads(false);
            return;
        }
        await loadThreadsPaged(currentUserId);
    }, [currentUserId, loadThreadsPaged]);

    useEffect(() => {
        let isActive = true;
        let localUserId: string | null = null;
        let initialUserResolved = false;

        const unsubscribeRealtime = () => {
            if (!channelRef.current) return;
            supabase.removeChannel(channelRef.current);
            channelRef.current = null;
        };

        const subscribeRealtime = () => {
            if (!isActive || !localUserId || channelRef.current) return;

            if (realtimeUserIdRef.current !== localUserId) {
                realtimeOverridesRef.current.clear();
                realtimeUserIdRef.current = localUserId;
            }

            channelRef.current = supabase
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
                        if (deletedId) {
                            realtimeOverridesRef.current.set(deletedId, null);
                            setThreads((previous) => previous.filter((thread) => thread.id !== deletedId));
                        }
                        return;
                    }

                    const nextThread = toThread(payload.new);
                    if (nextThread) {
                        realtimeOverridesRef.current.set(nextThread.id, nextThread);
                        setThreads((previous) => upsertThreadSorted(previous, nextThread));
                    }
                })
                .subscribe((status) => {
                    if (status === 'CHANNEL_ERROR') {
                        console.error('[useThreads] Realtime channel error');
                    }
                });
        };

        const fetchThreads = async () => {
            if (!localUserId) {
                if (isActive) {
                    backfillRunRef.current += 1;
                    nextOffsetRef.current = 0;
                    loadMorePromiseRef.current = null;
                    setThreads([]);
                    setHasMoreThreads(false);
                }
                return;
            }
            // The first page is the useful startup result. Older pages are fetched
            // after it has rendered so they do not delay the sidebar or realtime.
            await loadThreadsPaged(localUserId, () => isActive);
        };

        const setup = async () => {
            try {
                const { data: { user }, error } = await supabase.auth.getUser();
                if (!isActive) return;
                if (error) {
                    console.error('[useThreads] Error resolving current user:', error);
                    return;
                }
                localUserId = user?.id ?? null;
                initialUserResolved = true;
                setCurrentUserId(localUserId);
            } catch (error) {
                if (!isActive) return;
                console.error('[useThreads] Unexpected error resolving current user:', error);
                return;
            }

            if (!localUserId) {
                setThreads([]);
                unsubscribeRealtime();
                return;
            }
            unsubscribeRealtime();
            subscribeRealtime();
            void fetchThreads();
        };

        void setup();

        const { data: { subscription: authSubscription } } = supabase.auth.onAuthStateChange(
            (event, session) => {
                if (!isActive) return;
                // setup() performs the initial getUser() lookup. Supabase also
                // emits INITIAL_SESSION, so ignoring it avoids a duplicate first
                // page request and backfill run.
                if (event === 'INITIAL_SESSION') return;
                const nextUserId = session?.user?.id ?? null;
                if (!initialUserResolved) {
                    localUserId = nextUserId;
                    setCurrentUserId(nextUserId);
                    return;
                }
                // Token refreshes and other same-user auth events do not require
                // another full sidebar reload.
                if (nextUserId === localUserId) return;
                localUserId = nextUserId;
                setCurrentUserId(localUserId);
                if (localUserId) {
                    unsubscribeRealtime();
                    subscribeRealtime();
                    void fetchThreads();
                }
                else {
                    backfillRunRef.current += 1;
                    nextOffsetRef.current = 0;
                    loadMorePromiseRef.current = null;
                    setThreads([]);
                    setHasMoreThreads(false);
                    unsubscribeRealtime();
                    realtimeOverridesRef.current.clear();
                    realtimeUserIdRef.current = null;
                }
            }
        );

        const handleRefresh = () => void fetchThreads();
        const handleVisibilityChange = () => {
            if (isActive && localUserId && document.visibilityState === 'visible') {
                void fetchThreads();
            }
        };
        window.addEventListener(REFRESH_THREADS_EVENT, handleRefresh);
        document.addEventListener('visibilitychange', handleVisibilityChange);

        return () => {
            isActive = false;
            backfillRunRef.current += 1;
            authSubscription.unsubscribe();
            document.removeEventListener('visibilitychange', handleVisibilityChange);
            unsubscribeRealtime();
            window.removeEventListener(REFRESH_THREADS_EVENT, handleRefresh);
        };
    }, [supabase, loadThreadsPaged]);

    return { threads, refreshThreads, loadMoreThreads, hasMoreThreads };
}

export function useThread(id: string | null, initialThread?: Thread) {
    const [threadState, setThreadState] = useState<{ id: string | null; thread?: Thread }>(() => ({
        id,
        ...(initialThread ? { thread: initialThread } : {}),
    }));
    const [supabase] = useState(() => createClient());

    useEffect(() => {
        if (!id) {
            setThreadState({ id: null });
            return;
        }
        let cancelled = false;
        setThreadState({ id, ...(initialThread ? { thread: initialThread } : {}) });
        const fetchThread = async () => {
            const { data } = await supabase
                .from('threads')
                .select(THREAD_SELECT_COLUMNS)
                .eq('id', id)
                .single();
            if (data && !cancelled) setThreadState({ id, thread: mapThreadRowToThread(data) });
        };
        void fetchThread();
        return () => { cancelled = true; };
    }, [id, initialThread, supabase]);

    return threadState.id === id ? threadState.thread : initialThread;
}
