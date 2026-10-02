import assert from 'node:assert/strict';
import test from 'node:test';

import { isValidThreadCursor, mergeThreadPages, reconcileThreadPage, threadCursorFromPage, threadCursorPostgrestFilter } from './thread-pagination';

const row = (id: string, updated_at: string, title = id) => ({ id, updated_at, title });
const timestamp = '2026-10-02T09:10:11.123Z';
const uuidA = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const uuidB = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';

test('thread pagination makes a stable composite cursor for tied timestamps', () => {
    const rows = [row(uuidB, timestamp), row(uuidA, timestamp)];
    assert.deepEqual(threadCursorFromPage(rows), { updated_at: timestamp, id: uuidA });
    assert.equal(
        threadCursorPostgrestFilter({ updated_at: timestamp, id: uuidA }),
        `updated_at.lt.${timestamp},and(updated_at.eq.${timestamp},id.lt.${uuidA})`,
    );
});

test('thread cursor filters reject PostgREST grammar injection and malformed values', () => {
    assert.equal(isValidThreadCursor({ updated_at: `${timestamp},id.lt.00000000`, id: uuidA }), false);
    assert.equal(isValidThreadCursor({ updated_at: timestamp, id: `${uuidA}),or(id.eq.${uuidB}` }), false);
    assert.equal(isValidThreadCursor({ updated_at: 'not-a-time', id: uuidA }), false);
    assert.equal(isValidThreadCursor({ updated_at: timestamp, id: 'not-a-uuid' }), false);
    assert.equal(threadCursorPostgrestFilter({ updated_at: `${timestamp}),or(id.eq.${uuidB}`, id: uuidA }), null);
});

test('search page merges replace duplicate rows and remain in cursor order', () => {
    const merged = mergeThreadPages(
        [row(uuidB, '2026-10-02T10:00:00Z', 'old B'), row(uuidA, '2026-10-02T09:00:00Z')],
        [row(uuidB, '2026-10-02T10:00:00Z', 'fresh B'), row('cccccccc-cccc-4ccc-8ccc-cccccccccccc', '2026-10-02T08:00:00Z')],
    );
    assert.deepEqual(merged.map(({ id, title }) => [id, title]), [
        [uuidB, 'fresh B'],
        [uuidA, uuidA],
        ['cccccccc-cccc-4ccc-8ccc-cccccccccccc', 'cccccccc-cccc-4ccc-8ccc-cccccccccccc'],
    ]);
});

test('realtime updates and deletions reconcile over a stale query page', () => {
    const older = row(uuidA, '2026-10-02T08:00:00Z', 'stale title');
    const deletedId = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';
    const inserted = row(uuidB, '2026-10-02T11:00:00Z', 'live title');
    const reconciled = reconcileThreadPage(
        [older, row(deletedId, timestamp)],
        new Map([[uuidA, { ...older, updated_at: timestamp, title: 'live title' }], [deletedId, null], [uuidB, inserted]]),
    );
    assert.deepEqual(reconciled.map(({ id, title }) => [id, title]), [
        [uuidB, 'live title'],
        [uuidA, 'live title'],
    ]);
});
