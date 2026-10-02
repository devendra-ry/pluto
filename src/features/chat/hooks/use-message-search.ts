'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { createClient } from '@/shared/lib/supabase/client';
import { useDebouncedValue } from '@/shared/hooks/use-debounce';
import { escapeMessageSearchPattern } from '../lib/message-search';

const MESSAGE_SEARCH_COLUMNS = 'id,thread_id,role,content,created_at';

export interface MessageSearchResult {
    id: string;
    thread_id: string;
    role: 'user' | 'assistant';
    content: string;
    created_at: string;
}

interface SearchState {
    key: string;
    results: MessageSearchResult[];
    loading: boolean;
    error: string | null;
}

export function useMessageSearch(threadId: string, isOpen: boolean) {
    const [supabase] = useState(() => createClient());
    const [query, setQuery] = useState('');
    const term = useDebouncedValue(query.trim(), 250);
    const key = useMemo(() => isOpen && term.length >= 2 ? `${threadId}\u0000${term}` : '', [isOpen, term, threadId]);
    const [state, setState] = useState<SearchState>({ key: '', results: [], loading: false, error: null });
    const generationRef = useRef(0);
    const [retryVersion, setRetryVersion] = useState(0);

    useEffect(() => {
        const generation = ++generationRef.current;
        if (!key) {
            setState({ key: '', results: [], loading: false, error: null });
            return;
        }

        const controller = new AbortController();
        setState({ key, results: [], loading: true, error: null });
        void (async () => {
            try {
                const { data, error } = await supabase
                    .from('messages')
                    .select(MESSAGE_SEARCH_COLUMNS)
                    .eq('thread_id', threadId)
                    .is('deleted_at', null)
                    .ilike('content', `%${escapeMessageSearchPattern(term)}%`)
                    .order('created_at', { ascending: false })
                    .order('id', { ascending: false })
                    .limit(20)
                    .abortSignal(controller.signal);
                if (generation !== generationRef.current) return;
                if (error) {
                    setState({ key, results: [], loading: false, error: 'Message search failed. Try again.' });
                    return;
                }
                const results: MessageSearchResult[] = (data ?? []).flatMap(row => (
                    (row.role === 'user' || row.role === 'assistant')
                        ? [{ id: row.id, thread_id: row.thread_id, role: row.role, content: row.content ?? '', created_at: row.created_at }]
                        : []
                ));
                setState({ key, results, loading: false, error: null });
            } catch {
                if (generation === generationRef.current && !controller.signal.aborted) {
                    setState({ key, results: [], loading: false, error: 'Message search failed. Try again.' });
                }
            }
        })();
        return () => {
            controller.abort();
            generationRef.current += 1;
        };
    }, [key, retryVersion, supabase, term, threadId]);

    return {
        query,
        setQuery,
        results: state.key === key ? state.results : [],
        loading: Boolean(key) && (state.key !== key || state.loading),
        error: state.key === key ? state.error : null,
        retry: () => setRetryVersion(version => version + 1),
    };
}
