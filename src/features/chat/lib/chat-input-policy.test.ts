import assert from 'node:assert/strict';
import test from 'node:test';

import { isFileAllowedForChatInput } from './chat-input-policy';

test('checks attachment MIME types against model capabilities', () => {
    const visionOnly = { images: true, pdfs: false, texts: false };
    assert.equal(isFileAllowedForChatInput('image/png', visionOnly), true);
    assert.equal(isFileAllowedForChatInput('application/pdf', visionOnly), false);
    assert.equal(isFileAllowedForChatInput('application/zip', visionOnly), false);
});
