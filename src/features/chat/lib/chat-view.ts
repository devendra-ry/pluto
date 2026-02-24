import { type Attachment } from '@/shared/core/types';

export interface ChatResponseStats {
    outputTokens: number;
    seconds: number;
    tokensPerSecond: number;
    ttfbSeconds?: number;
}

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
