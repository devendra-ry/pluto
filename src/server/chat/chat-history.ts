import type { Attachment, ChatMessage } from '@/shared/core/types';
import { AttachmentSchema } from '@/shared/core/types';

/** Keep history reads narrow: reasoning, model metadata, and reply stats are not provider inputs. */
export const CHAT_HISTORY_SELECT_COLUMNS = 'id,thread_id,role,content,attachments';

export interface ChatHistoryRow {
    id: string;
    thread_id: string;
    role: string;
    content: string | null;
    attachments: unknown;
}

export interface ChatHistoryMessage extends ChatMessage {
    id: string;
    thread_id: string;
}

function parseAttachments(value: unknown): Attachment[] {
    if (!Array.isArray(value)) return [];
    return value.flatMap((attachment) => {
        const parsed = AttachmentSchema.safeParse(attachment);
        return parsed.success ? [parsed.data] : [];
    });
}

export function mapChatHistoryRow(row: ChatHistoryRow): ChatHistoryMessage {
    return {
        id: row.id,
        thread_id: row.thread_id,
        role: row.role === 'assistant' ? 'assistant' : 'user',
        content: row.content ?? '',
        attachments: parseAttachments(row.attachments),
    };
}
