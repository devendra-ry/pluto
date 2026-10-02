import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database } from '@/shared/lib/supabase/database.types';
import { canonicalMessageAttachments, loadMessagePage, MESSAGE_PAGE_SIZE, messageCursorFilter } from './load-thread-messages';
import { mapMessageRowToMessage, type MessageRow } from './message-helpers';

const id = (value: number) => `00000000-0000-4000-8000-${String(value).padStart(12, '0')}`;
function row(value: number): MessageRow {
    return { id: id(value), thread_id: id(999), role: value % 2 ? 'user' : 'assistant', content: `Message ${value}`,
        created_at: '2026-10-02T10:00:00.123456+00:00', deleted_at: null, attachments: [], reasoning: null, model_id: null, reply_stats: null };
}
function client(rows: MessageRow[]) {
    const calls: Array<{ limit?: number; cursor?: string; orders: string[] }> = [];
    const fake = { from: (table: string) => {
        assert.equal(table, 'messages');
        const call: typeof calls[number] = { orders: [] }; calls.push(call);
        let selectedId: string | null = null;
        const result = () => {
            let result = [...rows].sort((a, b) => b.created_at.localeCompare(a.created_at) || b.id.localeCompare(a.id));
            if (call.cursor) {
                const match = call.cursor.match(/created_at\.lt\."([^"]+)",and\(created_at\.eq\."[^"]+",id\.lt\.([\da-f-]+)\)/)!;
                assert.ok(match);
                result = result.filter(row => row.created_at < match[1]! || row.created_at === match[1] && row.id < match[2]!);
            }
            return { data: result.slice(0, call.limit), error: null };
        };
        const builder = {
            select: () => builder,
            eq: (column: string, value: string) => { if (column === 'id') selectedId = value; return builder; },
            is: () => builder,
            order: (column: string, options: { ascending: boolean }) => { assert.equal(options.ascending, false); call.orders.push(column); return builder; },
            limit: (value: number) => { call.limit = value; return builder; },
            or: (value: string) => { call.cursor = value; return builder; },
            abortSignal: () => builder,
            single: async () => ({ data: rows.find(row => row.id === selectedId), error: null }),
            then: (resolve: (value: ReturnType<typeof result>) => unknown) => Promise.resolve(result()).then(resolve),
        };
        return builder;
    }, get storage() { throw new Error('History must not sign or download attachments'); } };
    return { supabase: fake as unknown as SupabaseClient<Database>, calls };
}

test('recent pages are bounded, chronological, and load attachments without a storage waterfall', async () => {
    const rows = Array.from({ length: 120 }, (_, index) => row(index + 1));
    rows[119]!.attachments = [{ id: id(1), name: 'image.png', mimeType: 'image/png', size: 123, path: 'user/file.png', url: 'https://expired.example/file' }];
    const fake = client(rows);
    const first = await loadMessagePage(fake.supabase, id(999));
    assert.equal(first.messages.length, MESSAGE_PAGE_SIZE);
    assert.equal(first.messages[0]!.id, id(71));
    assert.equal(first.messages.at(-1)!.id, id(120));
    assert.equal(fake.calls[0]!.limit, 51);
    assert.deepEqual(fake.calls[0]!.orders, ['created_at', 'id']);
    assert.match(first.messages.at(-1)!.attachments![0]!.url, /^\/api\/uploads\?/);
    const older = await loadMessagePage(fake.supabase, id(999), first.olderCursor);
    assert.equal(older.messages[0]!.id, id(21));
    assert.equal(older.messages.at(-1)!.id, id(70));
    assert.equal(new Set([...first.messages, ...older.messages].map(row => row.id)).size, 100);
});

test('cursor validation preserves microseconds and rejects filter injection', () => {
    assert.match(messageCursorFilter({ id: id(1), createdAt: row(1).created_at }), /\.123456\+00:00/);
    assert.throws(() => messageCursorFilter({ id: 'id),deleted_at.is.null', createdAt: row(1).created_at }));
    assert.throws(() => messageCursorFilter({ id: id(1), createdAt: '2026-10-02T10:00:00Z",id.gt.anything' }));
});

test('branched attachments authorize through the surviving branch without reusing expired signed URLs', () => {
    const parentId = id(111);
    const branchId = id(222);
    const message = canonicalMessageAttachments(mapMessageRowToMessage({
        ...row(1), thread_id: branchId, attachments: [{
            id: id(7), name: 'image.png', mimeType: 'image/png', size: 100,
            path: `${id(333)}/${parentId}/image.png`, url: 'https://expired.example/image.png',
        }],
    }));
    const url = new URL(message.attachments![0]!.url, 'http://localhost');
    assert.equal(url.searchParams.get('threadId'), branchId);
    assert.equal(url.searchParams.get('path'), `${id(333)}/${parentId}/image.png`);
});
