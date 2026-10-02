import assert from 'node:assert/strict';
import test from 'node:test';
import { selectChatInputFiles } from './chat-input-policy';

function file(name: string, size: number): File {
    return new File([new Uint8Array(size)], name, { type: 'text/plain' });
}

test('file selection does not charge bytes for rejected oversized files', () => {
    const tooLarge = file('too-large.txt', 11);
    const small = file('small.txt', 4);
    const selection = selectChatInputFiles([tooLarge, small], {
        maxFileBytes: 10,
        maxTotalBytes: 10,
    });

    assert.deepEqual(selection.accepted, [small]);
    assert.deepEqual(selection.rejected, [{ file: tooLarge, reason: 'individual-size' }]);
    assert.equal(selection.acceptedBytes, 4);
});

test('file selection preserves order and continues after total-size rejection', () => {
    const first = file('first.txt', 6);
    const tooMuch = file('too-much.txt', 5);
    const fits = file('fits.txt', 4);
    const selection = selectChatInputFiles([first, tooMuch, fits], {
        maxCount: 3,
        maxFileBytes: 10,
        maxTotalBytes: 10,
    });

    assert.deepEqual(selection.accepted, [first, fits]);
    assert.deepEqual(selection.rejected, [{ file: tooMuch, reason: 'total-size' }]);
    assert.equal(selection.acceptedBytes, 10);
});

test('file selection reports count limits independently of byte limits', () => {
    const one = file('one.txt', 1);
    const two = file('two.txt', 1);
    const selection = selectChatInputFiles([one, two], {
        currentCount: 1,
        currentBytes: 2,
        maxCount: 2,
        maxFileBytes: 10,
        maxTotalBytes: 10,
    });

    assert.deepEqual(selection.accepted, [one]);
    assert.deepEqual(selection.rejected, [{ file: two, reason: 'count' }]);
    assert.equal(selection.acceptedBytes, 1);
});
