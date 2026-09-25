'use client';

import { useCallback, useLayoutEffect, useRef, type Dispatch, type RefObject, type SetStateAction } from 'react';

import { deleteMessagesByIds } from '@/features/messages';
import type { ChatViewMessage } from '@/shared/contracts/chat';

type ToastType = 'success' | 'error' | 'info';

interface UseRetryLogicParams {
    chatId: string;
    messages: ChatViewMessage[];
    setMessages: Dispatch<SetStateAction<ChatViewMessage[]>>;
    setIsLoading: Dispatch<SetStateAction<boolean>>;
    showToast: (message: string, type?: ToastType) => void;
    generateResponse: (
        currentMessages: ChatViewMessage[],
        forcedModelId?: string,
        forcedSystemPrompt?: string
    ) => Promise<boolean>;
    locallyDeletedMessageIdsRef: RefObject<Set<string>>;
    confirmDestructiveDelete: (context: {
        action: 'retry';
        deleteCount: number;
    }) => Promise<boolean>;
}

export function useRetryLogic({
    chatId,
    messages,
    setMessages,
    setIsLoading,
    showToast,
    generateResponse,
    locallyDeletedMessageIdsRef,
    confirmDestructiveDelete,
}: UseRetryLogicParams) {
    const messagesRef = useRef(messages);
    useLayoutEffect(() => {
        messagesRef.current = messages;
    }, [messages]);

    const handleRetry = useCallback(async (messageId: string) => {
        setIsLoading(true);
        const localMessages = messagesRef.current;
        const clickedMessageIndex = localMessages.findIndex(m => m.id === messageId);
        if (clickedMessageIndex === -1) {
            setIsLoading(false);
            return;
        }
        let msgIndex = clickedMessageIndex;

        // If retrying an assistant message, find the preceding user message.
        const clickedMessage = localMessages[msgIndex];
        if (!clickedMessage) {
            setIsLoading(false);
            return;
        }
        if (clickedMessage.role === 'assistant') {
            msgIndex = localMessages.slice(0, msgIndex).findLastIndex(m => m.role === 'user');
            if (msgIndex === -1) {
                setIsLoading(false);
                return;
            }
        } else if (clickedMessage.role !== 'user') {
            setIsLoading(false);
            return;
        }

        const anchorMessage = localMessages[msgIndex];
        if (!anchorMessage) {
            setIsLoading(false);
            return;
        }
        const anchorMessageId = anchorMessage.id;
        const deleteIds = localMessages.slice(msgIndex + 1).map((message) => message.id);
        const previousMessages = localMessages.slice(0, msgIndex + 1);
        try {
            if (deleteIds.length > 0) {
                const confirmed = await confirmDestructiveDelete({
                    action: 'retry',
                    deleteCount: deleteIds.length,
                });
                if (!confirmed) {
                    setIsLoading(false);
                    return;
                }
            }
            if (deleteIds.length > 0) {
                deleteIds.forEach((id) => locallyDeletedMessageIdsRef.current.add(id));
            }
            setMessages(previousMessages);
            await deleteMessagesByIds(deleteIds, {
                reason: 'retry',
                anchorMessageId,
                threadId: chatId,
            });
            await generateResponse(previousMessages);
        } catch (error) {
            setIsLoading(false);
            deleteIds.forEach((id) => locallyDeletedMessageIdsRef.current.delete(id));
            setMessages(localMessages);
            console.error('Failed to retry message:', error);
            showToast('Failed to delete previous responses. Please try again.', 'error');
        }
    }, [
        setIsLoading,
        chatId,
        showToast,
        locallyDeletedMessageIdsRef,
        setMessages,
        generateResponse,
        confirmDestructiveDelete,
    ]);

    return {
        handleRetry,
    };
}
