'use client';

import {
    useCallback,
    useEffect,
    useReducer,
    useRef,
    useState,
    type Dispatch,
    type RefObject,
    type SetStateAction,
} from 'react';

import type { RefreshMessagesResult } from '@/features/messages';
import { updateThreadTitleIfNewChat } from '@/features/threads';
import { scheduleFrame } from '@/shared/lib/animation-frame';
import { chatService } from '../lib/chat-service';
import { FrameCoalescer } from '../lib/frame-coalescer';
import { AVAILABLE_MODELS } from '@/shared/core/constants';
import type { ChatResponseStats } from '@/shared/core/types';
import type { ChatViewMessage } from '@/shared/contracts/chat';
import { sanitizeThreadTitle } from '@/features/threads';
import { type ReasoningEffort } from '@/shared/core/types';
import { ChatStreamMessageStore } from '../components/chat-stream-message-store';

// Must match the 409 body sent by the chat controller when a cached stream
// exists but is incomplete (writer died mid-stream).
const UNRESUMABLE_STREAM_ERROR = 'Unable to resume chat stream. Please retry the request.';
import {
    INITIAL_STREAM_STATE,
    areStatsEqual,
    streamReducer,
} from '../lib/chat-stream-state';

type ToastType = 'success' | 'error' | 'info';

interface UseChatStreamParams {
    chatId: string;
    model: string;
    reasoningEffortRef: RefObject<ReasoningEffort>;
    systemPrompt: string;
    setMessages: Dispatch<SetStateAction<ChatViewMessage[]>>;
    refreshPersistedReply: (userMessageId: string) => Promise<RefreshMessagesResult>;
    showToast: (message: string, type?: ToastType) => void;
}

export function useChatStream({
    chatId,
    model,
    reasoningEffortRef,
    systemPrompt,
    setMessages,
    refreshPersistedReply,
    showToast,
}: UseChatStreamParams) {
    const [state, dispatch] = useReducer(streamReducer, INITIAL_STREAM_STATE);
    const [streamedMessageStore] = useState(() => new ChatStreamMessageStore());
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
        const supportsReasoning = selectedModel?.supportsReasoning ?? true;

        const willThink = supportsReasoning && !(selectedModel?.usesThinkingParam && effectiveReasoningEffort === 'low');

        dispatch({ type: 'BEGIN', messageId: lastMsg.id, thinking: willThink });
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
        const contentChunks: string[] = [];
        const reasoningChunks: string[] = [];
        let contentLength = 0;
        let reasoningLength = 0;
        let fullContent = '';
        let fullReasoning = '';
        let providerUsage: { outputTokens: number; inputTokens?: number; totalTokens?: number; source: 'provider' } | null = null;
        let lastFlushedContent = '';
        let lastFlushedReasoning = '';
        let lastFlushedStats: ChatResponseStats | undefined;
        let hasPendingAssistantUpdate = false;
        let requestFailed = false;
        let requestSucceeded = false;
        // Set when the server reports the cached stream is unresumable (409):
        // instead of surfacing an error we silently regenerate once.
        let shouldRegenerate = false;

        const buildReplyStats = (): ChatResponseStats | undefined => {
            if (firstTokenAt === null) return undefined;
            const endTime = lastTokenAt ?? performance.now();
            const seconds = Math.max((endTime - firstTokenAt) / 1000, 0.001);
            const totalCharacters = contentLength + reasoningLength;
            const outputTokens = providerUsage?.outputTokens ?? (totalCharacters > 0 ? Math.ceil(totalCharacters / 3.5) : 0);
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
            fullContent = contentChunks.join('');
            fullReasoning = reasoningChunks.join('');
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
            streamedMessageStore.publish(assistantMsgId, {
                content: fullContent,
                reasoning: fullReasoning,
                ...(nextStats === undefined ? {} : { stats: nextStats }),
            });
        };

        const scheduleAssistantFlush = (callback: () => void) => {
            if (typeof document !== 'undefined' && document.visibilityState === 'hidden') {
                // requestAnimationFrame may stop in a background tab. Keep a
                // modest publication cadence without slowing stream reads.
                globalThis.setTimeout(callback, 16);
            } else {
                scheduleFrame(callback);
            }
        };
        const assistantFlushCoalescer = new FrameCoalescer(flushAssistantUpdate, scheduleAssistantFlush);

        const commitAssistantMessage = () => {
            const stats = buildReplyStats();
            setMessages((prev) => {
                // Use the stored index for O(1) lookup.
                // Fallback to a scan only if the index is stale (e.g. messages were deleted).
                let idx = assistantMsgIdx;
                if (idx < 0 || idx >= prev.length || prev[idx]?.id !== assistantMsgId) {
                    idx = prev.findIndex(m => m.id === assistantMsgId);
                    if (idx !== -1) assistantMsgIdx = idx;
                }
                if (idx === -1) return prev;

                const existing = prev[idx];
                if (!existing) return prev;
                // Skip if somehow the values are already identical (defensive).
                if (
                    existing.content === fullContent
                    && existing.reasoning === fullReasoning
                    && existing.model_id === activeModelId
                    && areStatsEqual(existing.stats, stats)
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
                    stats,
                };
                return updated;
            });
        };

        try {
            dispatch({ type: 'STREAMING' });
            const effectiveSystemPrompt = (forcedSystemPrompt ?? systemPrompt).trim();

            const stream = chatService.streamChat({
                threadId: chatId,
                userMessageId: lastMsg.id,
                model: activeModelId,
                reasoningEffort: effectiveReasoningEffort,
                systemPrompt: effectiveSystemPrompt || undefined,
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
                        if (chunk.value) {
                            reasoningChunks.push(chunk.value);
                            reasoningLength += chunk.value.length;
                        }
                        hasPendingAssistantUpdate = true;
                        dispatch({ type: 'SET_THINKING', thinking: true });
                        assistantFlushCoalescer.request();
                    }
                } else if (chunk.type === 'content') {
                    const now = performance.now();
                    if (chunk.value && firstTokenAt === null) {
                        firstTokenAt = now;
                    }
                    lastTokenAt = now;
                    dispatch({ type: 'SET_THINKING', thinking: false });
                    if (chunk.value) {
                        contentChunks.push(chunk.value);
                        contentLength += chunk.value.length;
                    }
                    hasPendingAssistantUpdate = true;
                    assistantFlushCoalescer.request();
                } else if (chunk.type === 'usage') {
                    providerUsage = chunk.value;
                    hasPendingAssistantUpdate = true;
                    assistantFlushCoalescer.request();
                }
            }

            if (lastTokenAt === null) lastTokenAt = performance.now();
            assistantFlushCoalescer.flushNow();
            if (!fullContent && !fullReasoning) {
                hasPendingAssistantUpdate = false;
                setMessages(currentMessages);
                requestFailed = true;
                showToast('No response returned. Please try again.', 'error');
                return false;
            }
            commitAssistantMessage();
            requestSucceeded = true;
            const refreshResult = await refreshPersistedReply(lastMsg.id);
            if (!refreshResult.ok) {
                console.warn('[chat] assistant response persisted but refresh failed:', refreshResult.error);
            }
        } catch (error) {

            if (error instanceof Error && error.name === 'AbortError') {
                assistantFlushCoalescer.flushNow();
                if (!fullContent && !fullReasoning) {
                    requestFailed = true;
                    hasPendingAssistantUpdate = false;
                    setMessages(currentMessages);
                    return false;
                }
                commitAssistantMessage();
                requestSucceeded = true;
                const refreshResult = await refreshPersistedReply(lastMsg.id);
                if (!refreshResult.ok) {
                    console.warn('[chat] partial assistant response persisted but refresh failed:', refreshResult.error);
                }
            } else {
                console.error('Chat error:', error);
                const errorMessage = error instanceof Error
                    ? error.message
                    : 'Failed to generate response. Please try again.';
                if (errorMessage === UNRESUMABLE_STREAM_ERROR) {
                    shouldRegenerate = true;
                    showToast('Connection lost — regenerating response…', 'info');
                } else {
                    showToast(errorMessage, 'error');
                    requestFailed = true;
                }
                hasPendingAssistantUpdate = false;
                setMessages(currentMessages);
                if (!shouldRegenerate) return false;
            }
        } finally {
            assistantFlushCoalescer.close();
            abortControllerRef.current = null;
            streamedMessageStore.clear(assistantMsgId);
            dispatch({ type: 'COMPLETE', failed: requestFailed });
            if (shouldRegenerate) {
                void generateResponseRef.current(
                    currentMessages,
                    forcedModelId,
                    forcedSystemPrompt
                );
            }
        }
        return requestSucceeded;
    }, [chatId, model, reasoningEffortRef, systemPrompt, showToast, setMessages, refreshPersistedReply, streamedMessageStore]);

    // Latest-ref pattern so the auto-regeneration in `finally` can re-invoke
    // the current callback without a circular dependency.
    const generateResponseRef = useRef(generateResponse);
    generateResponseRef.current = generateResponse;

    return {
        isLoading: state.phase !== 'idle',
        isThinking: state.isThinking,
        streamedMessageStore,
        setIsLoading,
        handleStop,
        generateResponse,
        lastRequestFailed: state.lastRequestFailed,
        clearLastRequestFailure,
        resetStreamState,
    };
}
