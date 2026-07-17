import type { Attachment, ChatResponseStats } from '@/shared/core/types';

export interface ChatViewMessage {
    id: string;
    role: 'user' | 'assistant';
    content: string;
    attachments?: Attachment[];
    reasoning?: string;
    model_id?: string;
    stats?: ChatResponseStats;
}

export type RetryMode = 'chat' | 'search' | 'image' | 'video';

export interface PreparedAttachment {
    name: string;
    mimeType: string;
    base64Data: string;
}

export interface PreparedChatMessage {
    role: 'user' | 'assistant';
    content: string;
    attachments: PreparedAttachment[];
}
