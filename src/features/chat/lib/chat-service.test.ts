import { test, describe, beforeEach, afterEach, mock } from 'node:test';
import assert from 'node:assert';
import { chatService, type ChatServiceStreamChunk } from './chat-service';

describe('ChatService', () => {
    let fetchMock: import('node:test').Mock<typeof globalThis.fetch>;

    beforeEach(() => {
        fetchMock = mock.method(global, 'fetch');
    });

    afterEach(() => {
        mock.reset();
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

        const mockResponse = new Response(stream, { status: 200 });

        fetchMock.mock.mockImplementation(async () => mockResponse);

        const chunks: ChatServiceStreamChunk[] = [];
        for await (const chunk of chatService.streamChat({
            messages: [],
            model: 'm1',
            reasoningEffort: 'low',
        })) {
            chunks.push(chunk);
        }

        assert.strictEqual(chunks.length, 2);
        assert.deepStrictEqual(chunks[0], { type: 'content', value: 'Hello' });
        assert.deepStrictEqual(chunks[1], { type: 'reasoning', value: 'Thinking' });
    });

    test('streamChat handles errors', async () => {
        const mockResponse = Response.json({ error: 'Internal Server Error' }, { status: 500 });

        fetchMock.mock.mockImplementation(async () => mockResponse);

        try {
            for await (const _ of chatService.streamChat({
                messages: [],
                model: 'm1',
                reasoningEffort: 'low',
            })) {
                // Should not yield
            }
            assert.fail('Should have thrown error');
        } catch (error: unknown) {
            assert.ok(error instanceof Error);
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

        fetchMock.mock.mockImplementation(async (_url, init) => {
            callCount++;
            if (callCount === 1) {
                return new Response(failingStream, { status: 200 });
            }
            // Second call: verify the byte-offset header.
            const resumeHeader = new Headers(init?.headers).get('X-Chat-Resume-Offset');
            assert.strictEqual(
                resumeHeader,
                String(firstChunkBytes.byteLength),
                `Expected byte offset ${firstChunkBytes.byteLength} but got ${resumeHeader}`
            );
            return new Response(resumeStream, { status: 200 });
        });

        const chunks: ChatServiceStreamChunk[] = [];
        for await (const chunk of chatService.streamChat({
            messages: [],
            model: 'm1',
            reasoningEffort: 'low',
        })) {
            chunks.push(chunk);
        }

        assert.strictEqual(callCount, 2, 'Should have made exactly 2 fetch calls');
        assert.strictEqual(chunks.length, 2);
        assert.deepStrictEqual(chunks[0], { type: 'content', value: 'Hello' });
        assert.deepStrictEqual(chunks[1], { type: 'content', value: ' World' });
    });
});
