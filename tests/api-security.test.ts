import assert from 'node:assert';
import { test } from 'node:test';

process.env.GEMINI_API_KEY = 'dummy-key';
process.env.NEXT_PUBLIC_SUPABASE_URL = 'https://example.supabase.co';
process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = 'dummy-key';

test('parseJsonRequest enforces streamed body bounds', async (t) => {
    const { ApiRequestError, parseJsonRequest } = await import('../src/server/http/api-security');

    await t.test('parses a JSON body within the limit', async () => {
        const request = new Request('https://example.com/api', {
            method: 'POST',
            body: JSON.stringify({ ok: true }),
        });
        assert.deepStrictEqual(await parseJsonRequest(request, 1024), { ok: true });
    });

    await t.test('rejects a body that exceeds the byte limit', async () => {
        const request = new Request('https://example.com/api', {
            method: 'POST',
            body: JSON.stringify({ value: 'x'.repeat(100) }),
        });
        await assert.rejects(
            parseJsonRequest(request, 32),
            (error: unknown) => error instanceof ApiRequestError && error.status === 413,
        );
    });

    await t.test('rejects malformed JSON', async () => {
        const request = new Request('https://example.com/api', {
            method: 'POST',
            body: '{not-json}',
        });
        await assert.rejects(
            parseJsonRequest(request, 1024),
            (error: unknown) => error instanceof ApiRequestError && error.status === 400,
        );
    });
});
