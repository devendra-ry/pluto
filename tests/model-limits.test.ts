import { test } from 'node:test';
import assert from 'node:assert';

test('aborted model limit resolution does not cache fallback limits', async () => {
    process.env.GEMINI_API_KEY = 'dummy';
    process.env.NEXT_PUBLIC_SUPABASE_URL = 'https://example.supabase.co';
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = 'dummy';
    const { resolveModelLimits } = await import('../src/server/providers/model-limits');
    const model = `audit-cancel-${Date.now()}`;
    const modelConfig = { provider: 'google', capabilities: [] } as never;
    const controller = new AbortController();
    controller.abort();

    let fetchCalls = 0;
    const originalFetch = globalThis.fetch;
    globalThis.fetch = (async () => {
        fetchCalls += 1;
        return Response.json({ inputTokenLimit: 64000, outputTokenLimit: 8192 });
    }) as typeof fetch;

    try {
        await assert.rejects(
            resolveModelLimits(model, modelConfig, controller.signal),
            (error: unknown) => error instanceof DOMException && error.name === 'AbortError',
        );
        assert.strictEqual(fetchCalls, 0);

        const limits = await resolveModelLimits(model, modelConfig);
        assert.strictEqual(fetchCalls, 1, 'the subsequent request should resolve provider limits');
        assert.deepStrictEqual(limits, {
            contextWindowTokens: 64000,
            maxOutputTokens: 8192,
            source: 'google',
        });
    } finally {
        globalThis.fetch = originalFetch;
    }
});
