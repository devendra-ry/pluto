'use client';

import { type RefObject, useCallback } from 'react';
import { Virtuoso, type VirtuosoHandle } from 'react-virtuoso';

import { ChatMessage } from '@/features/chat/components/chat-message';
import { AVAILABLE_MODELS } from '@/shared/core/constants';
import { type ChatViewMessage } from '@/features/chat/lib/chat-view';
import { cn } from '@/shared/core/utils';

interface ChatMessageListProps {
    messages: ChatViewMessage[];
    model: string;
    isLoading: boolean;
    isThinking: boolean;
    shouldAutoFollow: boolean;
    virtuosoRef: RefObject<VirtuosoHandle | null>;
    setIsAtBottom: (isAtBottom: boolean) => void;
    onEdit: (messageId: string, newContent: string) => void;
    onRetry: (messageId: string) => void;
}

// Pre-render items well outside the viewport to avoid layout
// jumps when scrolling into unmeasured territory.
const OVERSCAN = { top: 1200, bottom: 400 };

export function ChatMessageList({
    messages,
    model,
    isLoading,
    isThinking,
    shouldAutoFollow,
    virtuosoRef,
    setIsAtBottom,
    onEdit,
    onRetry,
}: ChatMessageListProps) {
    const followOutput = useCallback(
        (isAtBottom: boolean) => (shouldAutoFollow && isAtBottom ? 'auto' : false),
        [shouldAutoFollow],
    );

    const computeItemKey = useCallback(
        (_index: number, message: ChatViewMessage) => message.id,
        [],
    );

    const renderItem = useCallback(
        (index: number, message: ChatViewMessage) => {
            const messageModelId = message.model_id || (message.role === 'assistant' ? model : undefined);
            const selectedModel = AVAILABLE_MODELS.find((m) => m.id === messageModelId);
            return (
                <div className={cn('max-w-3xl mx-auto', index === 0 ? 'pt-12' : 'pt-4')}>
                    <ChatMessage
                        key={message.id}
                        id={message.id}
                        role={message.role}
                        content={message.content}
                        attachments={message.attachments}
                        reasoning={message.reasoning}
                        stats={message.stats}
                        isStreaming={isLoading && index === messages.length - 1 && message.role === 'assistant'}
                        isThinking={isThinking && index === messages.length - 1 && message.role === 'assistant'}
                        modelName={message.role === 'assistant' ? selectedModel?.name : undefined}
                        onEdit={message.role === 'user' ? onEdit : undefined}
                        onRetry={onRetry}
                    />
                </div>
            );
        },
        [model, isLoading, isThinking, messages.length, onEdit, onRetry],
    );

    return (
        <Virtuoso
            ref={virtuosoRef}
            className="scrollbar-none"
            data={messages}
            followOutput={followOutput}
            atBottomThreshold={60}
            atBottomStateChange={setIsAtBottom}
            defaultItemHeight={150}
            increaseViewportBy={OVERSCAN}
            computeItemKey={computeItemKey}
            itemContent={renderItem}
        />
    );
}
