export const CHAT_TEXT_DRAFTS_STORAGE_KEY = 'pluto:text-drafts:v1';
export const CHAT_TEXT_DRAFT_TTL_MS = 14 * 24 * 60 * 60 * 1000;
export const CHAT_TEXT_DRAFT_MAX_COUNT = 20;
export const CHAT_TEXT_DRAFT_MAX_CHARS = 100_000;
const CHAT_TEXT_DRAFT_MAX_TOTAL_CHARS = 200_000;

export interface StoredTextDraft {
    userId: string | null;
    scopeId: string;
    text: string;
    updatedAt: number;
}

type StorageLike = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>;

function draftId(userId: string | null, scopeId: string) {
    return `${userId ?? 'anonymous'}\u0000${scopeId}`;
}

function readDrafts(storage: StorageLike, now: number): StoredTextDraft[] {
    try {
        const raw = storage.getItem(CHAT_TEXT_DRAFTS_STORAGE_KEY);
        if (!raw) return [];
        const parsed: unknown = JSON.parse(raw);
        if (!Array.isArray(parsed)) return [];
        return parsed.filter((draft): draft is StoredTextDraft =>
            draft !== null
            && typeof draft === 'object'
            && (typeof draft.userId === 'string' || draft.userId === null)
            && typeof draft.scopeId === 'string'
            && typeof draft.text === 'string'
            && draft.text.length > 0
            && draft.text.length <= CHAT_TEXT_DRAFT_MAX_CHARS
            && typeof draft.updatedAt === 'number'
            && now - draft.updatedAt <= CHAT_TEXT_DRAFT_TTL_MS
            && draft.updatedAt <= now + 60_000
        );
    } catch {
        return [];
    }
}

function writeDrafts(storage: StorageLike, drafts: StoredTextDraft[]) {
    try {
        if (drafts.length === 0) storage.removeItem(CHAT_TEXT_DRAFTS_STORAGE_KEY);
        else storage.setItem(CHAT_TEXT_DRAFTS_STORAGE_KEY, JSON.stringify(drafts));
        return true;
    } catch {
        // Avoid recovering an older snapshot after a later save hit quota.
        try { storage.removeItem(CHAT_TEXT_DRAFTS_STORAGE_KEY); } catch { /* best effort */ }
        return false;
    }
}

function boundDrafts(drafts: StoredTextDraft[]) {
    const ordered = [...drafts].sort((a, b) => b.updatedAt - a.updatedAt);
    const result: StoredTextDraft[] = [];
    let totalChars = 0;
    for (const draft of ordered) {
        if (result.length >= CHAT_TEXT_DRAFT_MAX_COUNT) continue;
        if (totalChars + draft.text.length > CHAT_TEXT_DRAFT_MAX_TOTAL_CHARS) continue;
        result.push(draft);
        totalChars += draft.text.length;
    }
    return result;
}

export function loadTextDraft(
    storage: StorageLike,
    userId: string | null,
    scopeId: string,
    now = Date.now(),
): string {
    return readDrafts(storage, now).find(draft => draftId(draft.userId, draft.scopeId) === draftId(userId, scopeId))?.text ?? '';
}

export function saveTextDraft(
    storage: StorageLike,
    userId: string | null,
    scopeId: string,
    text: string,
    now = Date.now(),
) {
    const drafts = readDrafts(storage, now).filter(draft => draftId(draft.userId, draft.scopeId) !== draftId(userId, scopeId));
    if (text.length === 0) return writeDrafts(storage, drafts);
    if (text.length > CHAT_TEXT_DRAFT_MAX_CHARS) {
        writeDrafts(storage, drafts);
        return false;
    }
    return writeDrafts(storage, boundDrafts([...drafts, { userId, scopeId, text, updatedAt: now }]));
}

export function clearTextDrafts(storage: StorageLike) {
    try {
        storage.removeItem(CHAT_TEXT_DRAFTS_STORAGE_KEY);
        return true;
    } catch {
        return false;
    }
}
