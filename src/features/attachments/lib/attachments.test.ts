import { test } from 'node:test';
import assert from 'node:assert';
import {
    isSupportedAttachmentMimeType,
    SUPPORTED_ATTACHMENT_MIME_TYPES
} from './attachments';
import { buildAttachmentProxyUrl } from './attachment-url';

test('buildAttachmentProxyUrl encodes thread and object paths', () => {
    assert.strictEqual(
        buildAttachmentProxyUrl('thread/id', 'user/thread/file name.png'),
        '/api/uploads?threadId=thread%2Fid&path=user%2Fthread%2Ffile+name.png',
    );
});

test('isSupportedAttachmentMimeType', async (t) => {
    await t.test('accepts supported MIME types', () => {
        SUPPORTED_ATTACHMENT_MIME_TYPES.forEach(mimeType => {
            assert.strictEqual(isSupportedAttachmentMimeType(mimeType), true, `Should support ${mimeType}`);
        });
        assert.strictEqual(isSupportedAttachmentMimeType('application/javascript'), false);
        assert.strictEqual(isSupportedAttachmentMimeType('IMAGE/PNG'), true);
    });
});
