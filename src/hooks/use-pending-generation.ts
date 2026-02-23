'use client';

import { useEffect, type MutableRefObject } from 'react';

import { type ChatInputHandle, type ChatSubmitMode } from '@/components/chat-input-components/chat-input-types';
import {
    PENDING_GENERATION_MODEL_KEY,
    PENDING_GENERATION_MODE_KEY,
    PENDING_GENERATION_SEARCH_KEY,
    PENDING_GENERATION_THREAD_KEY,
    PENDING_REASONING_EFFORT_KEY,
    PENDING_SYSTEM_PROMPT_KEY,
    isImageGenerationModel,
    VIDEO_GENERATION_MODEL,
} from '@/lib/constants';
import { type ChatViewMessage } from '@/lib/chat-view';
import { type ReasoningEffort } from '@/lib/types';

function toReasoningEffort(value: string | null): ReasoningEffort | null {
    if (value === 'low' || value === 'medium' || value === 'high') {
        return value;
    }
    return null;
}

function toChatSubmitMode(value: string | null): ChatSubmitMode | null {
    if (value === 'chat' || value === 'image' || value === 'image-edit' || value === 'video' || value === 'search') {
        return value;
    }
    return null;
}

interface UsePendingGenerationParams {
    chatId: string;
    messages: ChatViewMessage[];
    messagesReady: boolean;
    isLoading: boolean;
    isThinking: boolean;
    lastRequestFailed: boolean;
    chatInputRef: MutableRefObject<ChatInputHandle | null>;
    applyPendingReasoningEffort: (effort: ReasoningEffort) => void;
    generateResponse: (
        currentMessages: ChatViewMessage[],
        forcedModelId?: string,
        forcedSystemPrompt?: string,
        forceSearchMode?: boolean
    ) => Promise<void>;
}

export function usePendingGeneration({
    chatId,
    messages,
    messagesReady,
    isLoading,
    isThinking,
    lastRequestFailed,
    chatInputRef,
    applyPendingReasoningEffort,
    generateResponse,
}: UsePendingGenerationParams) {
    useEffect(() => {
        // Don't auto-retry if the last request failed or if canonical messages are still loading.
        if (lastRequestFailed || !messagesReady) {
            return;
        }
        if (messages.length > 0 && !isLoading && !isThinking) {
            const lastMessage = messages[messages.length - 1];
            if (lastMessage.role === 'user') {
                const pendingGenerationThreadId = window.sessionStorage.getItem(PENDING_GENERATION_THREAD_KEY);
                if (pendingGenerationThreadId !== chatId) {
                    return;
                }
                const pendingGenerationModelId = window.sessionStorage.getItem(PENDING_GENERATION_MODEL_KEY);
                const pendingGenerationModeRaw = window.sessionStorage.getItem(PENDING_GENERATION_MODE_KEY);
                const pendingGenerationSearch = window.sessionStorage.getItem(PENDING_GENERATION_SEARCH_KEY);
                const pendingReasoningEffortRaw = window.sessionStorage.getItem(PENDING_REASONING_EFFORT_KEY);
                const pendingSystemPrompt = window.sessionStorage.getItem(PENDING_SYSTEM_PROMPT_KEY);
                const pendingModelId = pendingGenerationModelId ?? undefined;
                const pendingMode = toChatSubmitMode(pendingGenerationModeRaw);
                const pendingReasoningEffort = toReasoningEffort(pendingReasoningEffortRaw);
                if (pendingReasoningEffort) {
                    applyPendingReasoningEffort(pendingReasoningEffort);
                }
                if (pendingMode) {
                    chatInputRef.current?.setMode(pendingMode);
                }
                if (
                    pendingMode
                    && (pendingMode === 'image' || pendingMode === 'image-edit')
                    && pendingModelId
                    && isImageGenerationModel(pendingModelId)
                ) {
                    chatInputRef.current?.setImageModelId(pendingModelId);
                }
                window.sessionStorage.removeItem(PENDING_GENERATION_THREAD_KEY);
                window.sessionStorage.removeItem(PENDING_GENERATION_MODEL_KEY);
                window.sessionStorage.removeItem(PENDING_GENERATION_MODE_KEY);
                window.sessionStorage.removeItem(PENDING_GENERATION_SEARCH_KEY);
                window.sessionStorage.removeItem(PENDING_REASONING_EFFORT_KEY);
                window.sessionStorage.removeItem(PENDING_SYSTEM_PROMPT_KEY);
                if (
                    pendingModelId
                    && (isImageGenerationModel(pendingModelId) || pendingModelId === VIDEO_GENERATION_MODEL)
                ) {
                    void generateResponse(messages, pendingModelId, undefined, false);
                    return;
                }
                void generateResponse(
                    messages,
                    pendingModelId || lastMessage.model_id || undefined,
                    pendingSystemPrompt || undefined,
                    pendingGenerationSearch === '1'
                );
            }
        }
    }, [
        messages,
        messagesReady,
        isLoading,
        isThinking,
        generateResponse,
        chatId,
        lastRequestFailed,
        chatInputRef,
        applyPendingReasoningEffort,
    ]);
}
