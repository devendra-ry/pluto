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

    test('streamChat handles errors', async () => {
         const mockResponse = {
            ok: false,
            status: 500,
            json: async () => ({ error: 'Internal Server Error' })
        };

        fetchMock.mock.mockImplementation(async () => mockResponse);

        try {
            // eslint-disable-next-line @typescript-eslint/no-unused-vars
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
});
