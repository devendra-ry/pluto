import { test } from 'node:test';
import assert from 'node:assert';
import { ImageGenerateRequestSchema, VideoGenerateRequestSchema } from '../src/shared/validation/request-validation';
import { z } from 'zod';

test('ImageGenerateRequestSchema', async (t) => {
    await t.test('should validate a correct request with minimal fields', () => {
        const minimalRequest = {
            threadId: 'thread-123',
            prompt: 'A beautiful sunset',
        };

        const result = ImageGenerateRequestSchema.safeParse(minimalRequest);
        assert.ok(result.success);
        assert.strictEqual(result.data.threadId, minimalRequest.threadId);
        assert.strictEqual(result.data.prompt, minimalRequest.prompt);
        assert.deepStrictEqual(result.data.attachments, []);
    });

    await t.test('should validate a correct request with all fields', () => {
        const fullRequest = {
            threadId: 'thread-123',
            model: 'image-model-v1',
            prompt: 'A futuristic city',
            attachments: [],
        };

        const result = ImageGenerateRequestSchema.safeParse(fullRequest);
        assert.ok(result.success);
        assert.deepStrictEqual(result.data, fullRequest);
    });

    await t.test('should fail if threadId is missing', () => {
        const request = {
            prompt: 'A beautiful sunset',
        };

        const result = ImageGenerateRequestSchema.safeParse(request);
        assert.ok(!result.success);
        const issues = result.error.issues;
        assert.ok(issues.some((issue) => issue.path.includes('threadId')));
    });

    await t.test('should fail if threadId is empty', () => {
        const request = {
            threadId: '   ',
            prompt: 'A beautiful sunset',
        };

        const result = ImageGenerateRequestSchema.safeParse(request);
        assert.ok(!result.success);
        const issues = result.error.issues;
        assert.ok(issues.some((issue) => issue.path.includes('threadId') && issue.message.includes('required')));
    });

    await t.test('should fail if prompt is missing', () => {
        const request = {
            threadId: 'thread-123',
        };

        const result = ImageGenerateRequestSchema.safeParse(request);
        assert.ok(!result.success);
        const issues = result.error.issues;
        assert.ok(issues.some((issue) => issue.path.includes('prompt')));
    });

    await t.test('should fail if prompt is empty', () => {
        const request = {
            threadId: 'thread-123',
            prompt: '',
        };

        const result = ImageGenerateRequestSchema.safeParse(request);
        assert.ok(!result.success);
        const issues = result.error.issues;
        assert.ok(issues.some((issue) => issue.path.includes('prompt') && issue.message.includes('required')));
    });

    await t.test('should fail if attachments are invalid', () => {
        const request = {
            threadId: 'thread-123',
            prompt: 'test',
            attachments: [{ invalid: 'attachment' }],
        };

        const result = ImageGenerateRequestSchema.safeParse(request);
        assert.ok(!result.success);
        const issues = result.error.issues;
        assert.ok(issues.some((issue) => issue.path.includes('attachments')));
    });

    await t.test('should validate valid attachments', () => {
        const attachment = {
            id: 'att-1',
            name: 'image.png',
            mimeType: 'image/png',
            size: 1024,
            path: '/tmp/image.png',
            url: 'http://example.com/image.png',
        };

        const request = {
            threadId: 'thread-123',
            prompt: 'test',
            attachments: [attachment],
        };

        const result = ImageGenerateRequestSchema.safeParse(request);
        assert.ok(result.success);
        assert.strictEqual(result.data.attachments.length, 1);
        assert.deepStrictEqual(result.data.attachments[0], attachment);
    });

    await t.test('should fail if model is empty string', () => {
        const request = {
            threadId: 'thread-123',
            prompt: 'test',
            model: '',
        };

        const result = ImageGenerateRequestSchema.safeParse(request);
        assert.ok(!result.success);
        const issues = result.error.issues;
        assert.ok(issues.some((issue) => issue.path.includes('model')));
    });

    await t.test('should fail if model is whitespace only', () => {
        const request = {
            threadId: 'thread-123',
            prompt: 'test',
            model: '   ',
        };

        const result = ImageGenerateRequestSchema.safeParse(request);
        assert.ok(!result.success);
        const issues = result.error.issues;
        assert.ok(issues.some((issue) => issue.path.includes('model')));
    });
});

test('VideoGenerateRequestSchema', async (t) => {
    await t.test('should validate a correct request with minimal fields', () => {
        const minimalRequest = {
            threadId: 'thread-123',
            prompt: 'A beautiful sunset',
        };

        const result = VideoGenerateRequestSchema.safeParse(minimalRequest);
        assert.ok(result.success);
        assert.strictEqual(result.data.threadId, minimalRequest.threadId);
        assert.strictEqual(result.data.prompt, minimalRequest.prompt);
        assert.deepStrictEqual(result.data.attachments, []);
    });

    await t.test('should validate a correct request with all fields', () => {
        const fullRequest = {
            threadId: 'thread-123',
            model: 'video-model-v1',
            prompt: 'A futuristic city',
            attachments: [],
            negative_prompt: 'blurry, dark',
            resolution: '1920x1080',
            frames: 24,
            fps: 30,
            fast: true,
            guidance_scale: 7.5,
            seed: 42,
        };

        const result = VideoGenerateRequestSchema.safeParse(fullRequest);
        assert.ok(result.success);
        assert.deepStrictEqual(result.data, fullRequest);
    });

    await t.test('should fail if threadId is missing', () => {
        const request = {
            prompt: 'A beautiful sunset',
        };

        const result = VideoGenerateRequestSchema.safeParse(request);
        assert.ok(!result.success);
        const issues = result.error.issues;
        assert.ok(issues.some((issue) => issue.path.includes('threadId')));
    });

    await t.test('should fail if threadId is empty', () => {
        const request = {
            threadId: '   ',
            prompt: 'A beautiful sunset',
        };

        const result = VideoGenerateRequestSchema.safeParse(request);
        assert.ok(!result.success);
        const issues = result.error.issues;
        assert.ok(issues.some((issue) => issue.path.includes('threadId') && issue.message.includes('required')));
    });

    await t.test('should fail if prompt is missing', () => {
        const request = {
            threadId: 'thread-123',
        };

        const result = VideoGenerateRequestSchema.safeParse(request);
        assert.ok(!result.success);
        const issues = result.error.issues;
        assert.ok(issues.some((issue) => issue.path.includes('prompt')));
    });

    await t.test('should fail if prompt is empty', () => {
        const request = {
            threadId: 'thread-123',
            prompt: '',
        };

        const result = VideoGenerateRequestSchema.safeParse(request);
        assert.ok(!result.success);
        const issues = result.error.issues;
        assert.ok(issues.some((issue) => issue.path.includes('prompt') && issue.message.includes('required')));
    });

    await t.test('should fail if attachments are invalid', () => {
        const request = {
            threadId: 'thread-123',
            prompt: 'test',
            attachments: [{ invalid: 'attachment' }],
        };

        const result = VideoGenerateRequestSchema.safeParse(request);
        assert.ok(!result.success);
        const issues = result.error.issues;
        assert.ok(issues.some((issue) => issue.path.includes('attachments')));
    });

    await t.test('should validate valid attachments', () => {
        const attachment = {
            id: 'att-1',
            name: 'image.png',
            mimeType: 'image/png',
            size: 1024,
            path: '/tmp/image.png',
            url: 'http://example.com/image.png',
        };

        const request = {
            threadId: 'thread-123',
            prompt: 'test',
            attachments: [attachment],
        };

        const result = VideoGenerateRequestSchema.safeParse(request);
        assert.ok(result.success);
        assert.strictEqual(result.data.attachments.length, 1);
        assert.deepStrictEqual(result.data.attachments[0], attachment);
    });

    await t.test('should fail if numeric fields are strings', () => {
        const request = {
            threadId: 'thread-123',
            prompt: 'test',
            frames: '24', // Should be number
        };

        const result = VideoGenerateRequestSchema.safeParse(request);
        assert.ok(!result.success);
        const issues = result.error.issues;
        assert.ok(issues.some((issue) => issue.path.includes('frames')));
    });

    await t.test('should fail if boolean fields are strings', () => {
        const request = {
            threadId: 'thread-123',
            prompt: 'test',
            fast: 'true', // Should be boolean
        };

        const result = VideoGenerateRequestSchema.safeParse(request);
        assert.ok(!result.success);
        const issues = result.error.issues;
        assert.ok(issues.some((issue) => issue.path.includes('fast')));
    });

    await t.test('should allow null seed', () => {
         const request = {
            threadId: 'thread-123',
            prompt: 'test',
            seed: null,
        };
        const result = VideoGenerateRequestSchema.safeParse(request);
        assert.ok(result.success);
        assert.strictEqual(result.data.seed, null);
    });
});
