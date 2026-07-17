import assert from 'node:assert/strict';
import test from 'node:test';

import {
    getText,
    normalizePotentialBase64,
    readStringOrFirst,
    toBoundedInteger,
    toBoundedNumber,
} from './media-utils';

test('normalizes provider text and base64 fields', () => {
    assert.equal(getText(' value '), 'value');
    assert.equal(getText(42), '');
    assert.equal(normalizePotentialBase64('data:image/png;base64, YWJj '), 'YWJj');
    assert.equal(readStringOrFirst(['first', 'second']), 'first');
});

test('bounds numeric provider options', () => {
    assert.equal(toBoundedInteger(20.7, 10, 1, 20), 20);
    assert.equal(toBoundedInteger('20', 10, 1, 20), 10);
    assert.equal(toBoundedNumber(-2, 1, 0, 5), 0);
    assert.equal(toBoundedNumber(Number.NaN, 1, 0, 5), 1);
});
