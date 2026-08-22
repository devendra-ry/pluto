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

test('buildGoogleContents', async (t) => {
    await t.test('should format simple text messages correctly', () => {
        const messages: PreparedChatMessage[] = [
            { role: 'user', content: 'Hello', attachments: [] },
            { role: 'assistant', content: 'Hi there', attachments: [] },
        ];

        const result = buildGoogleContents(messages);

        assert.deepStrictEqual(result, [
            { role: 'user', parts: [{ text: 'Hello' }] },
            { role: 'model', parts: [{ text: 'Hi there' }] },
        ]);
    });

    await t.test('should format messages with attachments correctly', () => {
        const messages: PreparedChatMessage[] = [
            {
                role: 'user',
                content: 'Look at this',
                attachments: [
                    {
                        name: 'image.png',
                        mimeType: 'image/png',
                        base64Data: 'base64string',
                    },
                ],
            },
        ];

        const result = buildGoogleContents(messages);

        assert.strictEqual(result.length, 1);
        const parts = result[0].parts;
        assert.strictEqual(parts.length, 2);

        assert.deepStrictEqual(parts[0], { text: 'Look at this' });
        assert.deepStrictEqual(parts[1], {
            inlineData: {
                mimeType: 'image/png',
                data: 'base64string',
            },
        });
    });

    await t.test('should handle message with only attachments', () => {
        const messages: PreparedChatMessage[] = [
            {
                role: 'user',
                content: '',
                attachments: [
                    {
                        name: 'image.png',
                        mimeType: 'image/png',
                        base64Data: 'base64string',
                    },
                ],
            },
        ];

        const result = buildGoogleContents(messages);

        assert.strictEqual(result.length, 1);
        const parts = result[0].parts;
        assert.strictEqual(parts.length, 1);

        assert.deepStrictEqual(parts[0], {
            inlineData: {
                mimeType: 'image/png',
                data: 'base64string',
            },
        });
    });

    await t.test('should handle message with no content and no attachments', () => {
        const messages: PreparedChatMessage[] = [
            { role: 'user', content: '', attachments: [] }
        ];

        const result = buildGoogleContents(messages);

        assert.strictEqual(result.length, 1);
        const parts = result[0].parts;
        assert.strictEqual(parts.length, 1);
        assert.deepStrictEqual(parts[0], { text: ' ' });
    });

    await t.test('should map assistant role to model', () => {
        const messages: PreparedChatMessage[] = [
            { role: 'assistant', content: 'I am a model', attachments: [] }
        ];

        const result = buildGoogleContents(messages);

        assert.strictEqual(result[0].role, 'model');
    });

    await t.test('should return empty array for empty input', () => {
        const result = buildGoogleContents([]);
        assert.deepStrictEqual(result, []);
    });
});

