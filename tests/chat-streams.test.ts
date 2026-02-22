import { test } from 'node:test';
import assert from 'node:assert';
import { buildOpenAICompatibleMessages, buildGoogleContents } from '../src/lib/providers/chat-streams';
import type { PreparedChatMessage } from '../src/lib/chat-attachments';

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

test('buildOpenAICompatibleMessages', async (t) => {
    await t.test('should format simple text messages correctly', () => {
        const messages: PreparedChatMessage[] = [
            { role: 'user', content: 'Hello', attachments: [] },
            { role: 'assistant', content: 'Hi there', attachments: [] },
        ];

        const result = buildOpenAICompatibleMessages(messages);

        assert.deepStrictEqual(result, [
            { role: 'user', content: 'Hello' },
            { role: 'assistant', content: 'Hi there' },
        ]);
    });

    await t.test('should format messages with image attachments correctly', () => {
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

        const result = buildOpenAICompatibleMessages(messages);

        assert.strictEqual(result.length, 1);
        const message = result[0];
        assert.strictEqual(message.role, 'user');
        assert.ok(Array.isArray(message.content));

        const content = message.content as Array<any>;
        assert.strictEqual(content.length, 2);

        assert.deepStrictEqual(content[0], { type: 'text', text: 'Look at this' });
        assert.deepStrictEqual(content[1], {
            type: 'image_url',
            image_url: {
                url: 'data:image/png;base64,base64string',
            },
        });
    });

    await t.test('should format messages with non-image attachments correctly', () => {
        const messages: PreparedChatMessage[] = [
            {
                role: 'user',
                content: 'Analyze this file',
                attachments: [
                    {
                        name: 'data.txt',
                        mimeType: 'text/plain',
                        base64Data: 'textbase64',
                    },
                ],
            },
        ];

        const result = buildOpenAICompatibleMessages(messages);

        assert.strictEqual(result.length, 1);
        const content = result[0].content as Array<any>;

        assert.deepStrictEqual(content[0], { type: 'text', text: 'Analyze this file' });
        assert.deepStrictEqual(content[1], {
            type: 'file',
            file: {
                filename: 'data.txt',
                file_data: 'data:text/plain;base64,textbase64',
            },
        });
    });

    await t.test('should handle mixed content types in a single message', () => {
        const messages: PreparedChatMessage[] = [
            {
                role: 'user',
                content: 'Mixed content',
                attachments: [
                    {
                        name: 'image.jpg',
                        mimeType: 'image/jpeg',
                        base64Data: 'imgbase64',
                    },
                    {
                        name: 'doc.pdf',
                        mimeType: 'application/pdf',
                        base64Data: 'pdfbase64',
                    },
                ],
            },
        ];

        const result = buildOpenAICompatibleMessages(messages);
        const content = result[0].content as Array<any>;

        assert.strictEqual(content.length, 3);
        assert.strictEqual(content[0].type, 'text');
        assert.strictEqual(content[1].type, 'image_url');
        assert.strictEqual(content[2].type, 'file');
    });

    await t.test('should include system prompt when provided', () => {
        const messages: PreparedChatMessage[] = [
            { role: 'user', content: 'Hello', attachments: [] },
        ];
        const systemPrompt = 'You are a helpful assistant.';

        const result = buildOpenAICompatibleMessages(messages, systemPrompt);

        assert.strictEqual(result.length, 2);
        assert.deepStrictEqual(result[0], { role: 'system', content: 'You are a helpful assistant.' });
        assert.deepStrictEqual(result[1], { role: 'user', content: 'Hello' });
    });

    await t.test('should not include system prompt if empty or whitespace', () => {
        const messages: PreparedChatMessage[] = [
            { role: 'user', content: 'Hello', attachments: [] },
        ];

        const resultEmpty = buildOpenAICompatibleMessages(messages, '');
        assert.strictEqual(resultEmpty.length, 1);
        assert.strictEqual(resultEmpty[0].role, 'user');

        const resultWhitespace = buildOpenAICompatibleMessages(messages, '   ');
        assert.strictEqual(resultWhitespace.length, 1);
        assert.strictEqual(resultWhitespace[0].role, 'user');
    });

    await t.test('should handle message with attachments but empty content', () => {
        const messages: PreparedChatMessage[] = [
            {
                role: 'user',
                content: '',
                attachments: [
                    {
                        name: 'image.png',
                        mimeType: 'image/png',
                        base64Data: 'base64',
                    },
                ],
            },
        ];

        const result = buildOpenAICompatibleMessages(messages);
        const content = result[0].content as Array<any>;

        assert.strictEqual(content.length, 1);
        assert.strictEqual(content[0].type, 'image_url');
    });

    await t.test('should handle message with no content and no attachments', () => {
         const messages: PreparedChatMessage[] = [
             { role: 'user', content: '', attachments: [] }
         ];

         const result = buildOpenAICompatibleMessages(messages);
         assert.deepStrictEqual(result[0], { role: 'user', content: '' });
    });

    await t.test('should return empty array for empty input', () => {
        const result = buildOpenAICompatibleMessages([]);
        assert.deepStrictEqual(result, []);
    });
});
