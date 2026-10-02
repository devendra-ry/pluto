'use client';

import { type RefObject, useCallback, useEffect, useState } from 'react';
import { Virtuoso, type VirtuosoHandle } from 'react-virtuoso';

import { ChatMessage } from './chat-message';
import { AVAILABLE_MODELS } from '@/shared/core/constants';
import type { ChatViewMessage } from '@/shared/contracts/chat';
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
    onBranch: (messageId: string) => void;
    hasOlderMessages?: boolean;
    isLoadingOlder?: boolean;
    olderMessagesError?: string | null;
    onLoadOlder?: () => void;
    highlightedMessageId?: string | null;
    scrollToMessageId?: string | null;
    onMessageScrolled?: (messageId: string) => void;
}

interface HistoryContext { hasOlder?: boolean; loading?: boolean; error?: string | null; load?: () => void }
function HistoryHeader({ context }: { context?: HistoryContext }) {
    if (!context?.hasOlder && !context?.error && !context?.loading) return null;
    return <div className="mx-auto flex max-w-3xl justify-center px-4 pt-6 pb-2">
        {context.loading ? <p role="status" className="text-sm text-muted-foreground">Loading older messages…</p>
            : <button type="button" onClick={context.load} className="min-h-10 rounded-xl border border-border px-4 text-sm text-muted-foreground hover:bg-accent hover:text-foreground">
                {context.error ? 'Could not load older messages. Try again' : 'Load older messages'}
            </button>}
    </div>;
}
const HISTORY_COMPONENTS = { Header: HistoryHeader };

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
    onBranch,
    hasOlderMessages, isLoadingOlder, olderMessagesError, onLoadOlder,
    highlightedMessageId,
    scrollToMessageId,
    onMessageScrolled,
}: ChatMessageListProps) {
    const [initialBottomReached, setInitialBottomReached] = useState(false);
    const [position, setPosition] = useState({ messages, firstIndex: 1_000_000 });
    let firstItemIndex = position.firstIndex;
    if (position.messages !== messages) {
        const oldFirst = position.messages[0]?.id;
        const newFirst = messages[0]?.id;
        const prepended = oldFirst ? messages.findIndex(message => message.id === oldFirst) : -1;
        const removed = newFirst ? position.messages.findIndex(message => message.id === newFirst) : -1;
        if (prepended > 0) firstItemIndex -= prepended;
        else if (removed > 0) firstItemIndex += removed;
        setPosition({ messages, firstIndex: firstItemIndex });
    }
    useEffect(() => {
        if (!scrollToMessageId) return;
        const messageIndex = messages.findIndex(message => message.id === scrollToMessageId);
        if (messageIndex < 0) return;
        const timer = window.setTimeout(() => {
            virtuosoRef.current?.scrollToIndex({ index: messageIndex, align: 'center', behavior: 'auto' });
            onMessageScrolled?.(scrollToMessageId);
        }, 100);
        return () => window.clearTimeout(timer);
    }, [messages, onMessageScrolled, scrollToMessageId, virtuosoRef]);
    const atBottom = useCallback((value: boolean) => {
        if (value && messages.length > 0) setInitialBottomReached(true);
        setIsAtBottom(value);
    }, [messages.length, setIsAtBottom]);
    const loadAtStart = useCallback(() => {
        if (initialBottomReached && hasOlderMessages && !isLoadingOlder && !olderMessagesError) onLoadOlder?.();
    }, [initialBottomReached, hasOlderMessages, isLoadingOlder, olderMessagesError, onLoadOlder]);
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
            index -= firstItemIndex;
            const messageModelId = message.model_id || (message.role === 'assistant' ? model : undefined);
            const selectedModel = AVAILABLE_MODELS.find((m) => m.id === messageModelId);
            return (
                <div
                    id={message.id === highlightedMessageId ? 'message-search-target' : undefined}
                    data-message-id={message.id}
                    className={cn(
                        'max-w-3xl mx-auto rounded-2xl transition-[box-shadow,background-color] duration-700',
                        index === 0 ? 'pt-12' : 'pt-4',
                        message.id === highlightedMessageId && 'bg-primary/5 ring-2 ring-primary/60 shadow-lg shadow-primary/10',
                    )}
                >
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
                        onRetry={message.role === 'user' || messages.slice(0, index).some(row => row.role === 'user') ? onRetry : undefined}
                        onBranch={onBranch}
                    />
                </div>
            );
        },
        [model, isLoading, isThinking, messages, firstItemIndex, onEdit, onRetry, onBranch, highlightedMessageId],
    );

    return (
        <Virtuoso
            ref={virtuosoRef}
            className="scrollbar-none"
            data={messages}
            firstItemIndex={firstItemIndex}
            initialTopMostItemIndex={{ index: 'LAST', align: 'end' }}
            startReached={loadAtStart}
            components={HISTORY_COMPONENTS}
            context={{ hasOlder: hasOlderMessages, loading: isLoadingOlder, error: olderMessagesError, load: onLoadOlder }}
            followOutput={followOutput}
            atBottomThreshold={60}
            atBottomStateChange={atBottom}
            defaultItemHeight={150}
            increaseViewportBy={OVERSCAN}
            computeItemKey={computeItemKey}
            itemContent={renderItem}
        />
    );
}
