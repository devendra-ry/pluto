import { QueryClient } from '@tanstack/react-query';

type MessageRow = {
    id: string;
    thread_id: string;
    role: 'user' | 'assistant';
    content: string;
    attachments: unknown[];
    reasoning: string | null;
    model_id: string | null;
    reply_stats: null;
    created_at: string;
    deleted_at: string | null;
};
type QueryRequest = { cursor: string | null; limit: number };
type PendingPage = { resolve: () => void };

declare global {
    interface Window {
        __messageSeed?: MessageRow[];
        __messageMock: {
            rows: MessageRow[];
            requests: QueryRequest[];
            failNextOlderPage: boolean;
            pauseNextOlderPage: boolean;
            pendingOlderPage: PendingPage | null;
            statusHandlers: Array<(status: string) => void>;
            channelCount: () => number;
            realtimeHandlers: Array<(payload: { eventType: string; new: Partial<MessageRow>; old: Partial<MessageRow> }) => void>;
            failOlderOnce: () => void;
            pauseOlderOnce: () => void;
            releaseOlderPage: () => void;
            setStatus: (status: string) => void;
            insertWithoutRealtime: (row: MessageRow) => void;
            emitInsert: (row: MessageRow) => void;
        };
    }
}

const threadId = '22222222-2222-4222-8222-222222222222';

class MessageQuery implements PromiseLike<{ data: MessageRow[] | null; error: { message: string } | null }> {
    cursor: string | null = null;
    pageLimit = 100;

    select() { return this; }
    eq() { return this; }
    is() { return this; }
    order() { return this; }
    limit(value: number) { this.pageLimit = value; return this; }
    or(value: string) { this.cursor = value; return this; }
    abortSignal() { return this; }

    then<TResult1 = { data: MessageRow[] | null; error: { message: string } | null }, TResult2 = never>(
        onfulfilled?: ((value: { data: MessageRow[] | null; error: { message: string } | null }) => TResult1 | PromiseLike<TResult1>) | null,
        onrejected?: ((reason: unknown) => TResult2 | PromiseLike<TResult2>) | null,
    ): PromiseLike<TResult1 | TResult2> {
        const mock = window.__messageMock;
        mock.requests.push({ cursor: this.cursor, limit: this.pageLimit });
        if (this.cursor && mock.failNextOlderPage) {
            mock.failNextOlderPage = false;
            return Promise.resolve({ data: null, error: { message: 'injected older page error' } }).then(onfulfilled, onrejected);
        }
        const rows = mock.rows
            .filter((row) => row.thread_id === threadId && row.deleted_at === null)
            .filter((row) => {
                if (!this.cursor) return true;
                const match = this.cursor.match(/^created_at\.lt\."(.*)",and\(created_at\.eq\."(.*)",id\.lt\.([0-9a-f-]+)\)$/i);
                if (!match) return true;
                const [, olderThan, equals, cursorId] = match;
                return row.created_at < olderThan! || (row.created_at === equals && row.id < cursorId!);
            })
            .sort((a, b) => b.created_at.localeCompare(a.created_at) || b.id.localeCompare(a.id))
            .slice(0, this.pageLimit)
            .map((row) => ({ ...row }));
        const result = { data: rows, error: null };
        if (this.cursor && mock.pauseNextOlderPage) {
            mock.pauseNextOlderPage = false;
            return new Promise<typeof result>((resolve) => {
                mock.pendingOlderPage = { resolve: () => resolve(result) };
            }).then(onfulfilled, onrejected);
        }
        return Promise.resolve(result).then(onfulfilled, onrejected);
    }
}

const mock: Window['__messageMock'] = window.__messageMock = {
    rows: (window.__messageSeed ?? []).map((row) => ({ ...row })),
    requests: [],
    failNextOlderPage: false,
    pauseNextOlderPage: false,
    pendingOlderPage: null,
    statusHandlers: [],
    realtimeHandlers: [],
    channelCount() { return this.statusHandlers.length; },
    failOlderOnce() { this.failNextOlderPage = true; },
    pauseOlderOnce() { this.pauseNextOlderPage = true; },
    releaseOlderPage() { this.pendingOlderPage?.resolve(); this.pendingOlderPage = null; },
    setStatus(status) { for (const handler of this.statusHandlers) handler(status); },
    insertWithoutRealtime(row) { this.rows.push({ ...row }); },
    emitInsert(row) {
        this.rows.push({ ...row });
        for (const handler of this.realtimeHandlers) handler({ eventType: 'INSERT', new: row, old: {} });
    },
};

const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false, staleTime: 0, gcTime: 60_000, refetchOnWindowFocus: false } },
});

export function getQueryClient() { return queryClient; }
export function getMessagesQueryKey(id: string) { return ['messages', id] as const; }
export const MESSAGE_QUERY_KEY_PREFIX = 'messages';

export function createClient() {
    return {
        from: () => new MessageQuery(),
        channel: () => {
            const channel = {
                on(_event: string, _filter: unknown, callback: (payload: { eventType: string; new: Partial<MessageRow>; old: Partial<MessageRow> }) => void) {
                    mock.realtimeHandlers.push(callback);
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
