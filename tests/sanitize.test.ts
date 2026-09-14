import { test } from 'node:test';
import assert from 'node:assert';
import { sanitizeThreadTitle } from '../src/features/threads/lib/sanitize-thread-title';

test('sanitizeThreadTitle normalizes user input', () => {
    assert.strictEqual(sanitizeThreadTitle('   <Hello>\u0000\u200B   World   '), 'Hello World');
    assert.strictEqual(sanitizeThreadTitle(''), 'New Chat');
});
