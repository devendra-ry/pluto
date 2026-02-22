import { test } from 'node:test';
import assert from 'node:assert';
import {
    isImageAttachment,
    isPdfAttachment,
    isTextAttachment,
    isSupportedAttachmentMimeType,
} from '../src/lib/attachments';

test('isImageAttachment', async (t) => {
    await t.test('should return true for supported image mime types', () => {
        assert.ok(isImageAttachment('image/png'));
        assert.ok(isImageAttachment('image/jpeg'));
        assert.ok(isImageAttachment('image/webp'));
        assert.ok(isImageAttachment('image/gif'));
    });

    await t.test('should be case insensitive', () => {
        assert.ok(isImageAttachment('IMAGE/PNG'));
        assert.ok(isImageAttachment('Image/Jpeg'));
    });

    await t.test('should return false for unsupported mime types', () => {
        assert.strictEqual(isImageAttachment('application/pdf'), false);
        assert.strictEqual(isImageAttachment('text/plain'), false);
        assert.strictEqual(isImageAttachment('image/tiff'), false); // Assuming tiff is not supported
    });

    await t.test('should return false for invalid strings', () => {
        assert.strictEqual(isImageAttachment('invalid'), false);
        assert.strictEqual(isImageAttachment(''), false);
    });
});

test('isPdfAttachment', async (t) => {
    await t.test('should return true for application/pdf', () => {
        assert.ok(isPdfAttachment('application/pdf'));
    });

    await t.test('should be case insensitive', () => {
        assert.ok(isPdfAttachment('APPLICATION/PDF'));
        assert.ok(isPdfAttachment('Application/Pdf'));
    });

    await t.test('should return false for other mime types', () => {
        assert.strictEqual(isPdfAttachment('image/png'), false);
        assert.strictEqual(isPdfAttachment('text/plain'), false);
    });
});

test('isTextAttachment', async (t) => {
    await t.test('should return true for text/plain', () => {
        assert.ok(isTextAttachment('text/plain'));
    });

    await t.test('should be case insensitive', () => {
        assert.ok(isTextAttachment('TEXT/PLAIN'));
        assert.ok(isTextAttachment('Text/Plain'));
    });

    await t.test('should return false for other mime types', () => {
        assert.strictEqual(isTextAttachment('image/png'), false);
        assert.strictEqual(isTextAttachment('application/pdf'), false);
    });
});

test('isSupportedAttachmentMimeType', async (t) => {
    await t.test('should return true for all supported mime types', () => {
        assert.ok(isSupportedAttachmentMimeType('image/png'));
        assert.ok(isSupportedAttachmentMimeType('image/jpeg'));
        assert.ok(isSupportedAttachmentMimeType('image/webp'));
        assert.ok(isSupportedAttachmentMimeType('image/gif'));
        assert.ok(isSupportedAttachmentMimeType('application/pdf'));
        assert.ok(isSupportedAttachmentMimeType('text/plain'));
    });

    await t.test('should be case insensitive', () => {
        assert.ok(isSupportedAttachmentMimeType('IMAGE/PNG'));
        assert.ok(isSupportedAttachmentMimeType('APPLICATION/PDF'));
    });

    await t.test('should return false for unsupported mime types', () => {
        assert.strictEqual(isSupportedAttachmentMimeType('application/zip'), false);
        assert.strictEqual(isSupportedAttachmentMimeType('image/tiff'), false);
    });
});
