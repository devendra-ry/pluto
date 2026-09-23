import { test, before } from 'node:test';
import assert from 'node:assert';

let buildGoogleContents: any;
let retryTransientProviderRequest: any;

before(async () => {
    process.env.GEMINI_API_KEY = 'dummy';
    process.env.NEXT_PUBLIC_SUPABASE_URL = 'https://example.supabase.co';
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = 'dummy';
    const mod = await import('../src/server/providers/chat-streams');
    buildGoogleContents = mod.buildGoogleContents;
    retryTransientProviderRequest = mod.retryTransientProviderRequest;
});

import type { PreparedChatMessage } from '../src/shared/contracts/chat';

test('buildGoogleContents formats text and provider roles', () => {
    const messages: PreparedChatMessage[] = [
        { role: 'user', content: 'Hello', attachments: [] },
        { role: 'assistant', content: 'Hi there', attachments: [] },
    ];
    assert.deepStrictEqual(buildGoogleContents(messages), [
        { role: 'user', parts: [{ text: 'Hello' }] },
        { role: 'model', parts: [{ text: 'Hi there' }] },
    ]);
});

test('buildGoogleContents formats inline attachments', () => {
    const messages: PreparedChatMessage[] = [{
        role: 'user',
        content: 'Look at this',
        attachments: [{ name: 'image.png', mimeType: 'image/png', base64Data: 'base64string' }],
    }];
    const parts = buildGoogleContents(messages)[0].parts;
    assert.deepStrictEqual(parts[1], { inlineData: { mimeType: 'image/png', data: 'base64string' } });
});

test('retries a temporary provider outage before streaming starts', async () => {
    let calls = 0;
    const result = await retryTransientProviderRequest(async () => {
        calls += 1;
        if (calls === 1) throw Object.assign(new Error('Service Unavailable'), { code: 503 });
        return 'ready';
    }, undefined, [0]);
    assert.strictEqual(result, 'ready');
    assert.strictEqual(calls, 2);
});

test('does not retry a permanent provider error', async () => {
    let calls = 0;
    await assert.rejects(
        retryTransientProviderRequest(async () => {
            calls += 1;
            throw Object.assign(new Error('Invalid request'), { code: 400 });
        }, undefined, [0, 0]),
        /Invalid request/,
    );
    assert.strictEqual(calls, 1);
});
