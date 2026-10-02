import { QueryClient } from '@tanstack/react-query';

type Row = {
    id: string;
    thread_id: string;
    role: 'user' | 'assistant';
    content: string;
    attachments: unknown[];
    reasoning: null;
    model_id: null;
    reply_stats: null;
    created_at: string;
    deleted_at: null;
};

declare global {
    interface Window {
        __searchSeed?: Row[];
        __messageSearchHistory: {
            rows: Row[];
            pageRequests: Array<{ cursor: string | null; limit: number }>;
            searchRequests: Array<{ threadId: string | null; columns: string | null; pattern: string | null; limit: number }>;
            pauseNextOlderPage: boolean;
            pendingOlderPage: (() => void) | null;
            pauseOlderOnce: () => void;
            releaseOlderPage: () => void;
        };
        messageSearchHarness: {
            snapshot: { ids: string[]; selectedId: string | null; loadingOlder: boolean };
            openSearch: () => void;
            closeSearch: () => void;
            scrollToBottom: () => void;
        };
    }
}

const threadId = '22222222-2222-4222-8222-222222222222';
const state = window.__messageSearchHistory = {
    rows: (window.__searchSeed ?? []).map(row => ({ ...row })),
    pageRequests: [],
    searchRequests: [],
    pauseNextOlderPage: false,
    pendingOlderPage: null,
    pauseOlderOnce() { this.pauseNextOlderPage = true; },
    releaseOlderPage() { this.pendingOlderPage?.(); this.pendingOlderPage = null; },
};

class Query implements PromiseLike<{ data: Row[]; error: null }> {
    cursor: string | null = null;
    pageLimit = 100;
    threadFilter: string | null = null;
    ilikePattern: string | null = null;
    selectedColumns: string | null = null;

    select(columns: string) { this.selectedColumns = columns; return this; }
    eq(column: string, value: string) { if (column === 'thread_id') this.threadFilter = value; return this; }
    is() { return this; }
    order() { return this; }
    limit(value: number) { this.pageLimit = value; return this; }
    or(value: string) { this.cursor = value; return this; }
    ilike(_column: string, pattern: string) { this.ilikePattern = pattern; return this; }
    abortSignal() { return this; }

    then<TResult1 = { data: Row[]; error: null }, TResult2 = never>(
        onfulfilled?: ((value: { data: Row[]; error: null }) => TResult1 | PromiseLike<TResult1>) | null,
        onrejected?: ((reason: unknown) => TResult2 | PromiseLike<TResult2>) | null,
    ): PromiseLike<TResult1 | TResult2> {
        if (this.ilikePattern !== null) {
            state.searchRequests.push({ threadId: this.threadFilter, columns: this.selectedColumns, pattern: this.ilikePattern, limit: this.pageLimit });
            const term = this.ilikePattern.replace(/^%|%$/g, '').replaceAll('\\%', '%').replaceAll('\\_', '_').replaceAll('\\\\', '\\').toLowerCase();
            const data = state.rows
                .filter(row => row.thread_id === this.threadFilter && row.deleted_at === null && row.content.toLowerCase().includes(term))
                .sort((a, b) => b.created_at.localeCompare(a.created_at) || b.id.localeCompare(a.id))
                .slice(0, this.pageLimit)
                .map(row => ({ ...row }));
            return Promise.resolve({ data, error: null }).then(onfulfilled, onrejected);
        }

        state.pageRequests.push({ cursor: this.cursor, limit: this.pageLimit });
        const cursorMatch = this.cursor?.match(/^created_at\.lt\."(.*)",and\(created_at\.eq\."(.*)",id\.lt\.([0-9a-f-]+)\)$/i);
        const rows = state.rows
            .filter(row => row.thread_id === threadId && row.deleted_at === null)
            .filter(row => {
                if (!cursorMatch) return true;
                const [, olderThan, equals, cursorId] = cursorMatch;
                return row.created_at < olderThan! || (row.created_at === equals && row.id < cursorId!);
            })
            .sort((a, b) => b.created_at.localeCompare(a.created_at) || b.id.localeCompare(a.id))
            .slice(0, this.pageLimit)
            .map(row => ({ ...row }));
        const result = { data: rows, error: null };
        if (this.cursor && state.pauseNextOlderPage) {
            state.pauseNextOlderPage = false;
            return new Promise<typeof result>(resolve => { state.pendingOlderPage = () => resolve(result); }).then(onfulfilled, onrejected);
        }
        return Promise.resolve(result).then(onfulfilled, onrejected);
    }
}

const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: 0, gcTime: 60_000, refetchOnWindowFocus: false } } });
export function getQueryClient() { return queryClient; }
export function getMessagesQueryKey(id: string) { return ['messages', id] as const; }
export const MESSAGE_QUERY_KEY_PREFIX = 'messages';
export function createClient() {
    return {
        from: () => new Query(),
        channel: () => {
            const channel = {
                on() { return channel; },
                subscribe(callback: (status: string) => void) { queueMicrotask(() => callback('SUBSCRIBED')); return channel; },
            };
            return channel;
        },
        removeChannel: () => Promise.resolve('ok'),
    };
}
