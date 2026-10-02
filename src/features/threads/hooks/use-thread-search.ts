'use client';

import { useCallback, useEffect, useRef, useState } from 'react';

import { createClient } from '@/shared/lib/supabase/client';
import type { Thread } from '@/shared/contracts/thread';
import { mapThreadRowToThread, THREAD_SELECT_COLUMNS, THREADS_PAGE_SIZE } from '../lib/thread-model';
import { mergeThreadPages, threadCursorFromPage, threadCursorPostgrestFilter, type ThreadCursor } from '../lib/thread-pagination';

interface SearchState {
    key: string;
    threads: Thread[];
    hasMore: boolean;
    loading: boolean;
    error: string | null;
    paginationError: string | null;
}

function escapeLikePattern(value: string) {
    return value.replace(/[\\%_]/g, '\\$&');
}

export function useThreadSearch(userId: string | null, query: string) {
    const [supabase] = useState(() => createClient());
    const [state, setState] = useState<SearchState>({ key: '', threads: [], hasMore: false, loading: false, error: null, paginationError: null });
    const generationRef = useRef(0);
    const cursorRef = useRef<ThreadCursor | null>(null);
    const loadMorePromiseRef = useRef<Promise<void> | null>(null);
    const [retryVersion, setRetryVersion] = useState(0);
    const term = query.trim();
    const key = userId && term ? `${userId}\u0000${term}` : '';

    const fetchPage = useCallback(async (id: string, searchTerm: string, cursor: ThreadCursor | null) => {
        let request = supabase
            .from('threads')
            .select(THREAD_SELECT_COLUMNS)
            .eq('user_id', id)
            .ilike('title', `%${escapeLikePattern(searchTerm)}%`);
        if (cursor) {
            const filter = threadCursorPostgrestFilter(cursor);
            if (!filter) throw new Error('Invalid search cursor');
            request = request.or(filter);
        }
        return request
            .order('updated_at', { ascending: false })
            .order('id', { ascending: false })
            .limit(THREADS_PAGE_SIZE);
    }, [supabase]);

    useEffect(() => {
        const generation = ++generationRef.current;
        cursorRef.current = null;
        loadMorePromiseRef.current = null;
        if (!userId || !term) return;
        setState((previous) => ({
            key,
            threads: previous.key === key ? previous.threads : [],
            hasMore: false,
            loading: true,
            error: null,
            paginationError: null,
        }));

        void (async () => {
            try {
                const { data, error } = await fetchPage(userId, term, null);
                if (generation !== generationRef.current) return;
                if (error) {
                    console.error('[threads] Search failed:', error);
                    setState((previous) => previous.key === key
                        ? { ...previous, loading: false, error: 'Search could not be completed. Try again.' }
                        : { key, threads: [], hasMore: false, loading: false, error: 'Search could not be completed. Try again.', paginationError: null });
                    return;
                }
                const rows = data ?? [];
                cursorRef.current = threadCursorFromPage(rows.map(mapThreadRowToThread));
                setState({
                    key,
                    threads: rows.map(mapThreadRowToThread),
                    hasMore: rows.length === THREADS_PAGE_SIZE,
                    loading: false,
                    error: null,
                    paginationError: null,
                });
            } catch (error) {
                if (generation !== generationRef.current) return;
                console.error('[threads] Unexpected error searching threads:', error);
                setState((previous) => previous.key === key
                    ? { ...previous, loading: false, error: 'Search could not be completed. Try again.' }
                    : { key, threads: [], hasMore: false, loading: false, error: 'Search could not be completed. Try again.', paginationError: null });
            }
        })();
        return () => { generationRef.current += 1; };
    }, [userId, term, key, fetchPage, retryVersion]);

    const loadMore = useCallback((retry = false) => {
        if (loadMorePromiseRef.current) return loadMorePromiseRef.current;
        if (!userId || !term || state.key !== key || !state.hasMore || (state.paginationError && !retry)) return Promise.resolve();
        setState((previous) => previous.key === key ? { ...previous, paginationError: null } : previous);
        const generation = generationRef.current;
        const cursor = cursorRef.current;
        const promise = Promise.resolve().then(async () => {
            try {
                const { data, error } = await fetchPage(userId, term, cursor);
                if (generation !== generationRef.current) return;
                if (error) {
                    console.error('[threads] Search pagination failed:', error);
                    setState((previous) => previous.key === key
                        ? { ...previous, paginationError: 'Could not load more matching conversations.' }
                        : previous);
                    return;
                }
                const rows = data ?? [];
                if (rows.length > 0) cursorRef.current = threadCursorFromPage(rows.map(mapThreadRowToThread));
                setState((previous) => previous.key === key ? {
                    key,
                    threads: mergeThreadPages(previous.threads, rows.map(mapThreadRowToThread)),
                    hasMore: rows.length === THREADS_PAGE_SIZE,
                    loading: false,
                    error: null,
                    paginationError: null,
                } : previous);
            } catch (error) {
                if (generation === generationRef.current) {
                    console.error('[threads] Unexpected error paginating search:', error);
                    setState((previous) => previous.key === key
                        ? { ...previous, paginationError: 'Could not load more matching conversations.' }
                        : previous);
                }
            } finally {
                if (loadMorePromiseRef.current === promise) loadMorePromiseRef.current = null;
            }
        });
        loadMorePromiseRef.current = promise;
        return promise;
    }, [userId, term, key, state.key, state.hasMore, state.paginationError, fetchPage]);

    const retrySearch = useCallback(() => setRetryVersion((version) => version + 1), []);
    const retryLoadMore = useCallback(() => loadMore(true), [loadMore]);

    return {
        threads: state.key === key ? state.threads : [],
        hasMore: state.key === key && state.hasMore,
        loading: Boolean(key) && (state.key !== key || state.loading),
        error: state.key === key ? state.error : null,
        paginationError: state.key === key ? state.paginationError : null,
        loadMore,
        retrySearch,
        retryLoadMore,
    };
}
