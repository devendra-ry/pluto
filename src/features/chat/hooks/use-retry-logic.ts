'use client';

import { useCallback, type Dispatch, type MutableRefObject, type SetStateAction } from 'react';

import { type ChatSubmitMode } from '@/components/chat-input-components/chat-input-types';
import { deleteMessagesByIds, getThreadMessages, type RefreshMessagesResult } from '@/hooks/use-messages';
import { IMAGE_GENERATION_MODEL, isImageGenerationModel, SEARCH_ENABLED_MODELS, VIDEO_GENERATION_MODEL } from '@/lib/constants';
import { type ChatViewMessage, type RetryMode } from '@/lib/chat-view';

type ToastType = 'success' | 'error' | 'info';

const RETRY_MODE_HINTS_KEY = 'retry-mode-hints';
const MAX_RETRY_MODE_HINTS_PER_THREAD = 300;
const SEARCH_ENABLED_MODEL_SET = new Set<string>(SEARCH_ENABLED_MODELS);

function hasImageAttachment(message: ChatViewMessage): boolean {
    return (message.attachments ?? []).some((attachment) => attachment.mimeType.startsWith('image/'));
}

function hasVideoAttachment(message: ChatViewMessage): boolean {
    return (message.attachments ?? []).some((attachment) => attachment.mimeType.startsWith('video/'));
}

function readRetryModeHints(): Record<string, Record<string, RetryMode>> {
    if (typeof window === 'undefined') return {};
    const raw = window.sessionStorage.getItem(RETRY_MODE_HINTS_KEY);
    if (!raw) return {};
    try {
        const parsed = JSON.parse(raw) as unknown;
        if (!parsed || typeof parsed !== 'object') return {};
        return parsed as Record<string, Record<string, RetryMode>>;
    } catch {
        return {};
    }
}

function writeRetryModeHints(hints: Record<string, Record<string, RetryMode>>) {
    if (typeof window === 'undefined') return;
    window.sessionStorage.setItem(RETRY_MODE_HINTS_KEY, JSON.stringify(hints));
}

function getRetryModeHint(threadId: string, userMessageId: string): RetryMode | undefined {
    if (!threadId || !userMessageId) return undefined;
    const hints = readRetryModeHints();
    return hints[threadId]?.[userMessageId];
}

function looksLikeSearchResponse(content: string): boolean {
    return /\[\d+\]\(https?:\/\/[^\s)]+\)/.test(content);
}

function inferRetrySearchMode(
    localMessages: ChatViewMessage[],
    clickedMessageIndex: number,
    anchorUserIndex: number,
    threadId: string
): boolean {
    const anchorUser = localMessages[anchorUserIndex];
    if (!anchorUser) return false;

    const hint = getRetryModeHint(threadId, anchorUser.id);
    if (hint) return hint === 'search';

    const clickedMessage = localMessages[clickedMessageIndex];
    const candidateAssistant = clickedMessage?.role === 'assistant'
        ? clickedMessage
        : localMessages.slice(anchorUserIndex + 1).find((message) => message.role === 'assistant');

    if (!candidateAssistant) return false;
    if (!candidateAssistant.model_id || !SEARCH_ENABLED_MODEL_SET.has(candidateAssistant.model_id)) return false;

    return looksLikeSearchResponse(candidateAssistant.content);
}

function inferRetryModelId(
    localMessages: ChatViewMessage[],
    clickedMessageIndex: number,
    anchorUserIndex: number
): string | undefined {
    const clickedMessage = localMessages[clickedMessageIndex];
    if (!clickedMessage) return undefined;

    if (
        clickedMessage.role === 'assistant'
        && (clickedMessage.model_id === VIDEO_GENERATION_MODEL || hasVideoAttachment(clickedMessage))
    ) {
        return VIDEO_GENERATION_MODEL;
    }

    if (
        clickedMessage.role === 'assistant'
        && (isImageGenerationModel(clickedMessage.model_id) || hasImageAttachment(clickedMessage))
    ) {
        return isImageGenerationModel(clickedMessage.model_id) ? clickedMessage.model_id : IMAGE_GENERATION_MODEL;
    }

    const nextAssistantMessage = localMessages
        .slice(anchorUserIndex + 1)
        .find((message) => message.role === 'assistant');

    if (
        nextAssistantMessage
        && (nextAssistantMessage.model_id === VIDEO_GENERATION_MODEL || hasVideoAttachment(nextAssistantMessage))
    ) {
        return VIDEO_GENERATION_MODEL;
    }

    if (
        nextAssistantMessage
        && (isImageGenerationModel(nextAssistantMessage.model_id) || hasImageAttachment(nextAssistantMessage))
    ) {
        return isImageGenerationModel(nextAssistantMessage.model_id) ? nextAssistantMessage.model_id : IMAGE_GENERATION_MODEL;
    }

    return undefined;
}

interface UseRetryLogicParams {
    chatId: string;
    messages: ChatViewMessage[];
    setMessages: Dispatch<SetStateAction<ChatViewMessage[]>>;
    setIsLoading: Dispatch<SetStateAction<boolean>>;
    showToast: (message: string, type?: ToastType) => void;
    getInputMode: () => ChatSubmitMode | undefined;
    getInputImageModelId: () => string | undefined;
    generateResponse: (
        currentMessages: ChatViewMessage[],
        forcedModelId?: string,
        forcedSystemPrompt?: string,
        forceSearchMode?: boolean
    ) => Promise<boolean>;
    refreshStoredMessages: () => Promise<RefreshMessagesResult>;
    locallyDeletedMessageIdsRef: MutableRefObject<Set<string>>;
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
    getInputMode,
    getInputImageModelId,
    generateResponse,
    refreshStoredMessages,
    locallyDeletedMessageIdsRef,
    confirmDestructiveDelete,
}: UseRetryLogicParams) {
    const persistRetryModeHint = useCallback((userMessageId: string, mode: RetryMode) => {
        if (!chatId || !userMessageId) return;
        const hints = readRetryModeHints();
        const threadHints = { ...(hints[chatId] ?? {}) };
        threadHints[userMessageId] = mode;

        const entries = Object.entries(threadHints);
        if (entries.length > MAX_RETRY_MODE_HINTS_PER_THREAD) {
            const trimmed = entries.slice(entries.length - MAX_RETRY_MODE_HINTS_PER_THREAD);
            hints[chatId] = Object.fromEntries(trimmed);
        } else {
            hints[chatId] = threadHints;
        }
        writeRetryModeHints(hints);
    }, [chatId]);

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
        const inputMode = getInputMode();
        let forcedModelId: string | undefined;
        let forceSearchMode = false;

        if (inputMode === 'image' || inputMode === 'image-edit') {
            const selectedImageModelId = getInputImageModelId();
            forcedModelId = isImageGenerationModel(selectedImageModelId)
                ? selectedImageModelId
                : IMAGE_GENERATION_MODEL;
        } else if (inputMode === 'video') {
            forcedModelId = VIDEO_GENERATION_MODEL;
        } else if (inputMode === 'search') {
            forcedModelId = undefined;
            forceSearchMode = true;
        } else if (inputMode === 'chat') {
            forcedModelId = undefined;
            forceSearchMode = false;
        } else {
            // Fallback when input mode is temporarily unavailable.
            forcedModelId = inferRetryModelId(localMessages, clickedMessageIndex, msgIndex);
            forceSearchMode = !isImageGenerationModel(forcedModelId)
                && forcedModelId !== VIDEO_GENERATION_MODEL
                && inferRetrySearchMode(localMessages, clickedMessageIndex, msgIndex, chatId);
        }

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
            await generateResponse(previousMessages, forcedModelId, undefined, forceSearchMode);
        } catch (error) {
            setIsLoading(false);
            console.error('Failed to retry message:', error);
            showToast('Failed to delete previous responses. Please try again.', 'error');
        }
    }, [
        setIsLoading,
        messages,
        getInputMode,
        getInputImageModelId,
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
        persistRetryModeHint,
    };
}
