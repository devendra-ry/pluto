'use client';

import { useCallback, useLayoutEffect, useRef, type Dispatch, type RefObject, type SetStateAction } from 'react';

import { deleteMessagesByIds } from '@/features/messages';
import type { ChatViewMessage } from '@/shared/contracts/chat';
import type { ChatActionGate } from '../lib/chat-action-gate';

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
    actionGate: ChatActionGate<string>;
    isLoading: boolean;
}

function restoreMissingMessages(
    currentMessages: ChatViewMessage[],
    originalMessages: ChatViewMessage[],
    restoreIds: ReadonlySet<string>,
): ChatViewMessage[] {
    const restored = [...currentMessages];
    const presentIds = new Set(restored.map(message => message.id));

    originalMessages.forEach((message, index) => {
        if (!restoreIds.has(message.id) || presentIds.has(message.id)) return;
        const nextOriginal = originalMessages
            .slice(index + 1)
            .find(candidate => presentIds.has(candidate.id));
        const insertAt = nextOriginal
            ? restored.findIndex(candidate => candidate.id === nextOriginal.id)
            : restored.length;
        restored.splice(insertAt < 0 ? restored.length : insertAt, 0, message);
        presentIds.add(message.id);
    });

    return restored;
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
    actionGate,
    isLoading,
}: UseRetryLogicParams) {
    const messagesRef = useRef(messages);
    useLayoutEffect(() => {
        messagesRef.current = messages;
    }, [messages]);

    const handleRetry = useCallback(async (messageId: string) => {
        if (isLoading) return;
        const lease = actionGate.acquire(chatId);
        if (!lease) return;

        setIsLoading(true);
        const localMessages = messagesRef.current;
        const clickedMessageIndex = localMessages.findIndex(m => m.id === messageId);
        if (clickedMessageIndex === -1) {
            setIsLoading(false);
            actionGate.release(lease);
            return;
        }
        let msgIndex = clickedMessageIndex;

        // If retrying an assistant message, find the preceding user message.
        const clickedMessage = localMessages[msgIndex];
        if (!clickedMessage) {
            setIsLoading(false);
            actionGate.release(lease);
            return;
        }
        if (clickedMessage.role === 'assistant') {
            msgIndex = localMessages.slice(0, msgIndex).findLastIndex(m => m.role === 'user');
            if (msgIndex === -1) {
                setIsLoading(false);
                actionGate.release(lease);
                return;
            }
        } else if (clickedMessage.role !== 'user') {
            setIsLoading(false);
            actionGate.release(lease);
            return;
        }

        const anchorMessage = localMessages[msgIndex];
        if (!anchorMessage) {
            setIsLoading(false);
            actionGate.release(lease);
            return;
        }
        const anchorMessageId = anchorMessage.id;
        const deleteIds = localMessages.slice(msgIndex + 1).map((message) => message.id);
        const previousMessages = localMessages.slice(0, msgIndex + 1);
        let deletionCommitted = false;
        try {
            if (deleteIds.length > 0) {
                const confirmed = await confirmDestructiveDelete({
                    action: 'retry',
                    deleteCount: deleteIds.length,
                });
                if (!actionGate.isCurrent(lease)) return;
                if (!confirmed) {
                    setIsLoading(false);
                    return;
                }
            }
            if (deleteIds.length > 0) {
                deleteIds.forEach((id) => locallyDeletedMessageIdsRef.current.add(id));
            }
            const deleteIdSet = new Set(deleteIds);
            setMessages(prev => actionGate.isValid(lease)
                ? prev.filter(message => !deleteIdSet.has(message.id))
                : prev);
            try {
                await deleteMessagesByIds(deleteIds, {
                    reason: 'retry',
                    anchorMessageId,
                    threadId: chatId,
                });
                deletionCommitted = true;
            } catch (error) {
                if (!actionGate.isCurrent(lease)) {
                    deleteIds.forEach(id => locallyDeletedMessageIdsRef.current.delete(id));
                    return;
                }
                deleteIds.forEach(id => locallyDeletedMessageIdsRef.current.delete(id));
                setMessages(prev => actionGate.isValid(lease)
                    ? restoreMissingMessages(prev, localMessages, deleteIdSet)
                    : prev);
                throw error;
            }
            if (!actionGate.isCurrent(lease)) {
                deleteIds.forEach(id => locallyDeletedMessageIdsRef.current.delete(id));
                return;
            }
            await generateResponse(previousMessages);
        } catch (error) {
            if (actionGate.isCurrent(lease)) {
                setIsLoading(false);
                console.error('Failed to retry message:', error);
                showToast(
                    deletionCommitted
                        ? 'Failed to generate response. Please try again.'
                        : 'Failed to delete previous responses. Please try again.',
                    'error',
                );
            }
        } finally {
            if (actionGate.isCurrent(lease)) setIsLoading(false);
            actionGate.release(lease);
        }
    }, [
        isLoading,
        actionGate,
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
