import { describe, it } from 'node:test';
import assert from 'node:assert';
import { UploadCleanupRequestSchema } from './request-validation';

describe('UploadCleanupRequestSchema', () => {
    it('accepts a valid request and trims the thread id', () => {
        const result = UploadCleanupRequestSchema.safeParse({
            threadId: '  thread-123  ',
            paths: ['path/to/file1', 'path/to/file2'],
        });
        assert.ok(result.success);
        assert.strictEqual(result.data.threadId, 'thread-123');
    });

    it('rejects missing or whitespace-only thread ids', () => {
        assert.strictEqual(UploadCleanupRequestSchema.safeParse({ paths: ['path'] }).success, false);
        assert.strictEqual(UploadCleanupRequestSchema.safeParse({ threadId: '   ' }).success, false);
    });

    it('rejects invalid path values and non-array paths', () => {
        assert.strictEqual(
            UploadCleanupRequestSchema.safeParse({ threadId: 'thread-123', paths: ['valid', ''] }).success,
            false,
        );
        assert.strictEqual(
            UploadCleanupRequestSchema.safeParse({ threadId: 'thread-123', paths: 'not-an-array' }).success,
            false,
        );
    });
});
