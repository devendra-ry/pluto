import { describe, test } from 'node:test';
import assert from 'node:assert';

import { buildSseReplayResponse } from './chat-stream-replay';
import { getCachedChatStreamEvents } from './chat-stream-cache';
import type { Redis } from '@upstash/redis';

function eventBytes(event: string) {
    return new TextEncoder().encode(`data: ${event}\n\n`).byteLength;
}

describe('buildSseReplayResponse', () => {
    test('replays from byte offset boundary', async () => {
        const events = [
            '{"type":"text-delta","id":"text-1","delta":"Hello"}',
            '{"type":"text-delta","id":"text-1","delta":" world"}',
        ];
        const offset = eventBytes(events[0] ?? '');

        const response = buildSseReplayResponse(events, offset);
        const body = await response.text();

        assert.ok(body.includes(`data: ${events[1]}\n\n`));
        assert.ok(!body.includes(`data: ${events[0]}\n\n`));
    });

    test('does not fabricate [DONE] for incomplete streams', async () => {
        const events = ['{"type":"text-delta","delta":"partial"}'];

        const response = buildSseReplayResponse(events, 0);
        const body = await response.text();

        assert.ok(!body.includes('[DONE]'));
        assert.ok(body.endsWith(`data: ${events[0]}\n\n`));
    });

});

describe('getCachedChatStreamEvents', () => {
    test('reads and unpacks a hit with one XRANGE call', async () => {
        let xrangeCalls = 0;
        const redis = {
            async xrange(key: string, start: string, end: string) {
                xrangeCalls += 1;
                assert.equal(key, 'pluto:chat-stream:user-1:stream-1');
                assert.equal(start, '-');
                assert.equal(end, '+');
                return {
                    '1-0': { e: '{"type":"delta"}\x1e[DONE]' },
                };
            },
            async xlen() {
                assert.fail('cache reads must not issue a separate XLEN request');
            },
        } as unknown as Redis;

        const result = await getCachedChatStreamEvents('user-1', 'stream-1', redis);

        assert.deepEqual(result, { events: ['{"type":"delta"}', '[DONE]'] });
        assert.equal(xrangeCalls, 1);
    });

    test('treats an empty XRANGE result as a cache miss with one request', async () => {
        let xrangeCalls = 0;
        const redis = {
            async xrange() {
                xrangeCalls += 1;
                return {};
            },
            async xlen() {
                assert.fail('cache reads must not issue a separate XLEN request');
            },
        } as unknown as Redis;

        const result = await getCachedChatStreamEvents('user-1', 'missing-stream', redis);

        assert.equal(result, null);
        assert.equal(xrangeCalls, 1);
    });

    test('keeps incomplete cached streams incomplete for the caller to reject', async () => {
        const redis = {
            async xrange() {
                return { '1-0': { e: '{"type":"delta"}' } };
            },
        } as unknown as Redis;

        const result = await getCachedChatStreamEvents('user-1', 'incomplete-stream', redis);

        assert.deepEqual(result, { events: ['{"type":"delta"}'] });
        assert.notEqual(result?.events.at(-1), '[DONE]');
    });
});
