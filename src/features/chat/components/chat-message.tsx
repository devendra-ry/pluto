'use client';

import { memo } from 'react';
import { type Attachment } from '@/shared/core/types';
import { UserMessage } from './chat-message-user';
import { AssistantMessage } from './chat-message-assistant';

interface ChatMessageProps {
    id: string;
    role: 'user' | 'assistant';
    content: string;
    attachments?: Attachment[];
    isStreaming?: boolean;
    isThinking?: boolean;
    modelName?: string;
    reasoning?: string;
    onEdit?: (id: string, newContent: string) => void;
    onRetry?: (id: string) => void;
}

export const ChatMessage = memo(function ChatMessage({
    id,
    role,
    content,
    attachments = [],
    isStreaming,
    isThinking,
    modelName,
    reasoning,
    onEdit,
    onRetry,
}: ChatMessageProps) {
    const isUser = role === 'user';

    if (isUser) {
        return (
            <UserMessage
                id={id}
                content={content}
                attachments={attachments}
                onEdit={onEdit}
                onRetry={onRetry}
            />
        );
    }

    return (
        <AssistantMessage
            id={id}
            content={content}
            attachments={attachments}
            isStreaming={isStreaming}
            isThinking={isThinking}
            modelName={modelName}
            reasoning={reasoning}
            onRetry={onRetry}
        />
    );
});