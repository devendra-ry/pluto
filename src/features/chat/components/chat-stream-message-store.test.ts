import assert from 'node:assert/strict';
import test from 'node:test';
import { ChatStreamMessageStore } from './chat-stream-message-store';

test('completion retains the visible snapshot until its committed props can replace it', () => {
    const store = new ChatStreamMessageStore();
    let publications = 0;
    const unsubscribe = store.subscribe('reply', () => { publications += 1; });
    const snapshot = { content: 'Answer', reasoning: 'Thought' };
    store.publish('reply', snapshot);
    store.publish('reply', { ...snapshot });
    assert.equal(publications, 1, 'identical snapshots should not rerender subscribers');
    store.complete('reply');
    assert.strictEqual(store.getSnapshot('reply'), snapshot);
    unsubscribe();
    assert.deepEqual(store.getSnapshot('reply'), { content: '', reasoning: '' });
});

test('offscreen completed messages release their temporary snapshot', () => {
    const store = new ChatStreamMessageStore();
    store.publish('reply', { content: 'Answer', reasoning: '' });
    store.complete('reply');
    assert.equal(store.getSnapshot('reply').content, '');
});
