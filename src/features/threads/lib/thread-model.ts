import { DEFAULT_MODEL } from '@/shared/core/constants';
import type { ReasoningEffort } from '@/shared/core/types';
import type { Thread } from '@/shared/contracts/thread';
import type { Database } from '@/utils/supabase/database.types';

export const THREAD_SELECT_COLUMNS = 'id,title,model,reasoning_effort,system_prompt,is_pinned,created_at,updated_at,user_id';
export const THREADS_PAGE_SIZE = 50;

type ThreadRow = Database['public']['Tables']['threads']['Row'];

export function compareThreadsByUpdatedAtDesc(a: Thread, b: Thread) {
    const byUpdatedAt = b.updated_at.localeCompare(a.updated_at);
    return byUpdatedAt !== 0 ? byUpdatedAt : b.id.localeCompare(a.id);
}

export function upsertThreadSorted(threads: Thread[], nextThread: Thread): Thread[] {
    const withoutNext = threads.filter((thread) => thread.id !== nextThread.id);
    let insertAt = withoutNext.length;
    for (let i = 0; i < withoutNext.length; i += 1) {
        if (compareThreadsByUpdatedAtDesc(nextThread, withoutNext[i]) < 0) {
            insertAt = i;
            break;
        }
    }
    return [...withoutNext.slice(0, insertAt), nextThread, ...withoutNext.slice(insertAt)];
}

export function mergeThreadsSorted(existing: Thread[], incoming: Thread[]) {
    if (incoming.length === 0) return existing;
    const byId = new Map(existing.map((thread) => [thread.id, thread]));
    for (const thread of incoming) {
        if (!byId.has(thread.id)) byId.set(thread.id, thread);
    }
    return Array.from(byId.values()).sort(compareThreadsByUpdatedAtDesc);
}

export function toReasoningEffort(value: unknown): ReasoningEffort | undefined {
    return value === 'low' || value === 'medium' || value === 'high' ? value : undefined;
}

export function mapThreadRowToThread(row: ThreadRow): Thread {
    return {
        id: row.id,
        title: row.title ?? 'New Chat',
        model: row.model ?? DEFAULT_MODEL,
        reasoning_effort: toReasoningEffort(row.reasoning_effort),
        system_prompt: row.system_prompt,
        is_pinned: row.is_pinned ?? undefined,
        created_at: row.created_at,
        updated_at: row.updated_at,
        user_id: row.user_id,
    };
}

export function toThread(value: unknown): Thread | null {
    if (!value || typeof value !== 'object') return null;
    const record = value as Record<string, unknown>;
    if (
        typeof record.id !== 'string'
        || typeof record.title !== 'string'
        || typeof record.model !== 'string'
        || typeof record.created_at !== 'string'
        || typeof record.updated_at !== 'string'
    ) return null;

    return {
        id: record.id,
        title: record.title,
        model: record.model,
        reasoning_effort: toReasoningEffort(record.reasoning_effort),
        system_prompt: typeof record.system_prompt === 'string' ? record.system_prompt : null,
        is_pinned: typeof record.is_pinned === 'boolean' ? record.is_pinned : undefined,
        created_at: record.created_at,
        updated_at: record.updated_at,
        user_id: typeof record.user_id === 'string' ? record.user_id : undefined,
    };
}
