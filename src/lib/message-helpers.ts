import type { Database } from '@/utils/supabase/database.types';
import type { Attachment } from '@/lib/types';

export interface Message {
    id: string;
    thread_id: string;
    role: 'user' | 'assistant';
    content: string;
    attachments?: Attachment[];
    reasoning?: string;
    model_id?: string;
    created_at: string;
    deleted_at?: string | null;
}

export const MESSAGE_SELECT_COLUMNS = 'id,thread_id,role,content,attachments,reasoning,model_id,created_at,deleted_at';
export type MessageRow = Pick<
    Database['public']['Tables']['messages']['Row'],
    'id' | 'thread_id' | 'role' | 'content' | 'attachments' | 'reasoning' | 'model_id' | 'created_at' | 'deleted_at'
>;

export function sortMessagesByCreatedAt(messages: Message[]) {
    return [...messages].sort((a, b) => {
        const byCreatedAt = a.created_at.localeCompare(b.created_at);
        if (byCreatedAt !== 0) return byCreatedAt;
        return a.id.localeCompare(b.id);
    });
}

export function mergeMessagesSorted(existing: Message[], incoming: Message[]) {
    if (incoming.length === 0) return existing;
    const byId = new Map(existing.map((message) => [message.id, message]));
    for (const message of incoming) {
        byId.set(message.id, message);
    }
    return sortMessagesByCreatedAt(Array.from(byId.values()));
}

export function removeMessagesById(existing: Message[], ids: Set<string>) {
    if (ids.size === 0) return existing;
    return existing.filter((message) => !ids.has(message.id));
}

export function attachmentsFromUnknown(value: unknown): Attachment[] {
    if (!Array.isArray(value)) return [];
    const attachments: Attachment[] = [];
    for (const item of value) {
        if (!item || typeof item !== 'object') continue;
        const record = item as Record<string, unknown>;
        if (
            typeof record.id === 'string' &&
            typeof record.name === 'string' &&
            typeof record.mimeType === 'string' &&
            typeof record.size === 'number' &&
            typeof record.path === 'string' &&
            typeof record.url === 'string'
        ) {
            attachments.push({
                id: record.id,
                name: record.name,
                mimeType: record.mimeType,
                size: record.size,
                path: record.path,
                url: record.url,
            });
        }
    }
    return attachments;
}

export function toMessage(value: unknown): Message | null {
    if (!value || typeof value !== 'object') return null;
    const record = value as Record<string, unknown>;

    if (
        typeof record.id !== 'string' ||
        typeof record.thread_id !== 'string' ||
        (record.role !== 'user' && record.role !== 'assistant') ||
        typeof record.created_at !== 'string'
    ) {
        return null;
    }

    return {
        id: record.id,
        thread_id: record.thread_id,
        role: record.role,
        content: typeof record.content === 'string' ? record.content : '',
        attachments: attachmentsFromUnknown(record.attachments),
        reasoning: typeof record.reasoning === 'string' ? record.reasoning : undefined,
        model_id: typeof record.model_id === 'string' ? record.model_id : undefined,
        created_at: record.created_at,
        deleted_at: typeof record.deleted_at === 'string' ? record.deleted_at : null,
    };
}

export function mapMessageRowToMessage(row: MessageRow): Message {
    return {
        id: row.id,
        thread_id: row.thread_id,
        role: row.role === 'assistant' ? 'assistant' : 'user',
        content: row.content ?? '',
        attachments: attachmentsFromUnknown(row.attachments),
        reasoning: row.reasoning ?? undefined,
        model_id: row.model_id ?? undefined,
        created_at: row.created_at,
        deleted_at: row.deleted_at ?? null,
    };
}
