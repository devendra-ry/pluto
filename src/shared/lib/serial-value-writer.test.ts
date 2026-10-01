import assert from 'node:assert/strict';
import test from 'node:test';
import { SerialValueWriter } from './serial-value-writer';

test('settings writes preserve selection order and recover after rejection', async () => {
    const writer = new SerialValueWriter('original');
    const calls: string[] = [];
    let rejectFirst!: (error: Error) => void;
    const first = writer.write('first', value => {
        calls.push(value);
        return new Promise<void>((_, reject) => { rejectFirst = reject; });
    });
    const second = writer.write('second', async value => { calls.push(value); });
    await Promise.resolve();
    assert.deepEqual(calls, ['first']);
    assert.equal(writer.synchronize('stale-server-value'), false);
    rejectFirst(new Error('offline'));
    const firstResult = await first;
    assert.equal(firstResult.ok, false);
    assert.equal(writer.isLatest(firstResult.revision), false);
    assert.equal((await second).ok, true);
    assert.deepEqual(calls, ['first', 'second']);
    const failed = await writer.write('third', async () => { throw new Error('offline'); });
    assert.equal(failed.ok, false);
    assert.equal(failed.value, 'second');
});

test('consecutive failed settings changes roll back to the saved value', async () => {
    const writer = new SerialValueWriter('saved');
    const fail = async () => { throw new Error('offline'); };
    const results = await Promise.all([writer.write('a', fail), writer.write('b', fail)]);
    assert.deepEqual(results.map(result => result.value), ['saved', 'saved']);
    assert.equal(writer.isLatest(results[1].revision), true);
});

test('independent settings writers do not block each other', async () => {
    const slow = new SerialValueWriter('a');
    const fast = new SerialValueWriter('b');
    let finish!: () => void;
    const pending = slow.write('later', () => new Promise<void>(resolve => { finish = resolve; }));
    const completed = await fast.write('now', async () => {});
    assert.equal(completed.ok, true);
    finish();
    await pending;
});
