import assert from 'node:assert/strict';
import { test } from 'node:test';
import { flattenMessagePages, updateMessagePages, type MessagePages } from './message-pages';
import { type Message } from './message-helpers';

const message = (id: string, content = id): Message => ({ id, content, role: 'user', thread_id: 'thread', created_at: `2026-10-02T10:00:0${id}Z` });
test('realtime/optimistic changes preserve older-page boundaries and newer duplicate versions', () => {
    const cursor = { id: '1', createdAt: '2026-10-02T10:00:01Z' };
    const data: MessagePages = { pageParams: [null, cursor], pages: [
        { messages: [message('2', 'latest'), message('3')], olderCursor: cursor },
        { messages: [message('1'), message('2', 'stale')], olderCursor: null },
    ] };
    assert.deepEqual(flattenMessagePages(data).map(row => row.content), ['1', 'latest', '3']);
    const changed = updateMessagePages(data, messages => messages.filter(row => row.id !== '2'))!;
    assert.deepEqual(flattenMessagePages(changed).map(row => row.id), ['1', '3']);
    assert.deepEqual(changed.pageParams, data.pageParams);
    assert.equal(changed.pages[0]!.olderCursor, cursor);
    assert.equal(changed.pages[1]!.olderCursor, null);
});

test('a single ordered window retains its reference and ignores no-op mutations', () => {
    const messages = [message('1'), message('2')];
    const data: MessagePages = { pageParams: [null], pages: [{ messages, olderCursor: null }] };
    assert.equal(flattenMessagePages(data), messages);
    assert.equal(updateMessagePages(data, current => current), data);
});
