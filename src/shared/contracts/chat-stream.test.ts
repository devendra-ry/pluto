import assert from 'node:assert/strict';
import test from 'node:test';

import { parseChatStreamPayload, serializeChatStreamEvent } from './chat-stream';

test('parses canonical compact delta shapes', () => {
    assert.deepEqual(parseChatStreamPayload({ c: 'answer' }), {
        type: 'delta', content: 'answer', reasoning: '',
    });
    assert.deepEqual(parseChatStreamPayload({ r: 'thought' }), {
        type: 'delta', content: '', reasoning: 'thought',
    });
    assert.deepEqual(parseChatStreamPayload({ c: '', r: 'thought', provider: 'model' }), {
        type: 'delta', content: '', reasoning: 'thought',
    });
});

test('preserves usage, error, and legacy-choice precedence over compact delta fields', () => {
    assert.deepEqual(parseChatStreamPayload({ meta: 'usage', usage: { outputTokens: 7 }, c: 'ignored' }), {
        type: 'usage', usage: { outputTokens: 7 },
    });
    assert.deepEqual(parseChatStreamPayload({ error: 'failed', c: 'ignored' }), {
        type: 'error', message: 'failed',
    });
    assert.deepEqual(parseChatStreamPayload({ choices: [{ delta: { content: 'legacy' } }], c: 'ignored' }), {
        type: 'delta', content: 'legacy', reasoning: '',
    });
});

test('routes malformed special fields through schema validation', () => {
    // An invalid usage marker falls through to the normal text-delta schema.
    assert.deepEqual(parseChatStreamPayload({ meta: 'usage', usage: null, c: 'answer' }), {
        type: 'delta', content: 'answer', reasoning: '',
    });
    // A malformed canonical field must not bypass the direct-delta schema.
    assert.equal(parseChatStreamPayload({ c: 42, r: 'thought' }), null);
});

test('preserves reasoning token aliases through usage serialization and parsing', () => {
    const serialized = serializeChatStreamEvent({
        type: 'usage',
        usage: {
            source: 'provider',
            outputTokens: 8,
            reasoningTokens: 5,
            thoughtsTokenCount: 5,
        },
    });
    assert.deepEqual(parseChatStreamPayload(JSON.parse(serialized)), {
        type: 'usage',
        usage: {
            source: 'provider',
            outputTokens: 8,
            reasoningTokens: 5,
            thoughtsTokenCount: 5,
        },
    });
});
