import { describe, it } from 'node:test';
import assert from 'node:assert';
import { UploadCleanupRequestSchema } from './request-validation';

describe('UploadCleanupRequestSchema', () => {
    it('should validate a valid request with threadId only', () => {
        const input = { threadId: 'thread-123' };
        const result = UploadCleanupRequestSchema.safeParse(input);
        assert.ok(result.success);
        assert.deepStrictEqual(result.data, input);
    });

    it('should validate a valid request with threadId and paths', () => {
        const input = {
            threadId: 'thread-123',
            paths: ['path/to/file1', 'path/to/file2'],
        };
        const result = UploadCleanupRequestSchema.safeParse(input);
        assert.ok(result.success);
        assert.deepStrictEqual(result.data, input);
    });

    it('should trim threadId', () => {
        const input = { threadId: '  thread-123  ' };
        const result = UploadCleanupRequestSchema.safeParse(input);
        assert.ok(result.success);
        assert.strictEqual(result.data.threadId, 'thread-123');
    });

    it('should fail if threadId is missing', () => {
        const input = { paths: ['path/to/file'] };
        const result = UploadCleanupRequestSchema.safeParse(input);
        assert.strictEqual(result.success, false);
        if (!result.success) {
            const error = result.error.flatten().fieldErrors.threadId;
            assert.ok(error && error.length > 0);
        }
    });

    it('should fail if threadId is empty', () => {
        const input = { threadId: '' };
        const result = UploadCleanupRequestSchema.safeParse(input);
        assert.strictEqual(result.success, false);
        if (!result.success) {
             const error = result.error.flatten().fieldErrors.threadId;
             assert.ok(error?.includes('threadId is required'));
        }
    });

    it('should fail if threadId is only whitespace', () => {
        const input = { threadId: '   ' };
        const result = UploadCleanupRequestSchema.safeParse(input);
        assert.strictEqual(result.success, false);
        if (!result.success) {
             const error = result.error.flatten().fieldErrors.threadId;
             assert.ok(error?.includes('threadId is required'));
        }
    });

    it('should fail if paths contains empty strings', () => {
        const input = { threadId: 'thread-123', paths: ['valid', ''] };
        const result = UploadCleanupRequestSchema.safeParse(input);
        assert.strictEqual(result.success, false);
    });

    it('should allow empty paths array', () => {
         const input = { threadId: 'thread-123', paths: [] };
         const result = UploadCleanupRequestSchema.safeParse(input);
         assert.ok(result.success);
    });

    it('should fail if paths is not an array', () => {
        const input = { threadId: 'thread-123', paths: 'not-an-array' };
        const result = UploadCleanupRequestSchema.safeParse(input);
        assert.strictEqual(result.success, false);
    });
});
