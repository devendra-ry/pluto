import { test, before } from 'node:test';
import assert from 'node:assert';

let buildGoogleContents: any;

before(async () => {
    process.env.GEMINI_API_KEY = 'dummy';
    process.env.NEXT_PUBLIC_SUPABASE_URL = 'https://example.supabase.co';
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = 'dummy';
    const mod = await import('../src/server/providers/chat-streams');
    buildGoogleContents = mod.buildGoogleContents;
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
