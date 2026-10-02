import { createRoot } from 'react-dom/client';
import { useLayoutEffect, useState } from 'react';
import { useThreadSearch } from '../../../src/features/threads/hooks/use-thread-search';
import { useThreads } from '../../../src/features/threads/hooks/use-threads';
import type {} from './thread-pagination-supabase-mock';

declare global {
    interface Window {
        threadPaginationHarness: {
            setSearch: (value: string) => void;
            loadMoreThreads: () => Promise<boolean>;
            loadMoreSearch: () => Promise<void>;
            retryLoadMoreThreads: () => Promise<boolean>;
            retryLoadMoreSearch: () => Promise<void>;
            snapshot: {
                threadIds: string[];
                threadTimes: Record<string, string>;
                hasMoreThreads: boolean;
                loadMoreError: string | null;
                searchIds: string[];
                searchHasMore: boolean;
                searchError: string | null;
            };
        };
    }
}

function Harness() {
    const [search, setSearch] = useState('');
    const threads = useThreads('11111111-1111-4111-8111-111111111111');
    const searchResults = useThreadSearch('11111111-1111-4111-8111-111111111111', search);
    useLayoutEffect(() => {
        window.threadPaginationHarness = {
            setSearch,
            loadMoreThreads: threads.loadMoreThreads,
            loadMoreSearch: searchResults.loadMore,
            retryLoadMoreThreads: threads.retryLoadMoreThreads,
            retryLoadMoreSearch: searchResults.retryLoadMore,
            snapshot: {
                threadIds: threads.threads.map((thread) => thread.id),
                threadTimes: Object.fromEntries(threads.threads.map((thread) => [thread.id, thread.updated_at])),
                hasMoreThreads: threads.hasMoreThreads,
                loadMoreError: threads.loadMoreError,
                searchIds: searchResults.threads.map((thread) => thread.id),
                searchHasMore: searchResults.hasMore,
                searchError: searchResults.paginationError,
            },
        };
    }, [
        setSearch,
        threads.loadMoreThreads,
        threads.retryLoadMoreThreads,
        threads.threads,
        threads.hasMoreThreads,
        threads.loadMoreError,
        searchResults.loadMore,
        searchResults.retryLoadMore,
        searchResults.threads,
        searchResults.hasMore,
        searchResults.paginationError,
    ]);
    return <main><p>Threads: {threads.threads.length}</p><p>Search: {searchResults.threads.length}</p></main>;
}

createRoot(document.getElementById('root')!).render(<Harness />);
