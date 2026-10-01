import { test } from 'node:test';
import assert from 'node:assert';
import { buildAttachmentProxyUrl } from './attachment-url';

test('buildAttachmentProxyUrl encodes thread and object paths', () => {
    assert.strictEqual(
        buildAttachmentProxyUrl('thread/id', 'user/thread/file name.png'),
        '/api/uploads?threadId=thread%2Fid&path=user%2Fthread%2Ffile+name.png',
    );
});
