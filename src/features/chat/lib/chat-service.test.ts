import { test, describe, beforeEach, afterEach, mock } from 'node:test';
import assert from 'node:assert';
import { chatService } from './chat-service';

describe('ChatService', () => {
    let fetchMock: any;

    beforeEach(() => {
        fetchMock = mock.method(global, 'fetch');
    });

    afterEach(() => {
        mock.reset();
    });

    test('generateImageOrVideo returns correct result', async () => {
        const mockResponse = {
            ok: true,
            json: async () => ({
                attachment: {
                    id: '123',
                    name: 'test.png',
                    mimeType: 'image/png',
                    size: 100,
                    path: 'path/to/test.png',
                    url: 'http://example.com/test.png'
                },
                revisedPrompt: 'revised prompt',
                operation: 'generate'
            })
        };

        fetchMock.mock.mockImplementation(async () => mockResponse);

        const result = await chatService.generateImageOrVideo({
            threadId: 't1',
            model: 'm1',
            prompt: 'p1',
            attachments: [],
            isVideo: false
        });

        assert.strictEqual(result.attachment.id, '123');
        assert.ok(result.content.includes('Generated image.'));
        assert.ok(result.content.includes('revised prompt'));
    });

    test('streamChat yields chunks correctly', async () => {
        const encoder = new TextEncoder();
        const stream = new ReadableStream({
            start(controller) {
                const chunks = [
                    'data: {"choices":[{"delta":{"content":"Hello"}}]}\n\n',
                    'data: {"choices":[{"delta":{"reasoning_content":"Thinking"}}]}\n\n',
                    'data: [DONE]\n\n'
                ];
                for (const chunk of chunks) {
                    controller.enqueue(encoder.encode(chunk));
                }
                controller.close();
            }
        });

        const mockResponse = {
            ok: true,
            body: stream
        };

        fetchMock.mock.mockImplementation(async () => mockResponse);

        const chunks: any[] = [];
        for await (const chunk of chatService.streamChat({
            messages: [],
            model: 'm1',
            reasoningEffort: 'low',
            search: false
        })) {
            chunks.push(chunk);
        }

        assert.strictEqual(chunks.length, 2);
        assert.deepStrictEqual(chunks[0], { type: 'content', value: 'Hello' });
        assert.deepStrictEqual(chunks[1], { type: 'reasoning', value: 'Thinking' });
    });

    test('streamChat yields provider usage chunks when present', async () => {
        const encoder = new TextEncoder();
        const stream = new ReadableStream({
            start(controller) {
                const chunks = [
                    'data: {"choices":[{"delta":{"content":"Hello"}}]}\n\n',
                    'data: {"usage":{"prompt_tokens":12,"completion_tokens":8,"total_tokens":20}}\n\n',
                    'data: [DONE]\n\n'
                ];
                for (const chunk of chunks) {
                    controller.enqueue(encoder.encode(chunk));
                }
                controller.close();
            }
        });

        fetchMock.mock.mockImplementation(async () => ({ ok: true, body: stream }));

        const chunks: any[] = [];
        for await (const chunk of chatService.streamChat({
            messages: [],
            model: 'm1',
            reasoningEffort: 'low',
            search: false
        })) {
            chunks.push(chunk);
        }

        assert.strictEqual(chunks.length, 2);
        assert.deepStrictEqual(chunks[0], { type: 'content', value: 'Hello' });
        assert.deepStrictEqual(chunks[1], {
            type: 'usage',
            value: {
                outputTokens: 8,
                inputTokens: 12,
                totalTokens: 20,
                source: 'provider'
            }
        });
    });

    test('streamChat infers output tokens for Chutes usage when completion_tokens is null', async () => {
        const encoder = new TextEncoder();
        const stream = new ReadableStream({
            start(controller) {
                const chunks = [
                    'data: {"choices":[{"delta":{"content":"Hello"}}]}\n\n',
                    'data: {"usage":{"prompt_tokens":18,"completion_tokens":null,"total_tokens":31}}\n\n',
                    'data: [DONE]\n\n'
                ];
                for (const chunk of chunks) {
                    controller.enqueue(encoder.encode(chunk));
                }
                controller.close();
            }
        });

        fetchMock.mock.mockImplementation(async () => ({ ok: true, body: stream }));

        const chunks: any[] = [];
        for await (const chunk of chatService.streamChat({
            messages: [],
            model: 'm1',
            reasoningEffort: 'low',
            search: false
        })) {
            chunks.push(chunk);
        }

        assert.strictEqual(chunks.length, 2);
        assert.deepStrictEqual(chunks[0], { type: 'content', value: 'Hello' });
        assert.deepStrictEqual(chunks[1], {
            type: 'usage',
            value: {
                outputTokens: 13,
                inputTokens: 18,
                totalTokens: 31,
                source: 'provider'
            }
        });
    });

    test('streamChat parses OpenRouter top-level usage payload fields', async () => {
        const encoder = new TextEncoder();
        const stream = new ReadableStream({
            start(controller) {
                const chunks = [
                    'data: {"id":0,"generation_id":"gen-1","provider_name":"Arcee AI","tokens_prompt":19,"tokens_completion":1649,"native_tokens_prompt":25,"native_tokens_completion":1617,"native_tokens_reasoning":696}\n\n',
                    'data: [DONE]\n\n'
                ];
                for (const chunk of chunks) {
                    controller.enqueue(encoder.encode(chunk));
                }
                controller.close();
            }
        });

        fetchMock.mock.mockImplementation(async () => ({ ok: true, body: stream }));

        const chunks: any[] = [];
        for await (const chunk of chatService.streamChat({
            messages: [],
            model: 'm1',
            reasoningEffort: 'low',
            search: false
        })) {
            chunks.push(chunk);
        }

        assert.strictEqual(chunks.length, 1);
        assert.deepStrictEqual(chunks[0], {
            type: 'usage',
            value: {
                outputTokens: 1649,
                inputTokens: 19,
                totalTokens: undefined,
                source: 'provider'
            }
        });
    });

    test('streamChat handles errors', async () => {
        const mockResponse = {
            ok: false,
            status: 500,
            json: async () => ({ error: 'Internal Server Error' })
        };

        fetchMock.mock.mockImplementation(async () => mockResponse);

        try {
            for await (const _ of chatService.streamChat({
                messages: [],
                model: 'm1',
                reasoningEffort: 'low',
                search: false
            })) {
                // Should not yield
            }
            assert.fail('Should have thrown error');
        } catch (error: any) {
            assert.strictEqual(error.message, 'Internal Server Error');
        }
    });

    test('streamChat sends byte-offset (not line count) on resume', async () => {
        const encoder = new TextEncoder();
        const firstChunkText = 'data: {"choices":[{"delta":{"content":"Hello"}}]}\n\n';
        const firstChunkBytes = encoder.encode(firstChunkText);

        // First fetch: deliver one chunk then throw a read error.
        let callCount = 0;
        const failingStream = new ReadableStream({
            start(controller) {
                controller.enqueue(firstChunkBytes);
                // Next read will throw (simulates a connection drop).
            },
            pull() {
                throw new Error('network failure');
            }
        });

        const secondChunkText = 'data: {"choices":[{"delta":{"content":" World"}}]}\n\ndata: [DONE]\n\n';
        const resumeStream = new ReadableStream({
            start(controller) {
                controller.enqueue(encoder.encode(secondChunkText));
                controller.close();
            }
        });

        fetchMock.mock.mockImplementation(async (_url: string, init: any) => {
            callCount++;
            if (callCount === 1) {
                return { ok: true, body: failingStream };
            }
            // Second call: verify the byte-offset header.
            const resumeHeader = init?.headers?.['X-Chat-Resume-Offset'];
            assert.strictEqual(
                resumeHeader,
                String(firstChunkBytes.byteLength),
                `Expected byte offset ${firstChunkBytes.byteLength} but got ${resumeHeader}`
            );
            return { ok: true, body: resumeStream };
        });

        const chunks: any[] = [];
        for await (const chunk of chatService.streamChat({
            messages: [],
            model: 'm1',
            reasoningEffort: 'low',
            search: false
        })) {
            chunks.push(chunk);
        }

        assert.strictEqual(callCount, 2, 'Should have made exactly 2 fetch calls');
        assert.strictEqual(chunks.length, 2);
        assert.deepStrictEqual(chunks[0], { type: 'content', value: 'Hello' });
        assert.deepStrictEqual(chunks[1], { type: 'content', value: ' World' });
    });
});
