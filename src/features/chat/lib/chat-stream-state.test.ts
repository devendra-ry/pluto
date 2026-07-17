import assert from 'node:assert/strict';
import test from 'node:test';

import {
    INITIAL_STREAM_STATE,
    areStatsEqual,
    estimateOutputTokens,
    streamReducer,
} from './chat-stream-state';

test('stream state follows the request lifecycle', () => {
    const preparing = streamReducer(INITIAL_STREAM_STATE, { type: 'SET_LOADING', loading: true });
    const requesting = streamReducer(preparing, { type: 'BEGIN', messageId: 'message-1', thinking: true });
    const streaming = streamReducer(requesting, { type: 'STREAMING' });
    const persisting = streamReducer(streaming, { type: 'PERSISTING' });
    const complete = streamReducer(persisting, { type: 'COMPLETE', failed: false });

    assert.equal(preparing.phase, 'preparing');
    assert.deepEqual(requesting, { phase: 'requesting', isThinking: true, activeUserMessageId: 'message-1', lastRequestFailed: false });
    assert.equal(streaming.phase, 'streaming');
    assert.equal(persisting.phase, 'persisting');
    assert.deepEqual(complete, INITIAL_STREAM_STATE);
});

test('idle state ignores invalid streaming transitions', () => {
    assert.equal(streamReducer(INITIAL_STREAM_STATE, { type: 'STREAMING' }), INITIAL_STREAM_STATE);
    assert.equal(streamReducer(INITIAL_STREAM_STATE, { type: 'PERSISTING' }), INITIAL_STREAM_STATE);
});

test('token estimation and stats equality are deterministic', () => {
    assert.equal(estimateOutputTokens('', ''), 0);
    assert.equal(estimateOutputTokens('1234567', ''), 2);
    const stats = { outputTokens: 2, seconds: 1, tokensPerSecond: 2, source: 'estimated' as const };
    assert.equal(areStatsEqual(stats, { ...stats }), true);
    assert.equal(areStatsEqual(stats, { ...stats, outputTokens: 3 }), false);
});
