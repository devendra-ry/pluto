import { afterEach, beforeEach, describe, mock, test } from 'node:test';
import assert from 'node:assert';

import { type ChatMessage } from '@/shared/core/types';
import { chatService } from './chat-service';

function createSseStream(events: string[]) {
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

describe('ChatService', () => {
    let fetchMock: any;

    beforeEach(() => {
        fetchMock = mock.method(global, 'fetch');
    });

    afterEach(() => {
        mock.reset();
    });

    test('generateImageOrVideo returns correct result', async () => {
        fetchMock.mock.mockImplementation(async () => ({
            ok: true,
            json: async () => ({
                attachment: {
                    id: '123',
                    name: 'test.png',
                    mimeType: 'image/png',
                    size: 100,
                    path: 'path/to/test.png',
                    url: 'http://example.com/test.png',
                },
                revisedPrompt: 'revised prompt',
                operation: 'generate',
            })
        }));

        const result = await chatService.generateImageOrVideo({
            threadId: 't1',
            model: 'm1',
            prompt: 'p1',
            attachments: [],
            isVideo: false,
        });

        assert.strictEqual(result.attachment.id, '123');
        assert.ok(result.content.includes('Generated image.'));
        assert.ok(result.content.includes('revised prompt'));
    });

    test('streamChat parses AI SDK text/reasoning/usage chunks', async () => {
        const stream = createSseStream([
            '{"type":"start"}',
            '{"type":"start-step"}',
            '{"type":"reasoning-start","id":"reasoning-1"}',
            '{"type":"reasoning-delta","id":"reasoning-1","delta":"Thinking"}',
            '{"type":"text-start","id":"text-1"}',
            '{"type":"text-delta","id":"text-1","delta":"Hello"}',
            '{"type":"data-usage","data":{"inputTokens":12,"outputTokens":8,"totalTokens":20}}',
            '{"type":"text-end","id":"text-1"}',
            '{"type":"finish-step"}',
            '{"type":"finish","finishReason":"stop"}',
        ]);

        fetchMock.mock.mockImplementation(async () => ({ ok: true, body: stream }));

        const chunks: Array<Record<string, unknown>> = [];
        for await (const chunk of chatService.streamChat({
            messages: [],
            model: 'm1',
            reasoningEffort: 'low',
            search: false,
        })) {
            chunks.push(chunk as Record<string, unknown>);
        }

        assert.strictEqual(chunks.length, 3);
        assert.deepStrictEqual(chunks[0], { type: 'reasoning', value: 'Thinking' });
        assert.deepStrictEqual(chunks[1], { type: 'content', value: 'Hello' });
        assert.deepStrictEqual(chunks[2], {
            type: 'usage',
            value: {
                outputTokens: 8,
                inputTokens: 12,
                totalTokens: 20,
                source: 'provider',
            }
        });
    });

    test('streamChat infers output tokens when completion tokens are missing', async () => {
        const stream = createSseStream([
            '{"type":"text-delta","id":"text-1","delta":"Hello"}',
            '{"type":"data-usage","data":{"prompt_tokens":18,"completion_tokens":null,"total_tokens":31}}',
        ]);

        fetchMock.mock.mockImplementation(async () => ({ ok: true, body: stream }));

        const chunks: Array<Record<string, unknown>> = [];
        for await (const chunk of chatService.streamChat({
            messages: [],
            model: 'm1',
            reasoningEffort: 'low',
            search: false,
        })) {
            chunks.push(chunk as Record<string, unknown>);
        }

        assert.strictEqual(chunks.length, 2);
        assert.deepStrictEqual(chunks[0], { type: 'content', value: 'Hello' });
        assert.deepStrictEqual(chunks[1], {
            type: 'usage',
            value: {
                outputTokens: 13,
                inputTokens: 18,
                totalTokens: 31,
                source: 'provider',
            }
        });
    });

    test('streamChat parses OpenRouter top-level usage payload fields', async () => {
        const stream = createSseStream([
            '{"type":"data-usage","data":{"tokens_prompt":19,"tokens_completion":1649,"native_tokens_prompt":25,"native_tokens_completion":1617}}',
        ]);

        fetchMock.mock.mockImplementation(async () => ({ ok: true, body: stream }));

        const chunks: Array<Record<string, unknown>> = [];
        for await (const chunk of chatService.streamChat({
            messages: [],
            model: 'm1',
            reasoningEffort: 'low',
            search: false,
        })) {
            chunks.push(chunk as Record<string, unknown>);
        }

        assert.strictEqual(chunks.length, 1);
        assert.deepStrictEqual(chunks[0], {
            type: 'usage',
            value: {
                outputTokens: 1649,
                inputTokens: 19,
                totalTokens: undefined,
                source: 'provider',
            }
        });
    });

    test('streamChat propagates stream error chunks', async () => {
        const stream = createSseStream([
            '{"type":"text-delta","id":"text-1","delta":"Hello"}',
            '{"type":"error","errorText":"Upstream failure"}',
        ]);

        fetchMock.mock.mockImplementation(async () => ({ ok: true, body: stream }));

        try {
            for await (const _ of chatService.streamChat({
                messages: [],
                model: 'm1',
                reasoningEffort: 'low',
                search: false,
            })) {
                // no-op
            }
            assert.fail('Should have thrown error');
        } catch (error: any) {
            assert.strictEqual(error.message, 'Upstream failure');
        }
    });

    test('streamChat sends idempotency header and mapped body', async () => {
        const stream = createSseStream(['{"type":"text-delta","id":"text-1","delta":"Hello"}']);
        let capturedInit: RequestInit | undefined;

        fetchMock.mock.mockImplementation(async (_url: string, init: RequestInit) => {
            capturedInit = init;
            return { ok: true, body: stream };
        });

        const inputMessages: ChatMessage[] = [
            { role: 'user', content: 'hello', attachments: [] },
        ];
        const chunks: Array<Record<string, unknown>> = [];
        for await (const chunk of chatService.streamChat({
            messages: inputMessages,
            model: 'm-test',
            reasoningEffort: 'high',
            systemPrompt: 'be precise',
            search: true,
        })) {
            chunks.push(chunk as Record<string, unknown>);
        }

        assert.strictEqual(chunks.length, 1);
        const headers = new Headers(capturedInit?.headers as HeadersInit);
        const idempotencyKey = headers.get('X-Idempotency-Key');
        assert.ok(typeof idempotencyKey === 'string' && idempotencyKey.length > 0);
        const body = JSON.parse(String(capturedInit?.body)) as Record<string, unknown>;
        assert.deepStrictEqual(body, {
            messages: inputMessages,
            model: 'm-test',
            reasoningEffort: 'high',
            systemPrompt: 'be precise',
            search: true,
        });
    });

    test('streamChat surfaces non-2xx JSON errors', async () => {
        fetchMock.mock.mockImplementation(async () => ({
            ok: false,
            text: async () => JSON.stringify({ error: 'Internal Server Error' }),
        }));

        try {
            for await (const _ of chatService.streamChat({
                messages: [],
                model: 'm1',
                reasoningEffort: 'low',
                search: false,
            })) {
                // no-op
            }
            assert.fail('Should have thrown error');
        } catch (error: any) {
            assert.strictEqual(error.message, 'Internal Server Error');
        }
    });
});
