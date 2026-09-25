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

test('parseFormDataRequest enforces streamed body bounds without Content-Length', async (t) => {
    const { ApiRequestError, parseFormDataRequest } = await import('../src/server/http/api-security');

    await t.test('parses a multipart body within the limit', async () => {
        const body = [
            '--b',
            'Content-Disposition: form-data; name="threadId"',
            '',
            'thread-1',
            '--b',
            'Content-Disposition: form-data; name="file"; filename="note.txt"',
            'Content-Type: text/plain',
            '',
            'small file',
            '--b--',
            '',
        ].join('\r\n');
        const request = new Request('https://example.com/api/uploads', {
            method: 'POST',
            headers: { 'Content-Type': 'multipart/form-data; boundary=b' },
            body,
        });
        assert.equal(request.headers.has('content-length'), false);

        const parsed = await parseFormDataRequest(request, 1024);
        assert.equal(parsed.get('threadId'), 'thread-1');
        assert.equal((parsed.get('file') as File).name, 'note.txt');
    });

    await t.test('rejects a chunked multipart body over the limit', async () => {
        const request = new Request('https://example.com/api/uploads', {
            method: 'POST',
            headers: { 'Content-Type': 'multipart/form-data; boundary=b' },
            body: `--b\r\n${'x'.repeat(100)}\r\n--b--\r\n`,
        });
        assert.equal(request.headers.has('content-length'), false);
        await assert.rejects(
            parseFormDataRequest(request, 32),
            (error: unknown) => error instanceof ApiRequestError && error.status === 413,
        );
    });
});
