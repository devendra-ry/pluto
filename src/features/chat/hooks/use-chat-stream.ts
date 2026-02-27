'use client';

import {
    useCallback,
    useEffect,
    useReducer,
    useRef,
    type Dispatch,
    type MutableRefObject,
    type SetStateAction,
} from 'react';

import { addMessage } from '@/features/messages/hooks/use-messages';
import { touchThread, updateThreadTitleIfNewChat } from '@/features/threads/hooks/use-threads';
import { scheduleFrame } from '@/shared/lib/animation-frame';
import { chatService } from '@/features/chat/lib/chat-service';
import { AVAILABLE_MODELS, isImageGenerationModel, VIDEO_GENERATION_MODEL } from '@/shared/core/constants';
import { type ChatResponseStats, type ChatViewMessage, type RetryMode } from '@/features/chat/lib/chat-view';
import { sanitizeThreadTitle } from '@/features/threads/lib/sanitize-thread-title';
import { type Attachment, type ReasoningEffort } from '@/shared/core/types';

type ToastType = 'success' | 'error' | 'info';
type StreamPhase = 'idle' | 'preparing' | 'requesting' | 'streaming' | 'persisting';

interface StreamState {
    phase: StreamPhase;
    isThinking: boolean;
    activeUserMessageId: string | null;
    lastRequestFailed: boolean;
}

type StreamAction =
    | { type: 'SET_LOADING'; loading: boolean }
    | { type: 'BEGIN'; messageId: string; thinking: boolean }
    | { type: 'STREAMING' }
    | { type: 'SET_THINKING'; thinking: boolean }
    | { type: 'PERSISTING' }
    | { type: 'COMPLETE'; failed: boolean }
    | { type: 'CLEAR_FAILURE' }
    | { type: 'RESET' };

const INITIAL_STATE: StreamState = {
    phase: 'idle',
    isThinking: false,
    activeUserMessageId: null,
    lastRequestFailed: false,
};

function estimateOutputTokens(content: string, reasoning: string): number {
    const totalChars = content.length + reasoning.length;
    if (totalChars <= 0) return 0;
    return Math.ceil(totalChars / 3.5);
}

function areStatsEqual(left: ChatResponseStats | undefined, right: ChatResponseStats | undefined): boolean {
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

function streamReducer(state: StreamState, action: StreamAction): StreamState {
    switch (action.type) {
        case 'SET_LOADING':
            if (action.loading) {
                if (state.phase !== 'idle') {
                    return state;
                }
                return {
                    ...state,
                    phase: 'preparing',
                    isThinking: false,
                    activeUserMessageId: null,
                    lastRequestFailed: false,
                };
            }
            return {
                ...state,
                phase: 'idle',
                isThinking: false,
                activeUserMessageId: null,
            };
        case 'BEGIN':
            return {
                ...state,
                phase: 'requesting',
                activeUserMessageId: action.messageId,
                isThinking: action.thinking,
                lastRequestFailed: false,
            };
        case 'STREAMING':
            if (state.phase === 'idle') return state;
            return {
                ...state,
                phase: 'streaming',
            };
        case 'SET_THINKING':
            return {
                ...state,
                isThinking: action.thinking,
            };
        case 'PERSISTING':
            if (state.phase === 'idle') return state;
            return {
                ...state,
                phase: 'persisting',
            };
        case 'COMPLETE':
            return {
                ...state,
                phase: 'idle',
                isThinking: false,
                activeUserMessageId: null,
                lastRequestFailed: action.failed,
            };
        case 'CLEAR_FAILURE':
            if (!state.lastRequestFailed) return state;
            return {
                ...state,
                lastRequestFailed: false,
            };
        case 'RESET':
            return INITIAL_STATE;
        default:
            return state;
    }
}

interface UseChatStreamParams {
    chatId: string;
    model: string;
    reasoningEffortRef: MutableRefObject<ReasoningEffort>;
    systemPrompt: string;
    setMessages: Dispatch<SetStateAction<ChatViewMessage[]>>;
    justAddedMessageIdRef: MutableRefObject<string | null>;
    persistRetryModeHintRef: MutableRefObject<((userMessageId: string, mode: RetryMode) => void) | null>;
    showToast: (message: string, type?: ToastType) => void;
}

export function useChatStream({
    chatId,
    model,
    reasoningEffortRef,
    systemPrompt,
    setMessages,
    justAddedMessageIdRef,
    persistRetryModeHintRef,
    showToast,
}: UseChatStreamParams) {
    const [state, dispatch] = useReducer(streamReducer, INITIAL_STATE);
    const stateRef = useRef(state);
    const abortControllerRef = useRef<AbortController | null>(null);

    useEffect(() => {
        stateRef.current = state;
    }, [state]);

    const setIsLoading = useCallback((next: SetStateAction<boolean>) => {
        const currentlyLoading = stateRef.current.phase !== 'idle';
        const loading = typeof next === 'function' ? next(currentlyLoading) : next;
        dispatch({ type: 'SET_LOADING', loading });
    }, []);

    const clearLastRequestFailure = useCallback(() => {
        dispatch({ type: 'CLEAR_FAILURE' });
    }, []);

    const resetStreamState = useCallback(() => {
        if (abortControllerRef.current) {
            abortControllerRef.current.abort();
            abortControllerRef.current = null;
        }
        dispatch({ type: 'RESET' });
    }, []);

    const handleStop = useCallback(() => {
        if (abortControllerRef.current) {
            abortControllerRef.current.abort();
            abortControllerRef.current = null;
        }
    }, []);

    const generateResponse = useCallback(async (
        currentMessages: ChatViewMessage[],
        forcedModelId?: string,
        forcedSystemPrompt?: string,
        forceSearchMode: boolean = false
    ): Promise<boolean> => {
        const lastMsg = currentMessages[currentMessages.length - 1];
        if (!lastMsg || lastMsg.role !== 'user') return false;

        const machine = stateRef.current;
        if (machine.phase !== 'idle' && machine.phase !== 'preparing') {
            // Never overlap runs. Prevent duplicate run for same anchor message.
            if (machine.activeUserMessageId === lastMsg.id) {
                return false;
            }
            return false;
        }

        const activeModelId = forcedModelId || model;
        const effectiveReasoningEffort = reasoningEffortRef.current;
        const selectedModel = AVAILABLE_MODELS.find(m => m.id === activeModelId);
        const isImageGenModel = isImageGenerationModel(activeModelId);
        const isVideoGenModel = activeModelId === VIDEO_GENERATION_MODEL;
        const isMediaGenModel = isImageGenModel || isVideoGenModel;
        const useSearch = !isMediaGenModel && forceSearchMode;
        const supportsReasoning = isMediaGenModel ? false : (selectedModel?.supportsReasoning ?? true);
        const retryMode: RetryMode = isImageGenModel ? 'image' : (isVideoGenModel ? 'video' : (useSearch ? 'search' : 'chat'));
        persistRetryModeHintRef.current?.(lastMsg.id, retryMode);

        const willThink = supportsReasoning && !(selectedModel?.usesThinkingParam && effectiveReasoningEffort === 'low');

        dispatch({ type: 'BEGIN', messageId: lastMsg.id, thinking: !isMediaGenModel && willThink });
        abortControllerRef.current = new AbortController();

        const assistantMsgId = crypto.randomUUID();
        const assistantMsg: ChatViewMessage = {
            id: assistantMsgId,
            role: 'assistant',
            content: '',
            reasoning: '',
            model_id: activeModelId,
        };
        // Store the index once — the assistant message is always appended at the end.
        let assistantMsgIdx = -1;
        setMessages(prev => {
            assistantMsgIdx = prev.length;
            return [...prev, assistantMsg];
        });

        const updateTitleIfNeeded = async () => {
            if (currentMessages.length > 0) {
                const firstUserMsg = currentMessages.find(m => m.role === 'user');
                if (!firstUserMsg) return;

                const attachmentTitle = firstUserMsg.attachments?.[0]?.name ? `Attachment: ${firstUserMsg.attachments[0].name}` : 'New Chat';
                const baseTitle = firstUserMsg.content.trim() || attachmentTitle;
                const title = sanitizeThreadTitle(baseTitle);
                try {
                    await updateThreadTitleIfNewChat(chatId, title);
                } catch (error) {
                    console.error('Failed to update thread title:', error);
                }
            }
        };
        void updateTitleIfNeeded();

        const requestStartedAt = performance.now();
        let firstTokenAt: number | null = null;
        let lastTokenAt: number | null = null;
        let fullContent = '';
        let fullReasoning = '';
        let providerUsage: { outputTokens: number; inputTokens?: number; totalTokens?: number; source: 'provider' } | null = null;
        let lastFlushedContent = '';
        let lastFlushedReasoning = '';
        let lastFlushedStats: ChatResponseStats | undefined;
        let hasPendingAssistantUpdate = false;
        let requestFailed = false;
        let requestSucceeded = false;

        const buildReplyStats = (): ChatResponseStats | undefined => {
            if (firstTokenAt === null) return undefined;
            const endTime = lastTokenAt ?? performance.now();
            const seconds = Math.max((endTime - firstTokenAt) / 1000, 0.001);
            const outputTokens = providerUsage?.outputTokens ?? estimateOutputTokens(fullContent, fullReasoning);
            const tokensPerSecond = outputTokens / seconds;
            const ttfbSeconds = Math.max((firstTokenAt - requestStartedAt) / 1000, 0);
            return {
                outputTokens,
                seconds,
                tokensPerSecond,
                ttfbSeconds,
                inputTokens: providerUsage?.inputTokens,
                totalTokens: providerUsage?.totalTokens,
                source: providerUsage?.source ?? 'estimated',
            };
        };

        const flushAssistantUpdate = () => {
            if (!hasPendingAssistantUpdate) return;
            const nextStats = buildReplyStats();
            // Guard: skip if content hasn't actually changed since last flush.
            if (
                fullContent === lastFlushedContent
                && fullReasoning === lastFlushedReasoning
                && areStatsEqual(lastFlushedStats, nextStats)
            ) {
                hasPendingAssistantUpdate = false;
                return;
            }
            hasPendingAssistantUpdate = false;
            lastFlushedContent = fullContent;
            lastFlushedReasoning = fullReasoning;
            lastFlushedStats = nextStats;
            setMessages((prev) => {
                // Use the stored index for O(1) lookup.
                // Fallback to search only if the index is stale (e.g. messages were deleted).
                let idx = assistantMsgIdx;
                if (idx < 0 || idx >= prev.length || prev[idx].id !== assistantMsgId) {
                    idx = prev.findIndex(m => m.id === assistantMsgId);
                    if (idx !== -1) assistantMsgIdx = idx;
                }
                if (idx === -1) return prev;

                const existing = prev[idx];
                // Skip if somehow the values are already identical (defensive).
                if (
                    existing.content === fullContent
                    && existing.reasoning === fullReasoning
                    && existing.model_id === activeModelId
                    && areStatsEqual(existing.stats, nextStats)
                ) {
                    return prev;
                }

                // Reuse the array — only replace the single element that changed.
                const updated = prev.slice();
                updated[idx] = {
                    ...existing,
                    content: fullContent,
                    reasoning: fullReasoning,
                    model_id: activeModelId,
                    stats: nextStats,
                };
                return updated;
            });
        };

        /**
         * Backpressure gate: returns a promise that resolves on the next
         * animation frame *after* flushing the pending UI update.
         * When the consumer `await`s this inside `for await…of`, the
         * AsyncGenerator suspends → reader.read() pauses → TCP/HTTP
         * backpressure propagates naturally to the server.
         * If there's nothing to flush, resolves immediately so we don't
         * add unnecessary latency for no-op chunks.
         */
        const waitForFrameFlush = (): Promise<void> => {
            if (!hasPendingAssistantUpdate) return Promise.resolve();
            return new Promise<void>((resolve) => {
                if (typeof document !== 'undefined' && document.visibilityState === 'hidden') {
                    // When the tab is in the background, browsers pause requestAnimationFrame.
                    // If we block on scheduleFrame, the stream will halt, TCP backpressure will
                    // build up, and the connection may timeout, failing to persist the message.
                    // Bypass the frame wait so the stream completes and saves to the database.
                    setTimeout(() => {
                        flushAssistantUpdate();
                        resolve();
                    }, 10);
                } else {
                    scheduleFrame(() => {
                        flushAssistantUpdate();
                        resolve();
                    });
                }
            });
        };

        const persistAssistantMessage = async (
            content: string,
            reasoning?: string,
            attachments: Attachment[] = [],
            stats?: ChatResponseStats,
        ) => {
            if (!content && !reasoning && attachments.length === 0) {
                return false;
            }

            dispatch({ type: 'PERSISTING' });
            const newMsg = await addMessage(chatId, 'assistant', content, reasoning, activeModelId, attachments, stats);
            setMessages(prev =>
                prev.map((m) => (m.id === assistantMsgId ? { ...m, id: newMsg.id } : m))
            );
            justAddedMessageIdRef.current = newMsg.id;
            try {
                await touchThread(chatId);
            } catch (error) {
                console.error('Failed to touch thread timestamp:', error);
            }
            return true;
        };

        try {
            if (isImageGenModel || isVideoGenModel) {
                const userImageAttachments = (lastMsg.attachments ?? []).filter((attachment) =>
                    attachment.mimeType.startsWith('image/')
                );

                const { content, attachment, operation } = await chatService.generateImageOrVideo({
                    threadId: chatId,
                    model: activeModelId,
                    prompt: lastMsg.content,
                    attachments: userImageAttachments,
                    isVideo: isVideoGenModel,
                    signal: abortControllerRef.current.signal,
                });

                const isEditOperation = !isVideoGenModel && (operation === 'edit' || userImageAttachments.length > 0);

                setMessages((prev) => {
                    const updated = [...prev];
                    const msgIdx = updated.findIndex(m => m.id === assistantMsgId);
                    if (msgIdx !== -1) {
                        updated[msgIdx] = {
                            ...updated[msgIdx],
                            content: content,
                            attachments: [attachment],
                            model_id: activeModelId,
                        };
                    }
                    return updated;
                });

                const persisted = await persistAssistantMessage(content, undefined, [attachment]);
                if (!persisted) {
                    throw new Error(
                        isVideoGenModel
                            ? 'Failed to persist generated video'
                            : (isEditOperation ? 'Failed to persist edited image' : 'Failed to persist generated image')
                    );
                }
                requestSucceeded = true;
                return true;
            }

            dispatch({ type: 'STREAMING' });
            const effectiveSystemPrompt = (forcedSystemPrompt ?? systemPrompt).trim();

            const messages = currentMessages.map((m) => ({
                role: m.role,
                content: m.content,
                attachments: m.attachments ?? [],
            }));

            const stream = chatService.streamChat({
                messages,
                model: activeModelId,
                reasoningEffort: effectiveReasoningEffort,
                systemPrompt: !isMediaGenModel && effectiveSystemPrompt ? effectiveSystemPrompt : undefined,
                search: useSearch,
                signal: abortControllerRef.current.signal,
            });

            for await (const chunk of stream) {
                if (chunk.type === 'reasoning') {
                    if (supportsReasoning) {
                        const now = performance.now();
                        if (chunk.value && firstTokenAt === null) {
                            firstTokenAt = now;
                        }
                        lastTokenAt = now;
                        fullReasoning += chunk.value;
                        hasPendingAssistantUpdate = true;
                        await waitForFrameFlush();
                        dispatch({ type: 'SET_THINKING', thinking: true });
                    }
                } else if (chunk.type === 'content') {
                    const now = performance.now();
                    if (chunk.value && firstTokenAt === null) {
                        firstTokenAt = now;
                    }
                    lastTokenAt = now;
                    dispatch({ type: 'SET_THINKING', thinking: false });
                    fullContent += chunk.value;
                    hasPendingAssistantUpdate = true;
                    await waitForFrameFlush();
                } else if (chunk.type === 'usage') {
                    providerUsage = chunk.value;
                    hasPendingAssistantUpdate = true;
                    await waitForFrameFlush();
                }
            }

            if (lastTokenAt === null) lastTokenAt = performance.now();
            flushAssistantUpdate();
            const persisted = await persistAssistantMessage(fullContent, fullReasoning, [], buildReplyStats());
            if (!persisted) {
                hasPendingAssistantUpdate = false;
                setMessages(currentMessages);
                requestFailed = true;
                showToast('No response returned. Please try again.', 'error');
                return false;
            }
            requestSucceeded = true;
        } catch (error) {

            if (error instanceof Error && error.name === 'AbortError') {
                if (isMediaGenModel) {
                    hasPendingAssistantUpdate = false;
                    setMessages(currentMessages);
                    return false;
                }
                flushAssistantUpdate();
                const persisted = await persistAssistantMessage(fullContent, fullReasoning, [], buildReplyStats());
                if (!persisted) {
                    requestFailed = true;
                    hasPendingAssistantUpdate = false;
                    setMessages(currentMessages);
                    return false;
                }
                requestSucceeded = true;
            } else {
                console.error('Chat error:', error);
                const errorMessage = error instanceof Error
                    ? error.message
                    : 'Failed to generate response. Please try again.';
                showToast(errorMessage, 'error');
                hasPendingAssistantUpdate = false;
                setMessages(currentMessages);
                requestFailed = true;
                return false;
            }
        } finally {
            abortControllerRef.current = null;
            dispatch({ type: 'COMPLETE', failed: requestFailed });
        }
        return requestSucceeded;
    }, [chatId, model, reasoningEffortRef, systemPrompt, showToast, setMessages, justAddedMessageIdRef, persistRetryModeHintRef]);

    return {
        isLoading: state.phase !== 'idle',
        isThinking: state.isThinking,
        setIsLoading,
        handleStop,
        generateResponse,
        lastRequestFailed: state.lastRequestFailed,
        clearLastRequestFailure,
        resetStreamState,
    };
}
