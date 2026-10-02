type ThreadRow = {
    id: string;
    title: string;
    model: string;
    reasoning_effort: string | null;
    system_prompt: string | null;
    is_pinned: boolean;
    created_at: string;
    updated_at: string;
    user_id: string;
};
type QueryRequest = { cursor: string | null; search: string | null; limit: number };
type QueryResult = { data: ThreadRow[] | null; error: { message: string } | null };
type PendingRequest = { resolve: () => void };

declare global {
    interface Window {
        __threadSeed?: ThreadRow[];
        __threadMock: {
            rows: ThreadRow[];
            requests: QueryRequest[];
            failNextPage: boolean;
            pauseNextPage: boolean;
            pauseSearchTerm: string | null;
            pendingRequest: PendingRequest | null;
            pendingSearches: Array<{ term: string; resolve: () => void }>;
            forcedNextPage: ThreadRow[] | null;
            realtimeHandlers: Array<(payload: { eventType: string; old: Partial<ThreadRow>; new: Partial<ThreadRow> }) => void>;
            statusHandlers: Array<(status: string) => void>;
            channelHandlers: Array<Array<(payload: { eventType: string; old: Partial<ThreadRow>; new: Partial<ThreadRow> }) => void>>;
            channelCount: () => number;
            setStatus: (status: string) => void;
            failPaginationOnce: () => void;
            pausePaginationOnce: () => void;
            pauseSearchOnce: (term: string) => void;
            releasePagination: () => void;
            releaseSearch: (term: string) => void;
            forceNextPage: (rows: ThreadRow[]) => void;
            emitUpdate: (row: ThreadRow) => void;
            insertWithoutRealtime: (row: ThreadRow) => void;
            emitUpdateOnChannel: (channelIndex: number, row: ThreadRow) => void;
            emitDelete: (id: string) => void;
        };
    }
}

function compareRows(a: ThreadRow, b: ThreadRow) {
    return b.updated_at.localeCompare(a.updated_at) || b.id.localeCompare(a.id);
}

class Query implements PromiseLike<QueryResult> {
    cursor: string | null = null;
    search: string | null = null;
    pageLimit = 100;

    select() { return this; }
    eq() { return this; }
    order() { return this; }
    or(filter: string) { this.cursor = filter; return this; }
    ilike(_column: string, value: string) { this.search = value.replace(/^%|%$/g, '').replace(/\\([\\%_])/g, '$1'); return this; }
    limit(value: number) { this.pageLimit = value; return this; }

    private result(): QueryResult {
        const rows = window.__threadMock.rows
            .filter((row) => !this.search || row.title.toLowerCase().includes(this.search.toLowerCase()))
            .filter((row) => {
                if (!this.cursor) return true;
                const match = this.cursor.match(/^updated_at\.lt\.(.*),and\(updated_at\.eq\.(.*),id\.lt\.([0-9a-f-]+)\)$/i);
                if (!match) return true;
                const [, lessThan, equals, cursorId] = match;
                return row.updated_at < lessThan! || (row.updated_at === equals && row.id < cursorId!);
            })
            .sort(compareRows);
        return { data: rows.slice(0, this.pageLimit).map((row) => ({ ...row })), error: null };
    }

    then<TResult1 = QueryResult, TResult2 = never>(
        onfulfilled?: ((value: QueryResult) => TResult1 | PromiseLike<TResult1>) | null,
        onrejected?: ((reason: unknown) => TResult2 | PromiseLike<TResult2>) | null,
    ): PromiseLike<TResult1 | TResult2> {
        const mock = window.__threadMock;
        mock.requests.push({ cursor: this.cursor, search: this.search, limit: this.pageLimit });
        let result = this.result();
        if (this.cursor && mock.failNextPage) {
            mock.failNextPage = false;
            result = { data: null, error: { message: 'injected page failure' } };
        } else if (this.cursor && this.search && mock.forcedNextPage) {
            result = { data: mock.forcedNextPage.map((row) => ({ ...row })), error: null };
            mock.forcedNextPage = null;
        }
        if (this.cursor && mock.pauseNextPage) {
            mock.pauseNextPage = false;
            const snapshot = result;
            return new Promise<QueryResult>((resolve) => {
                mock.pendingRequest = { resolve: () => resolve(snapshot) };
            }).then(onfulfilled, onrejected);
        }
        if (this.search && mock.pauseSearchTerm === this.search) {
            const term = mock.pauseSearchTerm;
            mock.pauseSearchTerm = null;
            const snapshot = result;
            return new Promise<QueryResult>((resolve) => {
                mock.pendingSearches.push({ term, resolve: () => resolve(snapshot) });
            }).then(onfulfilled, onrejected);
        }
        return Promise.resolve(result).then(onfulfilled, onrejected);
    }
}

const mock: Window['__threadMock'] = window.__threadMock = {
    rows: (window.__threadSeed ?? []).map((row) => ({ ...row })),
    requests: [],
    failNextPage: false,
    pauseNextPage: false,
    pauseSearchTerm: null,
    pendingRequest: null,
    pendingSearches: [],
    forcedNextPage: null,
    realtimeHandlers: [],
    statusHandlers: [],
    channelHandlers: [],
    channelCount() { return this.statusHandlers.length; },
    setStatus(status) { for (const handler of this.statusHandlers) handler(status); },
    failPaginationOnce() { this.failNextPage = true; },
    pausePaginationOnce() { this.pauseNextPage = true; },
    pauseSearchOnce(term) { this.pauseSearchTerm = term; },
    releasePagination() { this.pendingRequest?.resolve(); this.pendingRequest = null; },
    releaseSearch(term) {
        const pending = this.pendingSearches.find((request) => request.term === term);
        pending?.resolve();
        this.pendingSearches = this.pendingSearches.filter((request) => request.term !== term);
    },
    forceNextPage(rows) { this.forcedNextPage = rows; },
    emitUpdate(row) {
        const index = this.rows.findIndex((candidate) => candidate.id === row.id);
        if (index >= 0) this.rows[index] = { ...row };
        for (const handler of this.realtimeHandlers) handler({ eventType: 'UPDATE', old: {}, new: row });
    },
    insertWithoutRealtime(row) { this.rows.push({ ...row }); },
    emitUpdateOnChannel(channelIndex, row) {
        for (const handler of this.channelHandlers[channelIndex] ?? []) handler({ eventType: 'UPDATE', old: {}, new: row });
    },
    emitDelete(id) {
        this.rows = this.rows.filter((row) => row.id !== id);
        for (const handler of this.realtimeHandlers) handler({ eventType: 'DELETE', old: { id }, new: {} });
    },
};

export function createClient() {
    return {
        from: () => new Query(),
        channel: () => {
            const channelIndex = mock.channelHandlers.length;
            const channelRealtimeHandlers: typeof mock.realtimeHandlers = [];
            mock.channelHandlers.push(channelRealtimeHandlers);
            const channel = {
                on(_event: string, _filter: unknown, callback: (payload: { eventType: string; old: Partial<ThreadRow>; new: Partial<ThreadRow> }) => void) {
                    mock.realtimeHandlers.push(callback);
                    channelRealtimeHandlers.push(callback);
                    return channel;
                },
                subscribe(callback: (status: string) => void) {
                    mock.statusHandlers.push(callback);
                    queueMicrotask(() => callback('SUBSCRIBED'));
                    return channel;
                },
            };
            return channel;
        },
        removeChannel: () => Promise.resolve('ok'),
    };
}
