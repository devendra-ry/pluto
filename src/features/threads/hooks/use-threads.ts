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
import { reconcileThreadPage, threadCursorFromPage, threadCursorPostgrestFilter, type ThreadCursor } from '../lib/thread-pagination';
import type { Thread } from '@/shared/contracts/thread';
import { createClient } from '@/shared/lib/supabase/client';

export type { Thread } from '@/shared/contracts/thread';

export function useThreads(currentUserId: string | null) {
    const [threads, setThreads] = useState<Thread[]>([]);
    const [hasMoreThreads, setHasMoreThreads] = useState(false);
    const [isLoadingThreads, setIsLoadingThreads] = useState(false);
    const [threadsError, setThreadsError] = useState<string | null>(null);
    const [loadMoreError, setLoadMoreError] = useState<string | null>(null);
    const channelRef = useRef<ReturnType<ReturnType<typeof createClient>['channel']> | null>(null);
    const backfillRunRef = useRef(0);
    const nextCursorRef = useRef<ThreadCursor | null>(null);
    const loadMorePromiseRef = useRef<Promise<boolean> | null>(null);
    const realtimeOverridesRef = useRef(new Map<string, Thread | null>());
    const realtimeUserIdRef = useRef<string | null>(null);
    const [supabase] = useState(() => createClient());

    const fetchThreadsPage = useCallback(async (userId: string, cursor: ThreadCursor | null) => {
        let query = supabase
            .from('threads')
            .select(THREAD_SELECT_COLUMNS)
            .eq('user_id', userId);
        if (cursor) {
            const filter = threadCursorPostgrestFilter(cursor);
            if (!filter) throw new Error('Invalid conversation cursor');
            query = query.or(filter);
        }
        return await query
            .order('updated_at', { ascending: false })
            .order('id', { ascending: false })
            .limit(THREADS_PAGE_SIZE);
    }, [supabase]);

    const loadThreadsPaged = useCallback(async (
        userId: string,
        isActive: () => boolean = () => true
    ) => {
        const runId = ++backfillRunRef.current;
        loadMorePromiseRef.current = null;
        setIsLoadingThreads(true);
        setThreadsError(null);
        setLoadMoreError(null);
        const isCurrentRun = () => isActive() && backfillRunRef.current === runId;

        try {
            const { data, error } = await fetchThreadsPage(userId, null);
            if (!isCurrentRun()) return;
            if (error) {
                console.error('[useThreads] Error fetching threads:', error);
                setThreadsError('Could not load conversations. Try again.');
                return;
            }

            const rows = data ?? [];
            nextCursorRef.current = threadCursorFromPage(rows.map(mapThreadRowToThread));
            setHasMoreThreads(rows.length === THREADS_PAGE_SIZE);
            const overrides = new Map([...realtimeOverridesRef.current].filter(([, override]) =>
                override === null || override.user_id === userId
            ));
            const firstPage = reconcileThreadPage(rows.map(mapThreadRowToThread), overrides);
            realtimeOverridesRef.current.clear();
            setThreads((previous) => {
                // Keep events that landed while the request was in flight, then
                // release their overrides so future reads can reconcile normally.
                const preservedLive = previous.filter((thread) => overrides.has(thread.id) && overrides.get(thread.id) !== null);
                const merged = mergeThreadsSorted(firstPage, preservedLive);
                for (const [id, override] of overrides) {
                    if (override === null) {
                        const index = merged.findIndex((thread) => thread.id === id);
                        if (index >= 0) merged.splice(index, 1);
                    } else if (override.user_id === userId) {
                        const index = merged.findIndex((thread) => thread.id === id);
                        if (index >= 0) merged.splice(index, 1);
                        merged.push(override);
                    }
                }
                return merged.sort((a, b) => b.updated_at.localeCompare(a.updated_at) || b.id.localeCompare(a.id));
            });
        } catch (error) {
            if (!isCurrentRun()) return;
            console.error('[useThreads] Unexpected error in loadThreadsPaged:', error);
            setThreadsError('Could not load conversations. Try again.');
        } finally {
            if (isCurrentRun()) setIsLoadingThreads(false);
        }
    }, [fetchThreadsPage]);

    const loadMoreThreads = useCallback((retry = false): Promise<boolean> => {
        if (loadMorePromiseRef.current) return loadMorePromiseRef.current;
        const userId = currentUserId;
        if (!userId || !hasMoreThreads || isLoadingThreads || (loadMoreError && !retry)) return Promise.resolve(false);
        setLoadMoreError(null);
        const runId = backfillRunRef.current;
        const isCurrentRun = () => backfillRunRef.current === runId;
        const cursor = nextCursorRef.current;
        const loadPromise = Promise.resolve().then(async () => {
            try {
                const { data, error } = await fetchThreadsPage(userId, cursor);
                if (!isCurrentRun()) return false;
                if (error) {
                    console.error('[useThreads] Error fetching older threads:', error);
                    setLoadMoreError('Could not load older conversations.');
                    return false;
                }

                const rows = data ?? [];
                if (rows.length > 0) nextCursorRef.current = threadCursorFromPage(rows.map(mapThreadRowToThread));
                const hasNextPage = rows.length === THREADS_PAGE_SIZE;
                setHasMoreThreads(hasNextPage);
                if (rows.length === 0) return false;
                const overrides = new Map([...realtimeOverridesRef.current].filter(([, override]) =>
                    override === null || override.user_id === userId
                ));
                const page = reconcileThreadPage(rows.map(mapThreadRowToThread), overrides);
                setThreads((previous) => mergeThreadsSorted(previous, page));
                return hasNextPage;
            } catch (error) {
                if (isCurrentRun()) {
                    console.error('[useThreads] Unexpected error loading older threads:', error);
                    setLoadMoreError('Could not load older conversations.');
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
    }, [currentUserId, hasMoreThreads, isLoadingThreads, loadMoreError, fetchThreadsPage]);

    const refreshThreads = useCallback(async () => {
        if (!currentUserId) {
            setThreads([]);
            setHasMoreThreads(false);
            setIsLoadingThreads(false);
            setThreadsError(null);
            setLoadMoreError(null);
            return;
        }
        await loadThreadsPaged(currentUserId);
    }, [currentUserId, loadThreadsPaged]);

    useEffect(() => {
        let isActive = true;
        const localUserId = currentUserId;
        let hasConnected = false;
        let recovering = false;
        let reconnectDelayMs = 1_000;
        let reconnectTimer: ReturnType<typeof setTimeout> | null = null;

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

            const subscribingChannel = supabase
                .channel(`threads_changes_${localUserId}`)
                .on('postgres_changes', {
                    event: '*',
                    schema: 'public',
                    table: 'threads',
                    filter: `user_id=eq.${localUserId}`,
                }, (payload) => {
                    if (!isActive || channelRef.current !== subscribingChannel) return;
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
                });
            channelRef.current = subscribingChannel;
            subscribingChannel.subscribe((status) => {
                    if (!isActive || channelRef.current !== subscribingChannel) return;
                    if (status === 'SUBSCRIBED') {
                        const isReconnect = hasConnected;
                        hasConnected = true;
                        reconnectDelayMs = 1_000;
                        if (isReconnect && !recovering) {
                            recovering = true;
                            realtimeOverridesRef.current.clear();
                            void loadThreadsPaged(localUserId, () => isActive).finally(() => {
                                recovering = false;
                            });
                        }
                    }
                    if (status === 'CHANNEL_ERROR') {
                        console.error('[useThreads] Realtime channel error');
                    }
                    if (status === 'CLOSED') {
                        channelRef.current = null;
                        if (reconnectTimer) clearTimeout(reconnectTimer);
                        const delay = reconnectDelayMs;
                        reconnectDelayMs = Math.min(reconnectDelayMs * 2, 30_000);
                        reconnectTimer = setTimeout(() => {
                            reconnectTimer = null;
                            if (isActive && navigator.onLine) subscribeRealtime();
                        }, delay);
                    }
                });
        };

        const fetchThreads = async () => {
            if (!localUserId) {
                if (isActive) {
                    backfillRunRef.current += 1;
                    nextCursorRef.current = null;
                    loadMorePromiseRef.current = null;
                    setThreads([]);
                    setHasMoreThreads(false);
                    setIsLoadingThreads(false);
                    setThreadsError(null);
                    setLoadMoreError(null);
                }
                return;
            }
            // The first page is the useful startup result. Older pages are fetched
            // after it has rendered so they do not delay the sidebar or realtime.
            await loadThreadsPaged(localUserId, () => isActive);
        };

        // The shell supplies the server-resolved user and owns auth changes.
        // Start the first page immediately instead of repeating an Auth request.
        if (realtimeUserIdRef.current !== localUserId) {
            realtimeOverridesRef.current.clear();
            realtimeUserIdRef.current = localUserId;
            setThreads([]);
        }
        subscribeRealtime();
        void fetchThreads();

        const handleRefresh = () => void fetchThreads();
        const handleVisibilityChange = () => {
            if (isActive && localUserId && document.visibilityState === 'visible') {
                void fetchThreads();
            }
        };
        const handleOnline = () => {
            if (!isActive || !localUserId) return;
            if (reconnectTimer) clearTimeout(reconnectTimer);
            reconnectTimer = null;
            if (!channelRef.current) subscribeRealtime();
            void fetchThreads();
        };
        const handleOffline = () => {
            if (!isActive || !localUserId || channelRef.current) return;
            if (reconnectTimer) clearTimeout(reconnectTimer);
            reconnectTimer = null;
        };
        window.addEventListener(REFRESH_THREADS_EVENT, handleRefresh);
        document.addEventListener('visibilitychange', handleVisibilityChange);
        window.addEventListener('online', handleOnline);
        window.addEventListener('offline', handleOffline);

        return () => {
            isActive = false;
            backfillRunRef.current += 1;
            document.removeEventListener('visibilitychange', handleVisibilityChange);
            unsubscribeRealtime();
            window.removeEventListener(REFRESH_THREADS_EVENT, handleRefresh);
            window.removeEventListener('online', handleOnline);
            window.removeEventListener('offline', handleOffline);
            if (reconnectTimer) clearTimeout(reconnectTimer);
        };
    }, [supabase, loadThreadsPaged, currentUserId]);

    const retryLoadMoreThreads = useCallback(() => loadMoreThreads(true), [loadMoreThreads]);

    return {
        threads,
        refreshThreads,
        loadMoreThreads,
        retryLoadMoreThreads,
        hasMoreThreads,
        isLoadingThreads,
        threadsError,
        loadMoreError,
    };
}

export function useThread(id: string | null, initialThread?: Thread) {
    const [threadState, setThreadState] = useState<{ id: string | null; thread?: Thread }>(() => ({
        id,
        ...(initialThread?.id === id ? { thread: initialThread } : {}),
    }));
    const [supabase] = useState(() => createClient());

    useEffect(() => {
        if (!id) {
            setThreadState({ id: null });
            return;
        }

        // The chat route already loads this row on the server. Reuse that
        // result instead of issuing the same SELECT again after hydration.
        // Scope it to the requested ID so a route transition never exposes
        // the previous chat while the next row is loading.
        if (initialThread?.id === id) {
            setThreadState((previous) => previous.id === id && previous.thread === initialThread
                ? previous
                : { id, thread: initialThread });
            return;
        }

        let cancelled = false;
        setThreadState({ id });
        const fetchThread = async () => {
            try {
                const { data, error } = await supabase
                    .from('threads')
                    .select(THREAD_SELECT_COLUMNS)
                    .eq('id', id)
                    .single();
                if (cancelled) return;
                if (error) {
                    console.error('[useThread] Error fetching thread:', error);
                    return;
                }
                if (data) setThreadState({ id, thread: mapThreadRowToThread(data) });
            } catch (error) {
                if (!cancelled) console.error('[useThread] Unexpected error fetching thread:', error);
            }
        };
        void fetchThread();
        return () => { cancelled = true; };
    }, [id, initialThread, supabase]);

    return threadState.id === id ? threadState.thread : initialThread?.id === id ? initialThread : undefined;
}
