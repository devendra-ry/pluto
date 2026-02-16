'use client';

import { type RefObject } from 'react';
import { Virtuoso, type VirtuosoHandle } from 'react-virtuoso';

import { ChatMessage } from '@/components/chat-message';
import { AVAILABLE_MODELS } from '@/lib/constants';
import { type ChatViewMessage } from '@/lib/chat-view';
import { cn } from '@/lib/utils';

interface ChatMessageListProps {
    messages: ChatViewMessage[];
    model: string;
    isLoading: boolean;
    isThinking: boolean;
    virtuosoRef: RefObject<VirtuosoHandle | null>;
    setIsAtBottom: (isAtBottom: boolean) => void;
    onEdit: (messageId: string, newContent: string) => void;
    onRetry: (messageId: string) => void;
}

// Regex to fix markdown headings without space after #.
const HEADING_FIX_REGEX = /^(#{1,6})([^#\s])/gm;

export function ChatMessageList({
    messages,
    model,
    isLoading,
    isThinking,
    virtuosoRef,
    setIsAtBottom,
    onEdit,
    onRetry,
}: ChatMessageListProps) {
    return (
        <Virtuoso
            ref={virtuosoRef}
            className="scrollbar-none"
            data={messages}
            followOutput="auto"
            atBottomThreshold={60}
            atBottomStateChange={setIsAtBottom}
            initialTopMostItemIndex={messages.length - 1}
            itemContent={(index, message) => {
                const messageModelId = message.model_id || (message.role === 'assistant' ? model : undefined);
                const selectedModel = AVAILABLE_MODELS.find((m) => m.id === messageModelId);
                return (
                    <div className={cn('max-w-3xl mx-auto', index === 0 ? 'pt-12' : 'pt-4')}>
                        <ChatMessage
                            key={message.id}
                            id={message.id}
                            role={message.role}
                            content={message.content.replace(HEADING_FIX_REGEX, '$1 $2')}
                            attachments={message.attachments}
                            reasoning={message.reasoning}
                            isStreaming={isLoading && index === messages.length - 1 && message.role === 'assistant'}
                            isThinking={isThinking && index === messages.length - 1 && message.role === 'assistant'}
                            modelName={message.role === 'assistant' ? selectedModel?.name : undefined}
                            onEdit={message.role === 'user' ? onEdit : undefined}
                            onRetry={onRetry}
                        />
                    </div>
                );
            }}
        />
    );
}
