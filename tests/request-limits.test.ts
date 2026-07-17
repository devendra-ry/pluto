import assert from 'node:assert';
import { test } from 'node:test';

import { ChatRequestSchema } from '../src/shared/core/types';
import { ImageGenerateRequestSchema, UploadCleanupRequestSchema } from '../src/shared/validation/request-validation';
import {
    MAX_ATTACHMENTS_PER_MESSAGE,
    MAX_CHAT_MESSAGE_CHARS,
    MAX_CLEANUP_PATHS,
    MAX_PROMPT_CHARS,
} from '../src/shared/validation/request-limits';

const attachment = {
    id: 'attachment-1',
    name: 'image.png',
    mimeType: 'image/png',
    size: 1024,
    path: 'user/thread/image.png',
    url: '/api/uploads?threadId=thread&path=image.png',
};

test('request schemas enforce resource bounds', async (t) => {
    await t.test('rejects oversized chat message content', () => {
        const result = ChatRequestSchema.safeParse({
            model: 'model',
            messages: [{ role: 'user', content: 'x'.repeat(MAX_CHAT_MESSAGE_CHARS + 1) }],
        });
        assert.strictEqual(result.success, false);
    });

    await t.test('rejects too many attachments', () => {
        const result = ImageGenerateRequestSchema.safeParse({
            threadId: 'thread',
            prompt: 'edit this',
            attachments: Array.from(
                { length: MAX_ATTACHMENTS_PER_MESSAGE + 1 },
                (_, index) => ({ ...attachment, id: `attachment-${index}` }),
            ),
        });
        assert.strictEqual(result.success, false);
    });

    await t.test('rejects oversized generation prompts', () => {
        const result = ImageGenerateRequestSchema.safeParse({
            threadId: 'thread',
            prompt: 'x'.repeat(MAX_PROMPT_CHARS + 1),
        });
        assert.strictEqual(result.success, false);
    });

    await t.test('rejects oversized cleanup batches', () => {
        const result = UploadCleanupRequestSchema.safeParse({
            threadId: 'thread',
            paths: Array.from({ length: MAX_CLEANUP_PATHS + 1 }, (_, index) => `path-${index}`),
        });
        assert.strictEqual(result.success, false);
    });
});
