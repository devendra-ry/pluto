import type { SupabaseClient } from '@supabase/supabase-js';
import { buildAttachmentProxyUrl } from '@/features/attachments';
import type { Database } from '@/shared/lib/supabase/database.types';
import { type Message, MESSAGE_SELECT_COLUMNS, mapMessageRowToMessage } from './message-helpers';

export const MESSAGE_PAGE_SIZE = 50;
export interface MessageCursor { createdAt: string; id: string }
export interface MessagePage { messages: Message[]; olderCursor: MessageCursor | null }

export function messageCursorFilter(cursor: MessageCursor) {
    if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,6})?(?:Z|[+-]\d{2}:\d{2})$/.test(cursor.createdAt)
        || !/^[\da-f]{8}-[\da-f]{4}-[\da-f]{4}-[\da-f]{4}-[\da-f]{12}$/i.test(cursor.id)) {
        throw new Error('Invalid message cursor');
    }
    return `created_at.lt."${cursor.createdAt}",and(created_at.eq."${cursor.createdAt}",id.lt.${cursor.id})`;
}
// Only mounted image/link consumers fetch these stable authenticated URLs.
export function canonicalMessageAttachments(message: Message): Message {
    return { ...message, attachments: (message.attachments ?? []).map(attachment => {
        // Shared objects remain authorized through their surviving conversation.
        return { ...attachment, url: buildAttachmentProxyUrl(message.thread_id, attachment.path) };
    }) };
}

export async function loadMessagePage(
    supabase: SupabaseClient<Database>, threadId: string,
    before: MessageCursor | null = null, signal?: AbortSignal,
): Promise<MessagePage> {
    let request = supabase.from('messages').select(MESSAGE_SELECT_COLUMNS)
        .eq('thread_id', threadId).is('deleted_at', null)
        .order('created_at', { ascending: false }).order('id', { ascending: false })
        .limit(MESSAGE_PAGE_SIZE + 1);
    if (before) request = request.or(messageCursorFilter(before));
    if (signal) request = request.abortSignal(signal);
    const { data, error } = await request;
    if (error) throw error;
    const rows = data ?? [];
    const pageRows = rows.slice(0, MESSAGE_PAGE_SIZE);
    const oldest = pageRows.at(-1);
    return {
        messages: pageRows.map(mapMessageRowToMessage).map(canonicalMessageAttachments).reverse(),
        olderCursor: rows.length > MESSAGE_PAGE_SIZE && oldest ? { createdAt: oldest.created_at, id: oldest.id } : null,
    };
}
