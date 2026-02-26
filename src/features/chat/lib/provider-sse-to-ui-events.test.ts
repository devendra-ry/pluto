import { describe, test } from 'node:test';
import assert from 'node:assert';

import { parseProviderSseToUiEvents } from './provider-sse-to-ui-events';

function createProviderSseStream(events: string[]) {
    const encoder = new TextEncoder();
    return new ReadableStream({
        start(controller) {
            for (const event of events) {
                controller.enqueue(encoder.encode(`data: ${event}\n\n`));
            }
            controller.enqueue(encoder.encode('data: [DONE]\n\n'));
            controller.close();
        }
    });
}

describe('parseProviderSseToUiEvents', () => {
    test('parses content/reasoning/usage from provider SSE payloads', async () => {
        const stream = createProviderSseStream([
            '{"choices":[{"delta":{"reasoning_content":"Thinking"}}]}',
            '{"choices":[{"delta":{"content":"Hello"}}]}',
            '{"usage":{"prompt_tokens":12,"completion_tokens":8,"total_tokens":20}}',
        ]);

        const events: Array<Record<string, unknown>> = [];
        for await (const event of parseProviderSseToUiEvents({
            sourceStream: stream,
            needsThinkTagTransform: false,
        })) {
            events.push(event as Record<string, unknown>);
        }

        assert.deepStrictEqual(events, [
            { reasoningDelta: 'Thinking' },
            { contentDelta: 'Hello' },
            {
                usage: {
                    outputTokens: 8,
                    inputTokens: 12,
                    totalTokens: 20,
                    source: 'provider',
                }
            },
        ]);
    });

    test('emits normalized provider errors', async () => {
        const stream = createProviderSseStream([
            '{"error":"Upstream error","details":"bad gateway"}',
        ]);

        const events: Array<Record<string, unknown>> = [];
        for await (const event of parseProviderSseToUiEvents({
            sourceStream: stream,
            needsThinkTagTransform: false,
        })) {
            events.push(event as Record<string, unknown>);
        }

        assert.deepStrictEqual(events, [
            { errorText: 'Upstream error: bad gateway' },
        ]);
    });

    test('transforms <think> tags into reasoning deltas when enabled', async () => {
        const stream = createProviderSseStream([
            '{"choices":[{"delta":{"content":"Hello <think>reason</think> world"}}]}',
        ]);

        const events: Array<Record<string, unknown>> = [];
        for await (const event of parseProviderSseToUiEvents({
            sourceStream: stream,
            needsThinkTagTransform: true,
        })) {
            events.push(event as Record<string, unknown>);
        }

        assert.deepStrictEqual(events, [
            { reasoningDelta: 'reason' },
            { contentDelta: 'Hello  world' },
        ]);
    });
});
