import { DEFAULT_MODEL } from '@/shared/core/constants';
import { toReasoningEffort } from '@/shared/core/types';
import type { Thread } from '@/shared/contracts/thread';
import type { Database } from '@/shared/lib/supabase/database.types';
import { z } from 'zod';

export const THREAD_SELECT_COLUMNS = 'id,title,model,reasoning_effort,system_prompt,is_pinned,created_at,updated_at,user_id';
export const THREADS_PAGE_SIZE = 50;

export function sanitizeThreadTitle(raw: string, maxBaseLength: number = 50): string {
    const cleaned = raw
        .replace(/[\u0000-\u001F\u007F]/g, ' ')
        .replace(/[\u200B-\u200D\uFEFF]/g, '')
        .replace(/[<>]/g, '')
        .replace(/\s+/g, ' ')
        .trim();

    if (!cleaned) return 'New Chat';
    if (cleaned.length > maxBaseLength) return `${cleaned.slice(0, maxBaseLength)}...`;
    return cleaned;
}

type ThreadRow = Database['public']['Tables']['threads']['Row'];

function compareThreadsByUpdatedAtDesc(a: Thread, b: Thread) {
    const byUpdatedAt = b.updated_at.localeCompare(a.updated_at);
    return byUpdatedAt !== 0 ? byUpdatedAt : b.id.localeCompare(a.id);
}

export function upsertThreadSorted(threads: Thread[], nextThread: Thread): Thread[] {
    const withoutNext = threads.filter((thread) => thread.id !== nextThread.id);
    let insertAt = withoutNext.length;
    for (let i = 0; i < withoutNext.length; i += 1) {
        const thread = withoutNext[i];
        if (thread && compareThreadsByUpdatedAtDesc(nextThread, thread) < 0) {
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

export function mapThreadRowToThread(row: ThreadRow): Thread {
    const reasoningEffort = toReasoningEffort(row.reasoning_effort);
    return {
        id: row.id,
        title: row.title ?? 'New Chat',
        model: row.model ?? DEFAULT_MODEL,
        ...(reasoningEffort === undefined ? {} : { reasoning_effort: reasoningEffort }),
        system_prompt: row.system_prompt,
        ...(row.is_pinned === null ? {} : { is_pinned: row.is_pinned }),
        created_at: row.created_at,
        updated_at: row.updated_at,
        user_id: row.user_id,
    };
}

export function toThread(value: unknown): Thread | null {
    const parsedRecord = z.record(z.string(), z.unknown()).safeParse(value);
    if (!parsedRecord.success) return null;
    const record = parsedRecord.data;
    if (
        typeof record.id !== 'string'
        || typeof record.title !== 'string'
        || typeof record.model !== 'string'
        || typeof record.created_at !== 'string'
        || typeof record.updated_at !== 'string'
    ) return null;

    const reasoningEffort = toReasoningEffort(record.reasoning_effort);
    const userId = typeof record.user_id === 'string' ? record.user_id : undefined;
    return {
        id: record.id,
        title: record.title,
        model: record.model,
        ...(reasoningEffort === undefined ? {} : { reasoning_effort: reasoningEffort }),
        system_prompt: typeof record.system_prompt === 'string' ? record.system_prompt : null,
        ...(typeof record.is_pinned === 'boolean' ? { is_pinned: record.is_pinned } : {}),
        created_at: record.created_at,
        updated_at: record.updated_at,
        ...(userId === undefined ? {} : { user_id: userId }),
    };
}
