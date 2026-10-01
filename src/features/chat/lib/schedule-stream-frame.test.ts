import assert from 'node:assert/strict';
import test from 'node:test';
import { scheduleStreamFrame } from './schedule-stream-frame';

test('streaming frames still flush when a background tab suspends animation callbacks', (t) => {
    const originalFrame = globalThis.requestAnimationFrame;
    const originalCancel = globalThis.cancelAnimationFrame;
    let frameCallback!: FrameRequestCallback;
    let cancelledFrames = 0;
    globalThis.requestAnimationFrame = (callback) => { frameCallback = callback; return 1; };
    globalThis.cancelAnimationFrame = () => { cancelledFrames += 1; };
    t.mock.timers.enable({ apis: ['setTimeout'] });
    try {
        let flushes = 0;
        const cancel = scheduleStreamFrame(() => { flushes += 1; });
        t.mock.timers.tick(50);
        assert.equal(flushes, 1);
        assert.equal(cancelledFrames, 1);
        frameCallback(100);
        assert.equal(flushes, 1, 'a late animation callback must not publish twice');
        cancel();
    } finally {
        globalThis.requestAnimationFrame = originalFrame;
        globalThis.cancelAnimationFrame = originalCancel;
    }
});

test('disposing a streaming frame cancels both scheduling paths', (t) => {
    t.mock.timers.enable({ apis: ['setTimeout'] });
    let flushes = 0;
    scheduleStreamFrame(() => { flushes += 1; })();
    t.mock.timers.tick(100);
    assert.equal(flushes, 0);
});
