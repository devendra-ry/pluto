import assert from 'node:assert/strict';
import test from 'node:test';
import {
    CHAT_TEXT_DRAFTS_STORAGE_KEY,
    CHAT_TEXT_DRAFT_MAX_COUNT,
    CHAT_TEXT_DRAFT_TTL_MS,
    clearTextDrafts,
    loadTextDraft,
    saveTextDraft,
} from './text-draft-storage';

class MemoryStorage {
    private values = new Map<string, string>();
    getItem(key: string) { return this.values.get(key) ?? null; }
    setItem(key: string, value: string) { this.values.set(key, value); }
    removeItem(key: string) { this.values.delete(key); }
}

test('text drafts are isolated by user and conversation scope', () => {
    const storage = new MemoryStorage();
    saveTextDraft(storage, 'alice', 'home', 'Home draft', 100);
    saveTextDraft(storage, 'alice', 'thread-1', 'Thread draft', 101);
    saveTextDraft(storage, 'bob', 'home', 'Other user', 102);

    assert.equal(loadTextDraft(storage, 'alice', 'home', 103), 'Home draft');
    assert.equal(loadTextDraft(storage, 'alice', 'thread-1', 103), 'Thread draft');
    assert.equal(loadTextDraft(storage, 'bob', 'home', 103), 'Other user');
    assert.equal(loadTextDraft(storage, null, 'home', 103), '');
});

test('expired text drafts are ignored and the store stays bounded', () => {
    const storage = new MemoryStorage();
    saveTextDraft(storage, 'alice', 'expired', 'Old', 0);
    assert.equal(loadTextDraft(storage, 'alice', 'expired', CHAT_TEXT_DRAFT_TTL_MS + 1), '');
    saveTextDraft(storage, 'alice', 'too-long', 'Previous', 1);
    saveTextDraft(storage, 'alice', 'too-long', 'x'.repeat(100_001), 2);
    assert.equal(loadTextDraft(storage, 'alice', 'too-long', 3), '');

    for (let index = 0; index < CHAT_TEXT_DRAFT_MAX_COUNT + 2; index += 1) {
        saveTextDraft(storage, 'alice', `thread-${index}`, `Draft ${index}`, index + 1);
    }
    const persisted = JSON.parse(storage.getItem(CHAT_TEXT_DRAFTS_STORAGE_KEY) ?? '[]') as unknown[];
    assert.equal(persisted.length, CHAT_TEXT_DRAFT_MAX_COUNT);
    assert.equal(loadTextDraft(storage, 'alice', 'thread-0', 100), '');
});

test('clearing one scope and clearing all drafts remove persisted text', () => {
    const storage = new MemoryStorage();
    saveTextDraft(storage, 'alice', 'home', 'Home', 1);
    saveTextDraft(storage, 'alice', 'thread-1', 'Thread', 2);
    saveTextDraft(storage, 'alice', 'home', '', 3);
    assert.equal(loadTextDraft(storage, 'alice', 'home', 4), '');
    assert.equal(loadTextDraft(storage, 'alice', 'thread-1', 4), 'Thread');

    clearTextDrafts(storage);
    assert.equal(storage.getItem(CHAT_TEXT_DRAFTS_STORAGE_KEY), null);
});

test('storage failures are best-effort and do not escape the storage helper', () => {
    const blockedStorage = {
        getItem() { throw new DOMException('Blocked', 'SecurityError'); },
        setItem() { throw new DOMException('Quota exceeded', 'QuotaExceededError'); },
        removeItem() { throw new DOMException('Blocked', 'SecurityError'); },
    };
    assert.equal(loadTextDraft(blockedStorage, null, 'home'), '');
    assert.equal(saveTextDraft(blockedStorage, null, 'home', 'Draft'), false);
    assert.equal(clearTextDrafts(blockedStorage), false);
});
