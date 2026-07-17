import assert from 'node:assert/strict';
import test from 'node:test';

import { isFileAllowedForChatInput, validateChatSubmission } from './chat-input-policy';

test('requires prompts and source images in editing modes', () => {
    assert.equal(validateChatSubmission('image-edit', '', 0), 'Attach at least one image for Image Edit mode');
    assert.equal(validateChatSubmission('image-edit', '', 1), 'Enter an edit prompt for Image Edit mode');
    assert.equal(validateChatSubmission('video', 'move', 0), 'Attach an image for Image to Video mode');
    assert.equal(validateChatSubmission('video', 'move', 1), null);
});

test('checks attachment MIME types against model capabilities', () => {
    const visionOnly = { images: true, pdfs: false, texts: false };
    assert.equal(isFileAllowedForChatInput('image/png', false, visionOnly), true);
    assert.equal(isFileAllowedForChatInput('application/pdf', false, visionOnly), false);
    assert.equal(isFileAllowedForChatInput('image/png', true, { images: false, pdfs: false, texts: false }), true);
    assert.equal(isFileAllowedForChatInput('application/zip', false, visionOnly), false);
});
