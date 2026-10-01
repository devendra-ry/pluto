import assert from 'node:assert/strict';
import test from 'node:test';

import { FrameCoalescer } from './frame-coalescer';

test('FrameCoalescer batches requests and flushes latest state immediately at completion', () => {
    const scheduled: Array<() => void> = [];
    let flushes = 0;
    const coalescer = new FrameCoalescer(() => { flushes += 1; }, (callback) => scheduled.push(callback));

    coalescer.request();
    coalescer.request();
    coalescer.request();
    assert.equal(scheduled.length, 1);
    assert.equal(flushes, 0);

    coalescer.flushNow();
    assert.equal(flushes, 1);
    scheduled[0]?.();
    assert.equal(flushes, 1, 'the invalidated frame must not flush stale state');

    coalescer.request();
    assert.equal(scheduled.length, 2);
    scheduled[1]?.();
    assert.equal(flushes, 2);

    coalescer.request();
    coalescer.close();
    scheduled[2]?.();
    assert.equal(flushes, 2, 'closing must suppress callbacks still queued at stream teardown');
});
