import { sanitizeThreadTitle } from '@/features/threads/lib/sanitize-thread-title';
import type { ChatViewMessage } from '@/shared/contracts/chat';
import type { Json } from '@/utils/supabase/database.types';

export function selectMessagesThroughBranch(messages: ChatViewMessage[], messageId: string) {
    const messageIndex = messages.findIndex((message) => message.id === messageId);
    if (messageIndex === -1) throw new Error('Selected message not found in conversation history.');
    return messages.slice(0, messageIndex + 1);
}

export function buildBranchTitle(parentTitle: string) {
    return parentTitle === 'New Chat' ? 'New Chat' : sanitizeThreadTitle(`Branch of ${parentTitle}`, 47);
}

export function buildBranchMessageRows(
    messages: ChatViewMessage[],
    threadId: string,
    userId: string,
    createdAtById: ReadonlyMap<string, string>,
    fallbackCreatedAt: string
) {
    return messages.map((message) => ({
        thread_id: threadId,
        role: message.role,
        content: message.content,
        attachments: (message.attachments ?? []) as Json,
        reasoning: message.reasoning || null,
        model_id: message.model_id || null,
        reply_stats: (message.stats ?? null) as Json,
        user_id: userId,
        created_at: createdAtById.get(message.id) ?? fallbackCreatedAt,
    }));
}
