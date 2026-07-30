import assert from 'node:assert';
import { test } from 'node:test';

import { ChatRequestSchema } from '../src/shared/core/types';
import { UploadCleanupRequestSchema } from '../src/shared/validation/request-validation';
import {
    MAX_CHAT_MESSAGE_CHARS,
    MAX_CLEANUP_PATHS,
} from '../src/shared/validation/request-limits';

test('request schemas enforce resource bounds', async (t) => {
    await t.test('rejects oversized chat message content', () => {
        const result = ChatRequestSchema.safeParse({
            model: 'model',
            messages: [{ role: 'user', content: 'x'.repeat(MAX_CHAT_MESSAGE_CHARS + 1) }],
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
