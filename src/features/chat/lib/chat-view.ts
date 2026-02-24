import { type Attachment, type ChatResponseStats } from '@/shared/core/types';
export type { ChatResponseStats } from '@/shared/core/types';

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
