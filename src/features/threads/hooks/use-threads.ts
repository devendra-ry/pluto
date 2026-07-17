'use client';

import { useCallback, useEffect, useRef, useState } from 'react';

import { REFRESH_THREADS_EVENT } from '@/features/threads/lib/thread-events';
import {
    mapThreadRowToThread,
    mergeThreadsSorted,
    THREAD_SELECT_COLUMNS,
    THREADS_PAGE_SIZE,
    toThread,
    upsertThreadSorted,
} from '@/features/threads/lib/thread-model';
import type { Thread } from '@/shared/contracts/thread';
import { createClient } from '@/utils/supabase/client';

export type { Thread } from '@/shared/contracts/thread';

export function useThreads() {
    const [threads, setThreads] = useState<Thread[]>([]);
    const [currentUserId, setCurrentUserId] = useState<string | null>(null);
    const channelRef = useRef<ReturnType<ReturnType<typeof createClient>['channel']> | null>(null);
    const backfillRunRef = useRef(0);
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
            if (firstPage.length < THREADS_PAGE_SIZE) return;

            let offset = THREADS_PAGE_SIZE;
            while (isCurrentRun()) {
                const next = await fetchThreadsPage(userId, offset);
                if (!isCurrentRun()) return;
                if (next.error) {
                    console.error('[useThreads] Error fetching threads page:', next.error);
                    return;
                }

                const page = (next.data ?? []).map(mapThreadRowToThread);
                if (page.length === 0) return;
                setThreads((previous) => mergeThreadsSorted(previous, page));
                if (page.length < THREADS_PAGE_SIZE) return;
                offset += THREADS_PAGE_SIZE;
            }
        } catch (error) {
            if (!isCurrentRun()) return;
            console.error('[useThreads] Unexpected error in loadThreadsPaged:', error);
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
            if (!channelRef.current) return;
            supabase.removeChannel(channelRef.current);
            channelRef.current = null;
        };

        const subscribeRealtime = () => {
            if (!isActive || !localUserId || channelRef.current) return;

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
                            setThreads((previous) => previous.filter((thread) => thread.id !== deletedId));
                        }
                        return;
                    }

                    const nextThread = toThread(payload.new);
                    if (nextThread) {
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
                if (isActive) setThreads([]);
                return;
            }
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
            await fetchThreads();
            if (!isActive) return;
            unsubscribeRealtime();
            subscribeRealtime();
        };

        void setup();

        const { data: { subscription: authSubscription } } = supabase.auth.onAuthStateChange(
            (_event, session) => {
                if (!isActive) return;
                localUserId = session?.user?.id ?? null;
                setCurrentUserId(localUserId);
                if (localUserId) void fetchThreads();
                else {
                    setThreads([]);
                    unsubscribeRealtime();
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

    return { threads, refreshThreads };
}

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
        void fetchThread();
    }, [id, supabase]);

    return thread;
}
