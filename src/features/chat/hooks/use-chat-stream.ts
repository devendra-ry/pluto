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
import { cancelScheduledFrame, scheduleFrame, type ScheduledFrame } from '@/shared/lib/animation-frame';
import { chatService } from '@/features/chat/lib/chat-service';
import { AVAILABLE_MODELS, isImageGenerationModel, VIDEO_GENERATION_MODEL } from '@/shared/core/constants';
import { type ChatViewMessage, type RetryMode } from '@/features/chat/lib/chat-view';
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
        let requestSucceeded = false;

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

                const { content, attachment, operation, revisedPrompt } = await chatService.generateImageOrVideo({
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
                        fullReasoning += chunk.value;
                        hasPendingAssistantUpdate = true;
                        scheduleAssistantUpdate();
                        dispatch({ type: 'SET_THINKING', thinking: true });
                    }
                } else if (chunk.type === 'content') {
                    dispatch({ type: 'SET_THINKING', thinking: false });
                    fullContent += chunk.value;
                    hasPendingAssistantUpdate = true;
                    scheduleAssistantUpdate();
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
                return false;
            }
            requestSucceeded = true;
        } catch (error) {
            cancelScheduledAssistantFrame();
            if (error instanceof Error && error.name === 'AbortError') {
                if (isMediaGenModel) {
                    hasPendingAssistantUpdate = false;
                    setMessages(currentMessages);
                    return false;
                }
                flushAssistantUpdate();
                const persisted = await persistAssistantMessage(fullContent, fullReasoning);
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
            cancelScheduledAssistantFrame();
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



