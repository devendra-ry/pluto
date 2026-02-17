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

import { addMessage } from '@/hooks/use-messages';
import { touchThread, updateThreadTitleIfNewChat } from '@/hooks/use-threads';
import { cancelScheduledFrame, scheduleFrame, type ScheduledFrame } from '@/lib/animation-frame';
import { AVAILABLE_MODELS, IMAGE_GENERATION_MODEL, VIDEO_GENERATION_MODEL } from '@/lib/constants';
import { type ChatViewMessage, type RetryMode } from '@/lib/chat-view';
import { sanitizeThreadTitle } from '@/lib/sanitize';
import { type Attachment, type ReasoningEffort } from '@/lib/types';

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
    reasoningEffort: ReasoningEffort;
    systemPrompt: string;
    setMessages: Dispatch<SetStateAction<ChatViewMessage[]>>;
    justAddedMessageIdRef: MutableRefObject<string | null>;
    persistRetryModeHintRef: MutableRefObject<((userMessageId: string, mode: RetryMode) => void) | null>;
    showToast: (message: string, type?: ToastType) => void;
}

function isAttachment(value: unknown): value is Attachment {
    if (!value || typeof value !== 'object') return false;
    const record = value as Record<string, unknown>;
    return (
        typeof record.id === 'string' &&
        typeof record.name === 'string' &&
        typeof record.mimeType === 'string' &&
        typeof record.size === 'number' &&
        typeof record.path === 'string' &&
        typeof record.url === 'string'
    );
}

export function useChatStream({
    chatId,
    model,
    reasoningEffort,
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
    ) => {
        const lastMsg = currentMessages[currentMessages.length - 1];
        if (!lastMsg || lastMsg.role !== 'user') return;

        const machine = stateRef.current;
        if (machine.phase !== 'idle' && machine.phase !== 'preparing') {
            // Never overlap runs. Prevent duplicate run for same anchor message.
            if (machine.activeUserMessageId === lastMsg.id) {
                return;
            }
            return;
        }

        const activeModelId = forcedModelId || model;
        const selectedModel = AVAILABLE_MODELS.find(m => m.id === activeModelId);
        const isImageGenModel = activeModelId === IMAGE_GENERATION_MODEL;
        const isVideoGenModel = activeModelId === VIDEO_GENERATION_MODEL;
        const isMediaGenModel = isImageGenModel || isVideoGenModel;
        const useSearch = !isMediaGenModel && forceSearchMode;
        const supportsReasoning = isMediaGenModel ? false : (selectedModel?.supportsReasoning ?? true);
        const retryMode: RetryMode = isImageGenModel ? 'image' : (isVideoGenModel ? 'video' : (useSearch ? 'search' : 'chat'));
        persistRetryModeHintRef.current?.(lastMsg.id, retryMode);

        const willThink = supportsReasoning && !(selectedModel?.usesThinkingParam && reasoningEffort === 'low');

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
        setMessages(prev => [...prev, assistantMsg]);

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

        let fullContent = '';
        let fullReasoning = '';
        let hasPendingAssistantUpdate = false;
        let streamFlushFrame: ScheduledFrame | null = null;
        let requestFailed = false;

        const flushAssistantUpdate = () => {
            if (!hasPendingAssistantUpdate) return;
            hasPendingAssistantUpdate = false;
            setMessages((prev) => {
                const updated = [...prev];
                const msgIdx = updated.findIndex(m => m.id === assistantMsgId);
                if (msgIdx !== -1) {
                    updated[msgIdx] = {
                        ...updated[msgIdx],
                        content: fullContent,
                        reasoning: fullReasoning,
                        model_id: activeModelId,
                    };
                }
                return updated;
            });
        };

        const cancelScheduledAssistantFrame = () => {
            if (streamFlushFrame !== null) {
                cancelScheduledFrame(streamFlushFrame);
                streamFlushFrame = null;
            }
        };

        const scheduleAssistantUpdate = () => {
            if (streamFlushFrame !== null) return;
            streamFlushFrame = scheduleFrame(() => {
                streamFlushFrame = null;
                flushAssistantUpdate();
            });
        };

        const persistAssistantMessage = async (
            content: string,
            reasoning?: string,
            attachments: Attachment[] = []
        ) => {
            if (!content && !reasoning && attachments.length === 0) {
                return false;
            }

            dispatch({ type: 'PERSISTING' });
            const newMsg = await addMessage(chatId, 'assistant', content, reasoning, activeModelId, attachments);
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
                const endpoint = isVideoGenModel ? '/api/videos' : '/api/images';
                const response = await fetch(endpoint, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        threadId: chatId,
                        prompt: lastMsg.content,
                        attachments: userImageAttachments,
                    }),
                    signal: abortControllerRef.current.signal,
                });

                const payload = await response.json().catch(() => ({})) as Record<string, unknown>;
                if (!response.ok) {
                    const errorMessage =
                        typeof payload.error === 'string'
                            ? payload.error
                            : (
                                isVideoGenModel
                                    ? 'Failed to generate video'
                                    : (userImageAttachments.length > 0 ? 'Failed to edit image' : 'Failed to generate image')
                            );
                    throw new Error(errorMessage);
                }

                const attachment = isAttachment(payload.attachment) ? payload.attachment : null;
                if (!attachment) {
                    throw new Error(isVideoGenModel
                        ? 'Video generation did not return a valid attachment'
                        : 'Image generation did not return a valid attachment');
                }

                const revisedPrompt = typeof payload.revisedPrompt === 'string'
                    ? payload.revisedPrompt.trim()
                    : '';
                const operation = typeof payload.operation === 'string' ? payload.operation : '';
                const isEditOperation = !isVideoGenModel && (operation === 'edit' || userImageAttachments.length > 0);
                const assistantContent = revisedPrompt
                    ? `${isVideoGenModel ? 'Generated video.' : (isEditOperation ? 'Edited image.' : 'Generated image.')}\nPrompt rewrite: ${revisedPrompt}`
                    : (isVideoGenModel ? 'Generated video.' : (isEditOperation ? 'Edited image.' : 'Generated image.'));

                setMessages((prev) => {
                    const updated = [...prev];
                    const msgIdx = updated.findIndex(m => m.id === assistantMsgId);
                    if (msgIdx !== -1) {
                        updated[msgIdx] = {
                            ...updated[msgIdx],
                            content: assistantContent,
                            attachments: [attachment],
                            model_id: activeModelId,
                        };
                    }
                    return updated;
                });

                const persisted = await persistAssistantMessage(assistantContent, undefined, [attachment]);
                if (!persisted) {
                    throw new Error(
                        isVideoGenModel
                            ? 'Failed to persist generated video'
                            : (isEditOperation ? 'Failed to persist edited image' : 'Failed to persist generated image')
                    );
                }
                return;
            }

            dispatch({ type: 'STREAMING' });
            const decoder = new TextDecoder();
            const effectiveSystemPrompt = (forcedSystemPrompt ?? systemPrompt).trim();
            const response = await fetch('/api/chat', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    messages: currentMessages.map((m) => ({
                        role: m.role,
                        content: m.content,
                        attachments: m.attachments ?? [],
                    })),
                    model: activeModelId,
                    reasoningEffort,
                    systemPrompt: !isMediaGenModel && effectiveSystemPrompt ? effectiveSystemPrompt : undefined,
                    search: useSearch,
                }),
                signal: abortControllerRef.current.signal,
            });

            if (!response.ok) {
                let message = `Failed to get response (${response.status})`;
                try {
                    const payload = await response.json() as Record<string, unknown>;
                    const errorText = typeof payload.error === 'string' ? payload.error : '';
                    const detailsText = typeof payload.details === 'string' ? payload.details : '';
                    if (errorText) {
                        message = detailsText ? `${errorText}: ${detailsText}` : errorText;
                    }
                } catch {
                    // Ignore parse failures and keep fallback status message.
                }
                throw new Error(message);
            }

            const reader = response.body?.getReader();

            if (reader) {
                let buffer = '';
                while (true) {
                    const { done, value } = await reader.read();
                    if (done) break;

                    buffer += decoder.decode(value, { stream: true });
                    const lines = buffer.split('\n');
                    buffer = lines.pop() || '';

                    for (const line of lines) {
                        if (line.startsWith('data: ')) {
                            const data = line.slice(6);
                            if (data === '[DONE]') continue;

                            try {
                                const parsed = JSON.parse(data) as Record<string, unknown>;
                                const streamError = typeof parsed.error === 'string' ? parsed.error.trim() : '';
                                if (streamError) {
                                    const streamDetails = typeof parsed.details === 'string' ? parsed.details.trim() : '';
                                    const normalizedStreamError = streamDetails ? `${streamError}: ${streamDetails}` : streamError;
                                    throw new Error(`STREAM_ERROR:${normalizedStreamError}`);
                                }
                                const choices = Array.isArray(parsed.choices)
                                    ? parsed.choices as Array<Record<string, unknown>>
                                    : [];
                                const delta = (choices[0]?.delta ?? {}) as Record<string, unknown>;

                                const reasoningContent =
                                    (typeof delta.reasoning_content === 'string' ? delta.reasoning_content : '') ||
                                    (typeof delta.thinking === 'string' ? delta.thinking : '');
                                if (reasoningContent && supportsReasoning) {
                                    fullReasoning += reasoningContent;
                                    hasPendingAssistantUpdate = true;
                                    scheduleAssistantUpdate();
                                    dispatch({ type: 'SET_THINKING', thinking: true });
                                }

                                const content = typeof delta.content === 'string' ? delta.content : '';
                                if (content) {
                                    dispatch({ type: 'SET_THINKING', thinking: false });
                                    fullContent += content;
                                    hasPendingAssistantUpdate = true;
                                    scheduleAssistantUpdate();
                                }
                            } catch (streamChunkError) {
                                if (
                                    streamChunkError instanceof Error
                                    && streamChunkError.message.startsWith('STREAM_ERROR:')
                                ) {
                                    throw new Error(streamChunkError.message.slice('STREAM_ERROR:'.length));
                                }
                                // Skip malformed JSON
                            }
                        }
                    }
                }
            }

            cancelScheduledAssistantFrame();
            flushAssistantUpdate();
            const persisted = await persistAssistantMessage(fullContent, fullReasoning);
            if (!persisted) {
                hasPendingAssistantUpdate = false;
                setMessages(currentMessages);
                requestFailed = true;
                showToast('No response returned. Please try again.', 'error');
            }
        } catch (error) {
            cancelScheduledAssistantFrame();
            if (error instanceof Error && error.name === 'AbortError') {
                if (isMediaGenModel) {
                    hasPendingAssistantUpdate = false;
                    setMessages(currentMessages);
                    return;
                }
                flushAssistantUpdate();
                const persisted = await persistAssistantMessage(fullContent, fullReasoning);
                if (!persisted) {
                    requestFailed = true;
                    hasPendingAssistantUpdate = false;
                    setMessages(currentMessages);
                }
            } else {
                console.error('Chat error:', error);
                const errorMessage = error instanceof Error
                    ? error.message
                    : 'Failed to generate response. Please try again.';
                showToast(errorMessage, 'error');
                hasPendingAssistantUpdate = false;
                setMessages(currentMessages);
                requestFailed = true;
            }
        } finally {
            cancelScheduledAssistantFrame();
            abortControllerRef.current = null;
            dispatch({ type: 'COMPLETE', failed: requestFailed });
        }
    }, [chatId, model, reasoningEffort, systemPrompt, showToast, setMessages, justAddedMessageIdRef, persistRetryModeHintRef]);

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
