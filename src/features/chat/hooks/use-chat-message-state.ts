'use client';

import { useCallback, useEffect, type Dispatch, type MutableRefObject, type SetStateAction } from 'react';

import { type Message } from '@/features/messages/hooks/use-messages';
import { type ChatResponseStats, type ChatViewMessage } from '@/features/chat/lib/chat-view';
import { type Attachment } from '@/shared/core/types';

function areAttachmentListsEqual(left: Attachment[] | undefined, right: Attachment[] | undefined) {
    const a = left ?? [];
    const b = right ?? [];
    if (a.length !== b.length) return false;
    for (let i = 0; i < a.length; i += 1) {
        if (
            a[i].id !== b[i].id
            || a[i].name !== b[i].name
            || a[i].mimeType !== b[i].mimeType
            || a[i].size !== b[i].size
            || a[i].path !== b[i].path
            || a[i].url !== b[i].url
        ) {
            return false;
        }
    }
    return true;
}

function areReplyStatsEqual(left: ChatResponseStats | undefined, right: ChatResponseStats | undefined) {
    if (!left && !right) return true;
    if (!left || !right) return false;
    return (
        left.outputTokens === right.outputTokens
        && left.seconds === right.seconds
        && left.tokensPerSecond === right.tokensPerSecond
        && left.ttfbSeconds === right.ttfbSeconds
        && left.inputTokens === right.inputTokens
        && left.totalTokens === right.totalTokens
        && left.source === right.source
    );
}

function shouldPreserveStats(previous: ChatViewMessage | undefined, message: Message): previous is ChatViewMessage {
    if (!previous || previous.role !== 'assistant') return false;
    return (
        previous.content === message.content
        && (previous.reasoning ?? undefined) === (message.reasoning ?? undefined)
        && (previous.model_id ?? undefined) === (message.model_id ?? undefined)
    );
}

function mapStoredMessageToViewMessage(message: Message, previousStats?: ChatResponseStats): ChatViewMessage {
    return {
        id: message.id,
        role: message.role,
        content: message.content,
        attachments: message.attachments ?? [],
        reasoning: message.reasoning,
        model_id: message.model_id,
        stats: message.reply_stats ?? previousStats,
    };
}

function isSameMessageSnapshot(view: ChatViewMessage, stored: Message) {
    const storedStats = stored.reply_stats ?? undefined;
    return (
        view.id === stored.id
        && view.role === stored.role
        && view.content === stored.content
        && (view.reasoning ?? undefined) === (stored.reasoning ?? undefined)
        && (view.model_id ?? undefined) === (stored.model_id ?? undefined)
        && areReplyStatsEqual(view.stats, storedStats)
        && areAttachmentListsEqual(view.attachments, stored.attachments)
    );
}

interface UseChatMessageStateParams {
    setMessages: Dispatch<SetStateAction<ChatViewMessage[]>>;
    storedMessages: Message[] | null;
    isLoading: boolean;
    isThinking: boolean;
    justAddedMessageIdRef: MutableRefObject<string | null>;
    locallyDeletedMessageIdsRef: MutableRefObject<Set<string>>;
}

export function useChatMessageState({
    setMessages,
    storedMessages,
    isLoading,
    isThinking,
    justAddedMessageIdRef,
    locallyDeletedMessageIdsRef,
}: UseChatMessageStateParams) {
    const applyStoredMessages = useCallback((nextStoredMessages: Message[]) => {
        setMessages((prev) => {
            if (prev.length === nextStoredMessages.length) {
                const unchanged = prev.every((message, index) =>
                    isSameMessageSnapshot(message, nextStoredMessages[index])
                );
                if (unchanged) {
                    return prev;
                }
            }

            const previousById = new Map(prev.map((message) => [message.id, message]));
            return nextStoredMessages.map((storedMessage) => {
                const previous = previousById.get(storedMessage.id);
                const stats = shouldPreserveStats(previous, storedMessage) ? previous.stats : undefined;
                return mapStoredMessageToViewMessage(storedMessage, stats);
            });
        });
    }, [setMessages]);

    useEffect(() => {
        if (storedMessages === null) return;

        // Keep local retry/edit protection while waiting for canonical cache to settle.
        if (locallyDeletedMessageIdsRef.current.size > 0) {
            const hasLocallyDeleted = storedMessages.some((m) => locallyDeletedMessageIdsRef.current.has(m.id));
            if (hasLocallyDeleted) {
                return;
            }
            locallyDeletedMessageIdsRef.current.clear();
        }

        // Avoid overriding in-progress streaming content until message IDs are canonical.
        if (justAddedMessageIdRef.current) {
            const found = storedMessages.find((m) => m.id === justAddedMessageIdRef.current);
            if (!found) {
                return;
            }
            justAddedMessageIdRef.current = null;
        }

        if (isLoading || isThinking) {
            return;
        }

        applyStoredMessages(storedMessages);
    }, [
        storedMessages,
        isLoading,
        isThinking,
        applyStoredMessages,
        justAddedMessageIdRef,
        locallyDeletedMessageIdsRef,
    ]);
    return {
        messagesReady: storedMessages !== null,
    };
}
