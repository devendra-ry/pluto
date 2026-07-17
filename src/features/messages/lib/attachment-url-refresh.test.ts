import assert from 'node:assert/strict';
import test from 'node:test';

import { canonicalizeAttachmentUrls } from './attachment-url-refresh';

test('uses signed URLs for display and canonical proxy URLs for persistence', () => {
    const path = 'user/thread/image.png';
    const result = canonicalizeAttachmentUrls(
        [{ id: 'message-1', attachments: [{ id: 'attachment-1', name: 'image.png', path, mimeType: 'image/png', size: 10, url: 'https://expired.example' }] }],
        'thread-1',
        new Map([[path, 'https://signed.example/image.png']]),
    );

    assert.equal(result.messages[0].attachments?.[0].url, 'https://signed.example/image.png');
    assert.equal(result.messagesToPersist[0].attachments[0].url, `/api/uploads?threadId=thread-1&path=${encodeURIComponent(path)}`);
});

test('does not rewrite messages that already use canonical URLs', () => {
    const path = 'user/thread/file.txt';
    const canonical = `/api/uploads?threadId=thread-1&path=${encodeURIComponent(path)}`;
    const result = canonicalizeAttachmentUrls(
        [{ id: 'message-1', attachments: [{ id: 'attachment-1', name: 'file.txt', path, mimeType: 'text/plain', size: 3, url: canonical }] }],
        'thread-1',
        new Map(),
    );
    assert.equal(result.messagesToPersist.length, 0);
});
