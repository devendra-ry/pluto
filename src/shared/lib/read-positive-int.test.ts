import assert from 'node:assert/strict';
import test from 'node:test';

import { readPositiveInt } from './read-positive-int';

test('readPositiveInt accepts positive decimal integers with surrounding whitespace', () => {
    assert.equal(readPositiveInt(' 120 ', 10), 120);
});

test('readPositiveInt falls back for malformed, non-positive, and unsafe values', () => {
    for (const value of [undefined, '', '0', '-3', '1.5', '12ms', '1e3', '9007199254740992']) {
        assert.equal(readPositiveInt(value, 10), 10, `expected fallback for ${String(value)}`);
    }
});
