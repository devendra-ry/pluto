'use client';

import { useCallback, useRef, useState, type Dispatch, type MutableRefObject, type SetStateAction } from 'react';

import { addMessage } from '@/hooks/use-messages';
import { touchThread, updateThreadTitleIfNewChat } from '@/hooks/use-threads';
import { AVAILABLE_MODELS, IMAGE_GENERATION_MODEL } from '@/lib/constants';
import { type ChatViewMessage, type RetryMode } from '@/lib/chat-view';
import { sanitizeThreadTitle } from '@/lib/sanitize';
import { type Attachment, type ReasoningEffort } from '@/lib/types';

type ToastType = 'success' | 'error' | 'info';

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
    const [isLoading, setIsLoading] = useState(false);
    const [isThinking, setIsThinking] = useState(false);
    const abortControllerRef = useRef<AbortController | null>(null);
    const generatingRef = useRef<string | null>(null);
    const lastRequestFailedRef = useRef(false); // Prevent auto-retry after failures

    const resetStreamState = useCallback(() => {
        if (abortControllerRef.current) {
            abortControllerRef.current.abort();
            abortControllerRef.current = null;
        }
        setIsLoading(false);
        setIsThinking(false);
        generatingRef.current = null;
        lastRequestFailedRef.current = false;
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
        if (generatingRef.current === lastMsg.id) return;
        generatingRef.current = lastMsg.id;

        const activeModelId = forcedModelId || model;
        const selectedModel = AVAILABLE_MODELS.find(m => m.id === activeModelId);
        const isImageGenModel = activeModelId === IMAGE_GENERATION_MODEL;
        const useSearch = !isImageGenModel && forceSearchMode;
        const supportsReasoning = isImageGenModel ? false : (selectedModel?.supportsReasoning ?? true);
        const retryMode: RetryMode = isImageGenModel ? 'image' : (useSearch ? 'search' : 'chat');
        persistRetryModeHintRef.current?.(lastMsg.id, retryMode);

        const willThink = supportsReasoning && !(selectedModel?.usesThinkingParam && reasoningEffort === 'low');

        const assistantMsgId = crypto.randomUUID();
        const assistantMsg: ChatViewMessage = {
            id: assistantMsgId,
            role: 'assistant',
            content: '',
            reasoning: '',
            model_id: activeModelId,
        };
        setMessages(prev => [...prev, assistantMsg]);

        setIsThinking(!isImageGenModel && willThink);
        setIsLoading(true);
        abortControllerRef.current = new AbortController();

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
        let streamFlushFrame: number | null = null;

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
                cancelAnimationFrame(streamFlushFrame);
                streamFlushFrame = null;
            }
        };

        const scheduleAssistantUpdate = () => {
            if (streamFlushFrame !== null) return;
            streamFlushFrame = requestAnimationFrame(() => {
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
            if (isImageGenModel) {
                const response = await fetch('/api/images', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        threadId: chatId,
                        prompt: lastMsg.content,
                    }),
                    signal: abortControllerRef.current.signal,
                });

                const payload = await response.json().catch(() => ({})) as Record<string, unknown>;
                if (!response.ok) {
                    const errorMessage =
                        typeof payload.error === 'string'
                            ? payload.error
                            : 'Failed to generate image';
                    throw new Error(errorMessage);
                }

                const attachment = isAttachment(payload.attachment) ? payload.attachment : null;
                if (!attachment) {
                    throw new Error('Image generation did not return a valid attachment');
                }

                const revisedPrompt = typeof payload.revisedPrompt === 'string'
                    ? payload.revisedPrompt.trim()
                    : '';
                const assistantContent = revisedPrompt
                    ? `Generated image.\nPrompt rewrite: ${revisedPrompt}`
                    : 'Generated image.';

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
                    throw new Error('Failed to persist generated image');
                }
                return;
            }

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
                    systemPrompt: !isImageGenModel && effectiveSystemPrompt ? effectiveSystemPrompt : undefined,
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
                                    setIsThinking(true);
                                }

                                const content = typeof delta.content === 'string' ? delta.content : '';
                                if (content) {
                                    setIsThinking(false);
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
                lastRequestFailedRef.current = true;
                showToast('No response returned. Please try again.', 'error');
            }
        } catch (error) {
            cancelScheduledAssistantFrame();
            if (error instanceof Error && error.name === 'AbortError') {
                if (isImageGenModel) {
                    hasPendingAssistantUpdate = false;
                    setMessages(currentMessages);
                    return;
                }
                flushAssistantUpdate();
                const persisted = await persistAssistantMessage(fullContent, fullReasoning);
                if (!persisted) {
                    lastRequestFailedRef.current = true;
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
                lastRequestFailedRef.current = true;
            }
        } finally {
            cancelScheduledAssistantFrame();
            setIsLoading(false);
            setIsThinking(false);
            generatingRef.current = null;
            abortControllerRef.current = null;
        }
    }, [chatId, model, reasoningEffort, systemPrompt, showToast, setMessages, justAddedMessageIdRef, persistRetryModeHintRef]);

    return {
        isLoading,
        isThinking,
        setIsLoading,
        handleStop,
        generateResponse,
        lastRequestFailedRef,
        resetStreamState,
    };
}
