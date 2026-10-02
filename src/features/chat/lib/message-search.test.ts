import assert from 'node:assert/strict';
import test from 'node:test';
import { createMessageSearchSnippet, escapeMessageSearchPattern } from './message-search';

test('escapes PostgREST ilike wildcard characters in a message search term', () => {
    assert.equal(escapeMessageSearchPattern('100%_done\\'), '100\\%\\_done\\\\');
});

test('creates a bounded context snippet and labels attachment-only messages', () => {
    const content = `before ${'x'.repeat(70)} target phrase ${'y'.repeat(70)} after`;
    const snippet = createMessageSearchSnippet(content, 'target phrase', 60);
    assert.ok(snippet.length <= 62);
    assert.match(snippet, /target phrase/);
    assert.match(snippet, /^…/);
    assert.equal(createMessageSearchSnippet('  ', 'target'), 'Message contains attachments');
});
