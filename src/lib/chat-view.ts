import { type Attachment } from '@/lib/types';

export interface ChatViewMessage {
    id: string;
    role: 'user' | 'assistant';
    content: string;
    attachments?: Attachment[];
    reasoning?: string;
    model_id?: string;
}

export type RetryMode = 'chat' | 'search' | 'image' | 'video';
