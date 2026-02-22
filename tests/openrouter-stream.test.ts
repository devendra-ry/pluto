import { test } from 'node:test';
import assert from 'node:assert';
import type { PreparedChatMessage } from '../src/lib/chat-attachments';

test('getOpenRouterStream', async (t) => {
    // Mock environment variables before importing modules that use them
    process.env.GEMINI_API_KEY = 'dummy';
    process.env.OPENROUTER_API_KEY = 'test-key';
    process.env.NEXT_PUBLIC_SUPABASE_URL = 'https://example.supabase.co';
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = 'dummy';
    process.env.NEXT_PUBLIC_APP_URL = 'http://test-app';

    // Import dynamically to ensure env vars are set before module evaluation
    const { getOpenRouterStream } = await import('../src/lib/providers/chat-streams');

    await t.test('should call OpenRouter API with correct parameters', async (t) => {
        const mockFetch = t.mock.method(global, 'fetch', async (url, options) => {
            return new Response(new ReadableStream(), { status: 200 });
        });

        const messages: PreparedChatMessage[] = [
            { role: 'user', content: 'Hello', attachments: [] },
        ];
        const model = 'test-model';
        const reasoningEffort = 'medium';

        await getOpenRouterStream(model, messages, reasoningEffort);

        assert.strictEqual(mockFetch.mock.callCount(), 1);
        const call = mockFetch.mock.calls[0];
        assert.strictEqual(call.arguments[0], 'https://openrouter.ai/api/v1/chat/completions');

        const options = call.arguments[1] as RequestInit;
        assert.strictEqual(options.method, 'POST');

        const headers = options.headers as Record<string, string>;
        assert.strictEqual(headers['Authorization'], 'Bearer test-key');
        assert.strictEqual(headers['HTTP-Referer'], 'http://test-app');
        assert.strictEqual(headers['X-Title'], 'Pluto Chat');

        const body = JSON.parse(options.body as string);
        assert.strictEqual(body.model, model);
        assert.deepStrictEqual(body.messages, [{ role: 'user', content: 'Hello' }]);
        assert.strictEqual(body.stream, true);
        assert.deepStrictEqual(body.reasoning, { effort: 'medium' });
    });

    await t.test('should use default parameters when optional arguments are missing', async (t) => {
        const mockFetch = t.mock.method(global, 'fetch', async (url, options) => {
            return new Response(new ReadableStream(), { status: 200 });
        });

        const messages: PreparedChatMessage[] = [
            { role: 'user', content: 'Hello', attachments: [] },
        ];
        const model = 'test-model';

        await getOpenRouterStream(model, messages);

        assert.strictEqual(mockFetch.mock.callCount(), 1);
        const call = mockFetch.mock.calls[0];
        const options = call.arguments[1] as RequestInit;
        const body = JSON.parse(options.body as string);

        assert.deepStrictEqual(body.reasoning, { effort: 'low' });
        // Default max tokens is 65536
        assert.strictEqual(body.max_tokens, 65536);
    });

    await t.test('should pass signal to fetch', async (t) => {
        const mockFetch = t.mock.method(global, 'fetch', async (url, options) => {
            return new Response(new ReadableStream(), { status: 200 });
        });
        const controller = new AbortController();
        const signal = controller.signal;
        const messages: PreparedChatMessage[] = [
            { role: 'user', content: 'Hello', attachments: [] },
        ];

        await getOpenRouterStream('model', messages, 'low', null, undefined, undefined, signal);

        const call = mockFetch.mock.calls[0];
        const options = call.arguments[1] as RequestInit;
        assert.strictEqual(options.signal, signal);
    });

    await t.test('should handle API errors correctly', async (t) => {
        t.mock.method(global, 'fetch', async () => {
            return new Response('Unauthorized', { status: 401, statusText: 'Unauthorized' });
        });

        const messages: PreparedChatMessage[] = [
            { role: 'user', content: 'Hello', attachments: [] },
        ];

        await assert.rejects(
            async () => {
                await getOpenRouterStream('model', messages);
            },
            (err: Error) => {
                assert.ok(err.message.includes('OpenRouter API error 401'));
                assert.ok(err.message.includes('Unauthorized'));
                return true;
            }
        );
    });
});
