import assert from 'node:assert/strict';
import { test } from 'node:test';

import { normalizeEditableThreadTitle } from './thread-model';

test('normalizes titles entered in the rename dialog', () => {
    assert.equal(normalizeEditableThreadTitle('   '), null);
    assert.equal(normalizeEditableThreadTitle('  Plan\n  the launch  '), 'Plan the launch');
    assert.equal(normalizeEditableThreadTitle('A <bold> title'), 'A bold title');
    assert.equal(normalizeEditableThreadTitle('x'.repeat(51)), `${'x'.repeat(50)}...`);
});
