type ThreadRow = {
    id: string;
    title: string;
    model: string;
    reasoning_effort: null;
    system_prompt: null;
    is_pinned: boolean;
    created_at: string;
    updated_at: string;
    user_id: string;
};

declare global {
    interface Window {
        __threadPrefetchPausedIds?: string[];
        __threadPrefetchMock: {
            requests: Array<{ table: string; columns: string | null; id: string | null }>;
            pause: (id: string) => void;
            release: (id: string) => void;
        };
    }
}

const requests: Window['__threadPrefetchMock']['requests'] = [];
const pausedIds = new Set<string>(window.__threadPrefetchPausedIds ?? []);
const pending = new Map<string, (result: { data: ThreadRow; error: null }) => void>();

function makeRow(id: string): ThreadRow {
    return {
        id,
        title: `Fetched ${id.slice(0, 4)}`,
        model: 'gemini-2.5-flash',
        reasoning_effort: null,
        system_prompt: null,
        is_pinned: false,
        created_at: '2026-10-02T00:00:00.000Z',
        updated_at: '2026-10-02T00:00:00.000Z',
        user_id: '11111111-1111-4111-8111-111111111111',
    };
}

class Query {
    private columns: string | null = null;
    private id: string | null = null;

    constructor(private readonly table: string) {}

    select(columns: string) { this.columns = columns; return this; }

    eq(column: string, value: string) {
        if (column === 'id') this.id = value;
        return this;
    }

    single() {
        const id = this.id ?? '';
        requests.push({ table: this.table, columns: this.columns, id });
        if (pausedIds.has(id)) {
            return new Promise<{ data: ThreadRow; error: null }>(resolve => pending.set(id, resolve));
        }
        return Promise.resolve({ data: makeRow(id), error: null });
    }
}

window.__threadPrefetchMock = {
    requests,
    pause(id) { pausedIds.add(id); },
    release(id) {
        pausedIds.delete(id);
        pending.get(id)?.({ data: makeRow(id), error: null });
        pending.delete(id);
    },
};

export function createClient() {
    return { from: (table: string) => new Query(table) };
}
