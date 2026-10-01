'use client';

import { useCallback, useEffect, useRef, useState } from 'react';

import { createClient } from '@/shared/lib/supabase/client';
import type { Thread } from '@/shared/contracts/thread';
import { mapThreadRowToThread, THREAD_SELECT_COLUMNS, THREADS_PAGE_SIZE } from '../lib/thread-model';

interface SearchState {
    key: string;
    threads: Thread[];
    hasMore: boolean;
    loading: boolean;
}

function escapeLikePattern(value: string) {
    return value.replace(/[\\%_]/g, '\\$&');
}

export function useThreadSearch(userId: string | null, query: string) {
    const [supabase] = useState(() => createClient());
    const [state, setState] = useState<SearchState>({ key: '', threads: [], hasMore: false, loading: false });
    const generationRef = useRef(0);
    const offsetRef = useRef(0);
    const loadMorePromiseRef = useRef<Promise<void> | null>(null);
    const term = query.trim();
    const key = userId && term ? `${userId}\u0000${term}` : '';

    const fetchPage = useCallback(async (id: string, searchTerm: string, offset: number) => {
        return supabase
            .from('threads')
            .select(THREAD_SELECT_COLUMNS)
            .eq('user_id', id)
            .ilike('title', `%${escapeLikePattern(searchTerm)}%`)
            .order('updated_at', { ascending: false })
            .order('id', { ascending: false })
            .range(offset, offset + THREADS_PAGE_SIZE - 1);
    }, [supabase]);

    useEffect(() => {
        const generation = ++generationRef.current;
        offsetRef.current = 0;
        loadMorePromiseRef.current = null;
        if (!userId || !term) return;

        void (async () => {
            const { data, error } = await fetchPage(userId, term, 0);
            if (generation !== generationRef.current) return;
            if (error) {
                console.error('[threads] Search failed:', error);
                setState({ key, threads: [], hasMore: false, loading: false });
                return;
            }
            const rows = data ?? [];
            offsetRef.current = rows.length;
            setState({
                key,
                threads: rows.map(mapThreadRowToThread),
                hasMore: rows.length === THREADS_PAGE_SIZE,
                loading: false,
            });
        })();
        return () => { generationRef.current += 1; };
    }, [userId, term, key, fetchPage]);

    const loadMore = useCallback(() => {
        if (loadMorePromiseRef.current) return loadMorePromiseRef.current;
        if (!userId || !term || state.key !== key || !state.hasMore) return Promise.resolve();
        const generation = generationRef.current;
        const offset = offsetRef.current;
        const promise = Promise.resolve().then(async () => {
            try {
                const { data, error } = await fetchPage(userId, term, offset);
                if (generation !== generationRef.current) return;
                if (error) {
                    console.error('[threads] Search pagination failed:', error);
                    return;
                }
                const rows = data ?? [];
                offsetRef.current += rows.length;
                setState((previous) => previous.key === key ? {
                    key,
                    threads: [...previous.threads, ...rows.map(mapThreadRowToThread)],
                    hasMore: rows.length === THREADS_PAGE_SIZE,
                    loading: false,
                } : previous);
            } finally {
                if (loadMorePromiseRef.current === promise) loadMorePromiseRef.current = null;
            }
        });
        loadMorePromiseRef.current = promise;
        return promise;
    }, [userId, term, key, state.key, state.hasMore, fetchPage]);

    return {
        threads: state.key === key ? state.threads : [],
        hasMore: state.key === key && state.hasMore,
        loading: Boolean(key) && state.key !== key,
        loadMore,
    };
}
