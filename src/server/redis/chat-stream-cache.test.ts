import { describe, test } from 'node:test';
import assert from 'node:assert';

import { buildSseReplayResponse } from './chat-stream-replay';

function eventBytes(event: string) {
    return new TextEncoder().encode(`data: ${event}\n\n`).byteLength;
}

describe('buildSseReplayResponse', () => {
    test('replays from byte offset boundary', async () => {
        const events = [
            '{"type":"text-delta","id":"text-1","delta":"Hello"}',
            '{"type":"text-delta","id":"text-1","delta":" world"}',
        ];
        const offset = eventBytes(events[0]);

        const response = buildSseReplayResponse(events, offset);
        const body = await response.text();

        assert.ok(body.includes(`data: ${events[1]}\n\n`));
        assert.ok(!body.includes(`data: ${events[0]}\n\n`));
        assert.ok(body.endsWith('data: [DONE]\n\n'));
    });
});
