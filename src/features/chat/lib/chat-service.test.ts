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

    test('streamChat forwards a generation claim token for fenced completion', async () => {
        fetchMock.mock.mockImplementation(async (_url, init) => {
            const body = JSON.parse(String(init?.body)) as Record<string, unknown>;
            assert.equal(body.generationJobClaimToken, 'claim-token');
            return new Response('data: [DONE]\n\n');
        });

        const chunks: ChatServiceStreamChunk[] = [];
        for await (const chunk of chatService.streamChat({
            model: 'm1',
            reasoningEffort: 'low',
            generationJobClaimToken: 'claim-token',
        })) chunks.push(chunk);
        assert.deepStrictEqual(chunks, []);
    });

    test('streamChat parses multiline SSE data and JSON with arbitrary whitespace', async () => {
        const encoder = new TextEncoder();
        const bytes = encoder.encode(': ping\r\ndata: {\r\ndata:   "c" : "Actual",\r\ndata:   "metadata" : { "content" : "decoy" }\r\ndata: }\r\n\r\ndata: [DONE]');
        const stream = new ReadableStream<Uint8Array>({
            start(controller) {
                controller.enqueue(bytes.slice(0, 7));
                controller.enqueue(bytes.slice(7, 29));
                controller.enqueue(bytes.slice(29));
                controller.close();
            },
        });
        fetchMock.mock.mockImplementation(async () => new Response(stream));

        const chunks: ChatServiceStreamChunk[] = [];
        for await (const chunk of chatService.streamChat({ model: 'm1', reasoningEffort: 'low' })) chunks.push(chunk);
        assert.deepStrictEqual(chunks, [{ type: 'content', value: 'Actual' }]);
        assert.strictEqual(fetchMock.mock.callCount(), 1, 'unterminated final DONE should complete the stream');
    });

    test('streamChat maps provider thoughts tokens without changing answer token counts', async () => {
        const response = new Response(
            'data: {"meta":"usage","usage":{"outputTokens":8,"thoughtsTokenCount":5}}\n\n'
            + 'data: [DONE]\n\n',
        );
        fetchMock.mock.mockImplementation(async () => response);

        const chunks: ChatServiceStreamChunk[] = [];
        for await (const chunk of chatService.streamChat({ model: 'm1', reasoningEffort: 'low' })) chunks.push(chunk);
        assert.deepStrictEqual(chunks, [{
            type: 'usage',
            value: {
                outputTokens: 8,
                inputTokens: undefined,
                reasoningTokens: 5,
                totalTokens: undefined,
                source: 'provider',
            },
        }]);
    });

    test('streamChat does not double-count reasoning when inferring missing answer usage', async () => {
        fetchMock.mock.mockImplementation(async () => new Response(
            'data: {"meta":"usage","usage":{"inputTokens":10,"totalTokens":25,"reasoningTokens":8}}\n\ndata: [DONE]\n\n',
        ));
        const chunks: ChatServiceStreamChunk[] = [];
        for await (const chunk of chatService.streamChat({ model: 'm1', reasoningEffort: 'high' })) chunks.push(chunk);
        assert.deepStrictEqual(chunks, [{ type: 'usage', value: { outputTokens: 7, inputTokens: 10, reasoningTokens: 8, totalTokens: 25, source: 'provider' } }]);
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

    test('streamChat resumes a clean but incomplete EOF without duplicating delivered content', async () => {
        let requests = 0;
        const text = 'data: {"c":"Hello"}\n\n';
        fetchMock.mock.mockImplementation(async (_url, init) => {
            requests += 1;
            if (requests === 1) return new Response(text);
            assert.strictEqual(new Headers(init?.headers).get('X-Chat-Resume-Offset'), String(new TextEncoder().encode(text).byteLength));
            return new Response('data: [DONE]\n\n');
        });
        const chunks: ChatServiceStreamChunk[] = [];
        for await (const chunk of chatService.streamChat({ model: 'm1', reasoningEffort: 'low' })) chunks.push(chunk);
        assert.deepStrictEqual(chunks, [{ type: 'content', value: 'Hello' }]);
        assert.strictEqual(requests, 2);
    });

    test('streamChat bounds retries when EOF repeatedly arrives without completion', async () => {
        fetchMock.mock.mockImplementation(async () => new Response(''));
        await assert.rejects(async () => {
            for await (const _ of chatService.streamChat({ model: 'm1', reasoningEffort: 'low' })) { /* consume */ }
        }, /Chat stream ended before completion/);
        assert.strictEqual(fetchMock.mock.callCount(), 3);
    });

    test('streamChat cancels and releases a body that remains open after DONE', async () => {
        let cancelled = false;
        let responseBody: ReadableStream<Uint8Array> | null = null;
        responseBody = new ReadableStream({
            start(controller) {
                controller.enqueue(new TextEncoder().encode('data: [DONE]\n\n'));
            },
            cancel() {
                cancelled = true;
            },
        });
        fetchMock.mock.mockImplementation(async () => new Response(responseBody, { status: 200 }));

        const iterator = chatService.streamChat({ model: 'm1', reasoningEffort: 'low' });
        assert.deepStrictEqual(await iterator.next(), { done: true, value: undefined });
        await Promise.resolve();

        assert.strictEqual(cancelled, true);
        assert.strictEqual(responseBody.locked, false);
    });

    test('streamChat cancels the response body when the consumer stops early', async () => {
        let cancelled = false;
        const responseBody = new ReadableStream<Uint8Array>({
            start(controller) {
                controller.enqueue(new TextEncoder().encode('data: {"choices":[{"delta":{"content":"Hello"}}]}\n\n'));
            },
            cancel() {
                cancelled = true;
            },
        });
        fetchMock.mock.mockImplementation(async () => new Response(responseBody, { status: 200 }));

        for await (const _chunk of chatService.streamChat({ model: 'm1', reasoningEffort: 'low' })) {
            break;
        }
        await Promise.resolve();

        assert.strictEqual(cancelled, true);
        assert.strictEqual(responseBody.locked, false);
    });

    test('streamChat preserves aborts from fetch instead of retrying them', async () => {
        const controller = new AbortController();
        controller.abort();
        fetchMock.mock.mockImplementation(async () => {
            throw new DOMException('aborted', 'AbortError');
        });

        await assert.rejects(
            async () => {
                for await (const _chunk of chatService.streamChat({
                    model: 'm1',
                    reasoningEffort: 'low',
                    signal: controller.signal,
                })) {
                    // Should not yield.
                }
            },
            (error: unknown) => error instanceof Error && error.name === 'AbortError',
        );

        assert.strictEqual(fetchMock.mock.callCount(), 1);
    });

    test('streamChat preserves aborts from a pending reader read', async () => {
        const controller = new AbortController();
        const responseBody = new ReadableStream<Uint8Array>({
            start(streamController) {
                streamController.enqueue(new TextEncoder().encode('data: {"choices":[{"delta":{"content":"Hello"}}]}\n\n'));
            },
            pull() {
                return new Promise<void>((_resolve, reject) => {
                    controller.signal.addEventListener('abort', () => {
                        reject(new DOMException('aborted', 'AbortError'));
                    }, { once: true });
                });
            },
        });
        fetchMock.mock.mockImplementation(async () => new Response(responseBody, { status: 200 }));

        const iterator = chatService.streamChat({
            model: 'm1',
            reasoningEffort: 'low',
            signal: controller.signal,
        });
        assert.deepStrictEqual(await iterator.next(), { done: false, value: { type: 'content', value: 'Hello' } });
        controller.abort();

        await assert.rejects(iterator.next(), (error: unknown) => error instanceof Error && error.name === 'AbortError');
        await Promise.resolve();

        assert.strictEqual(responseBody.locked, false);
    });
});
