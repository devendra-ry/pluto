import { test } from 'node:test';
import assert from 'node:assert';
import {
    isSupportedAttachmentMimeType,
    isImageAttachment,
    isPdfAttachment,
    isTextAttachment,
    SUPPORTED_ATTACHMENT_MIME_TYPES
} from './attachments';

test('isSupportedAttachmentMimeType', async (t) => {
    await t.test('returns true for all supported mime types', () => {
        SUPPORTED_ATTACHMENT_MIME_TYPES.forEach(mimeType => {
            assert.strictEqual(isSupportedAttachmentMimeType(mimeType), true, `Should support ${mimeType}`);
        });
    });

    await t.test('returns false for unsupported mime types', () => {
        const unsupported = [
            'application/javascript',
            'text/html',
            'image/bmp',
            'video/mp4',
            '',
            'random-string'
        ];
        unsupported.forEach(mimeType => {
            assert.strictEqual(isSupportedAttachmentMimeType(mimeType), false, `Should not support ${mimeType}`);
        });
    });

    await t.test('is case-insensitive', () => {
        assert.strictEqual(isSupportedAttachmentMimeType('IMAGE/PNG'), true, 'Should support IMAGE/PNG');
        assert.strictEqual(isSupportedAttachmentMimeType('Image/Jpeg'), true, 'Should support Image/Jpeg');
        assert.strictEqual(isSupportedAttachmentMimeType('APPLICATION/PDF'), true, 'Should support APPLICATION/PDF');
    });
});

test('isImageAttachment', async (t) => {
    await t.test('returns true for images', () => {
        assert.strictEqual(isImageAttachment('image/png'), true);
        assert.strictEqual(isImageAttachment('image/jpeg'), true);
        assert.strictEqual(isImageAttachment('image/webp'), true);
        assert.strictEqual(isImageAttachment('image/gif'), true);
    });

    await t.test('returns false for non-images', () => {
        assert.strictEqual(isImageAttachment('application/pdf'), false);
        assert.strictEqual(isImageAttachment('text/plain'), false);
    });

    await t.test('is case-insensitive', () => {
        assert.strictEqual(isImageAttachment('IMAGE/PNG'), true, 'Should support IMAGE/PNG');
    });
});

test('isPdfAttachment', async (t) => {
    await t.test('returns true for PDF', () => {
        assert.strictEqual(isPdfAttachment('application/pdf'), true);
    });

    await t.test('returns false for non-PDF', () => {
        assert.strictEqual(isPdfAttachment('image/png'), false);
    });

    await t.test('is case-insensitive', () => {
        assert.strictEqual(isPdfAttachment('APPLICATION/PDF'), true, 'Should support APPLICATION/PDF');
    });
});

test('isTextAttachment', async (t) => {
    await t.test('returns true for text/plain', () => {
        assert.strictEqual(isTextAttachment('text/plain'), true);
    });

    await t.test('returns false for non-text', () => {
        assert.strictEqual(isTextAttachment('image/png'), false);
    });

    await t.test('is case-insensitive', () => {
        assert.strictEqual(isTextAttachment('TEXT/PLAIN'), true, 'Should support TEXT/PLAIN');
    });
});