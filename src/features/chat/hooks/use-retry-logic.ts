'use client';

import { useCallback, type Dispatch, type RefObject, type SetStateAction } from 'react';

import { deleteMessagesByIds, getThreadMessages, type RefreshMessagesResult } from '@/features/messages';
import { type ChatViewMessage } from '../lib/chat-view';

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
    refreshStoredMessages: () => Promise<RefreshMessagesResult>;
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
    refreshStoredMessages,
    locallyDeletedMessageIdsRef,
    confirmDestructiveDelete,
}: UseRetryLogicParams) {
    const handleRetry = useCallback(async (messageId: string) => {
        setIsLoading(true);
        const localMessages = messages;
        const clickedMessageIndex = localMessages.findIndex(m => m.id === messageId);
        if (clickedMessageIndex === -1) {
            setIsLoading(false);
            return;
        }
        let msgIndex = clickedMessageIndex;

        // If retrying an assistant message, find the preceding user message.
        if (localMessages[msgIndex].role === 'assistant') {
            msgIndex = localMessages.slice(0, msgIndex).findLastIndex(m => m.role === 'user');
            if (msgIndex === -1) {
                setIsLoading(false);
                return;
            }
        } else if (localMessages[msgIndex].role !== 'user') {
            setIsLoading(false);
            return;
        }

        const anchorMessageId = localMessages[msgIndex].id;
        try {
            const canonicalMessages = await getThreadMessages(chatId);
            const anchorDbIndex = canonicalMessages.findIndex((m) => m.id === anchorMessageId);
            if (anchorDbIndex === -1) {
                setIsLoading(false);
                showToast('Retry failed to align with saved history. Refresh and try again.', 'error');
                return;
            }

            const deleteIds = canonicalMessages.slice(anchorDbIndex + 1).map((m) => m.id);
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
            await deleteMessagesByIds(deleteIds, {
                reason: 'retry',
                anchorMessageId,
                threadId: chatId,
            });
            const previousMessages: ChatViewMessage[] = canonicalMessages.slice(0, anchorDbIndex + 1).map((m) => ({
                id: m.id,
                role: m.role,
                content: m.content,
                attachments: m.attachments ?? [],
                reasoning: m.reasoning,
                model_id: m.model_id,
            }));

            setMessages(previousMessages);
            void (async () => {
                const refreshResult = await refreshStoredMessages();
                if (!refreshResult.ok) {
                    showToast(refreshResult.error, 'error');
                }
            })();
            await generateResponse(previousMessages);
        } catch (error) {
            setIsLoading(false);
            console.error('Failed to retry message:', error);
            showToast('Failed to delete previous responses. Please try again.', 'error');
        }
    }, [
        setIsLoading,
        messages,
        chatId,
        showToast,
        locallyDeletedMessageIdsRef,
        setMessages,
        refreshStoredMessages,
        generateResponse,
        confirmDestructiveDelete,
    ]);

    return {
        handleRetry,
    };
}
