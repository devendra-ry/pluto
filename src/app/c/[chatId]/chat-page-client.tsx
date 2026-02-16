'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { type VirtuosoHandle } from 'react-virtuoso';

import { ChatEmptyState } from '@/components/chat-empty-state';
import { ErrorBoundary } from '@/components/error-boundary';
import { ChatHeader } from '@/components/chat-header';
import { ChatInput, type ChatInputHandle, type ChatSubmitOptions } from '@/components/chat-input';
import { ChatMessageList } from '@/components/chat-message-list';
import { useToast } from '@/components/ui/toast';
import { useChatStream } from '@/hooks/use-chat-stream';
import { addMessage, deleteMessagesByIds, getThreadMessages, useMessages } from '@/hooks/use-messages';
import { useRetryLogic } from '@/hooks/use-retry-logic';
import {
    updateReasoningEffort,
    updateThreadModel,
    updateThreadSystemPrompt,
    useThread,
} from '@/hooks/use-threads';
import {
    AVAILABLE_MODELS,
    DEFAULT_MODEL,
    DEFAULT_REASONING_EFFORT,
    IMAGE_GENERATION_MODEL,
    PENDING_GENERATION_MODEL_KEY,
    PENDING_GENERATION_SEARCH_KEY,
    PENDING_GENERATION_THREAD_KEY,
    PENDING_SYSTEM_PROMPT_KEY,
} from '@/lib/constants';
import { type ChatViewMessage, type RetryMode } from '@/lib/chat-view';
import { type Attachment, type ReasoningEffort } from '@/lib/types';

interface ChatPageClientProps {
    chatId: string;
}

function isSelectableChatModel(modelId: string): boolean {
    const modelConfig = AVAILABLE_MODELS.find((m) => m.id === modelId);
    if (!modelConfig) return false;
    return !modelConfig.hidden && !modelConfig.capabilities.includes('imageGen');
}

export function ChatPageClient({ chatId }: ChatPageClientProps) {
    const thread = useThread(chatId);
    const { messages: storedMessages, refreshMessages: refreshStoredMessages } = useMessages(chatId);
    const virtuosoRef = useRef<VirtuosoHandle>(null);
    const chatInputRef = useRef<ChatInputHandle>(null);
    const [model, setModel] = useState<string>(DEFAULT_MODEL);
    const [messages, setMessages] = useState<ChatViewMessage[]>([]);
    const [reasoningEffort, setReasoningEffort] = useState<ReasoningEffort>(DEFAULT_REASONING_EFFORT);
    const [systemPrompt, setSystemPrompt] = useState('');
    const [isAtBottom, setIsAtBottom] = useState(true);
    const hasInitialized = useRef(false);
    const currentMessagesChatId = useRef<string | null>(null);
    const justAddedMessageIdRef = useRef<string | null>(null);
    const locallyDeletedMessageIdsRef = useRef<Set<string>>(new Set());
    const persistRetryModeHintRef = useRef<((userMessageId: string, mode: RetryMode) => void) | null>(null);
    const { showToast } = useToast();

    const {
        isLoading,
        isThinking,
        setIsLoading,
        handleStop,
        generateResponse,
        lastRequestFailedRef,
        resetStreamState,
    } = useChatStream({
        chatId,
        model,
        reasoningEffort,
        systemPrompt,
        setMessages,
        justAddedMessageIdRef,
        persistRetryModeHintRef,
        showToast,
    });

    const getInputMode = useCallback(() => chatInputRef.current?.getMode(), []);

    const { handleRetry, persistRetryModeHint } = useRetryLogic({
        chatId,
        messages,
        setMessages,
        setIsLoading,
        showToast,
        getInputMode,
        generateResponse,
        refreshStoredMessages,
        locallyDeletedMessageIdsRef,
    });

    useEffect(() => {
        persistRetryModeHintRef.current = persistRetryModeHint;
    }, [persistRetryModeHint]);

    const applyThreadState = useCallback(() => {
        if (thread?.model && isSelectableChatModel(thread.model)) {
            setModel(thread.model);
        }
        if (thread?.reasoning_effort) {
            setReasoningEffort(thread.reasoning_effort);
        }
        setSystemPrompt(thread?.system_prompt ?? '');
    }, [thread]);

    useEffect(() => {
        // eslint-disable-next-line react-hooks/set-state-in-effect
        applyThreadState();
    }, [applyThreadState]);

    const syncLocalMessages = useCallback(() => {
        if (storedMessages === null) return;

        // Reset if we've switched chats.
        if (hasInitialized.current && storedMessages && storedMessages.length === 0 && messages.length > 0) {
            setMessages([]);
            hasInitialized.current = false;
        }

        if (!hasInitialized.current && storedMessages) {
            hasInitialized.current = true;
            currentMessagesChatId.current = chatId;
            setMessages(
                storedMessages.map((m) => ({
                    id: m.id,
                    role: m.role,
                    content: m.content,
                    attachments: m.attachments ?? [],
                    reasoning: m.reasoning,
                    model_id: m.model_id,
                }))
            );
        } else {
            // Update messages from storage only when not generating.
            if (!isLoading && !isThinking && storedMessages) {
                // Protect local retry/edit state from stale realtime snapshots that still contain deleted messages.
                if (locallyDeletedMessageIdsRef.current.size > 0) {
                    const hasLocallyDeleted = storedMessages.some((m) => locallyDeletedMessageIdsRef.current.has(m.id));
                    if (hasLocallyDeleted) {
                        return;
                    }
                    locallyDeletedMessageIdsRef.current.clear();
                }

                // If we just added a message, wait for it to appear in storedMessages before syncing.
                if (justAddedMessageIdRef.current) {
                    const found = storedMessages.find(m => m.id === justAddedMessageIdRef.current);
                    if (!found) {
                        return;
                    }
                    justAddedMessageIdRef.current = null;
                }

                currentMessagesChatId.current = chatId;
                setMessages(
                    storedMessages.map((m) => ({
                        id: m.id,
                        role: m.role,
                        content: m.content,
                        attachments: m.attachments ?? [],
                        reasoning: m.reasoning,
                        model_id: m.model_id,
                    }))
                );
            }
        }
    }, [storedMessages, messages.length, chatId, isLoading, isThinking]);

    useEffect(() => {
        // eslint-disable-next-line react-hooks/set-state-in-effect
        syncLocalMessages();
    }, [syncLocalMessages]);

    const resetLocalChatState = useCallback(() => {
        hasInitialized.current = false;
        currentMessagesChatId.current = null;
        setMessages([]);

        if (chatInputRef.current) {
            chatInputRef.current.setValue('');
        }

        resetStreamState();
        setReasoningEffort(DEFAULT_REASONING_EFFORT);
        setSystemPrompt('');
        setIsAtBottom(true);
    }, [resetStreamState]);

    useEffect(() => {
        // Prepare for new chat ID.
        // eslint-disable-next-line react-hooks/set-state-in-effect
        resetLocalChatState();
    }, [chatId, resetLocalChatState]);

    const scrollToBottom = useCallback(() => {
        if (virtuosoRef.current) {
            virtuosoRef.current.scrollToIndex({ index: messages.length - 1, align: 'end', behavior: 'smooth' });
            setIsAtBottom(true);
        }
    }, [messages.length]);

    useEffect(() => {
        if (virtuosoRef.current && isAtBottom) {
            virtuosoRef.current.scrollToIndex({ index: messages.length - 1, align: 'end' });
        }
    }, [messages.length, isThinking, isAtBottom]);

    const handleModelChange = async (newModel: string) => {
        if (!isSelectableChatModel(newModel)) {
            return;
        }
        const previousModel = model;
        setModel(newModel);
        try {
            await updateThreadModel(chatId, newModel);
        } catch (error) {
            setModel(previousModel);
            const message = error instanceof Error ? error.message : 'Failed to update model';
            showToast(message, 'error');
        }
    };

    const handleReasoningEffortChange = async (effort: ReasoningEffort) => {
        const previousEffort = reasoningEffort;
        setReasoningEffort(effort);
        try {
            await updateReasoningEffort(chatId, effort);
        } catch (error) {
            setReasoningEffort(previousEffort);
            const message = error instanceof Error ? error.message : 'Failed to update reasoning effort';
            showToast(message, 'error');
        }
    };

    const handleSystemPromptChange = async (nextPrompt: string) => {
        const previousPrompt = systemPrompt;
        setSystemPrompt(nextPrompt);
        try {
            await updateThreadSystemPrompt(chatId, nextPrompt);
        } catch (error) {
            setSystemPrompt(previousPrompt);
            const message = error instanceof Error ? error.message : 'Failed to update system prompt';
            showToast(message, 'error');
        }
    };

    // Check for pending user message on load (e.g. new chat from home).
    useEffect(() => {
        // Don't auto-retry if the last request failed or if messages don't belong to current chat.
        if (lastRequestFailedRef.current || currentMessagesChatId.current !== chatId) {
            return;
        }
        if (hasInitialized.current && messages.length > 0 && !isLoading && !isThinking) {
            const lastMessage = messages[messages.length - 1];
            if (lastMessage.role === 'user') {
                const pendingGenerationThreadId = window.sessionStorage.getItem(PENDING_GENERATION_THREAD_KEY);
                if (pendingGenerationThreadId !== chatId) {
                    return;
                }
                const pendingGenerationModelId = window.sessionStorage.getItem(PENDING_GENERATION_MODEL_KEY);
                const pendingGenerationSearch = window.sessionStorage.getItem(PENDING_GENERATION_SEARCH_KEY);
                const pendingSystemPrompt = window.sessionStorage.getItem(PENDING_SYSTEM_PROMPT_KEY);
                window.sessionStorage.removeItem(PENDING_GENERATION_THREAD_KEY);
                window.sessionStorage.removeItem(PENDING_GENERATION_MODEL_KEY);
                window.sessionStorage.removeItem(PENDING_GENERATION_SEARCH_KEY);
                window.sessionStorage.removeItem(PENDING_SYSTEM_PROMPT_KEY);
                if (pendingGenerationModelId === IMAGE_GENERATION_MODEL) {
                    generateResponse(messages, IMAGE_GENERATION_MODEL, undefined, false);
                    return;
                }
                generateResponse(messages, undefined, pendingSystemPrompt || undefined, pendingGenerationSearch === '1');
            }
        }
    }, [messages, isLoading, isThinking, generateResponse, chatId, lastRequestFailedRef]);

    const sendMessage = useCallback(async (
        userMessage: string,
        attachments: Attachment[],
        existingMessages: ChatViewMessage[],
        options: ChatSubmitOptions
    ) => {
        setIsLoading(true);
        // Reset the failure flag when user manually sends a message.
        lastRequestFailedRef.current = false;
        const targetModel = options.mode === 'image' ? IMAGE_GENERATION_MODEL : model;
        const useSearch = options.mode === 'search';

        const userMsg: ChatViewMessage = {
            id: crypto.randomUUID(),
            role: 'user',
            content: userMessage,
            attachments,
        };

        const updatedMessages = [...existingMessages, userMsg];
        setMessages(updatedMessages);

        try {
            const persistedUser = await addMessage(chatId, 'user', userMessage, undefined, undefined, attachments);
            const persistedMessages = updatedMessages.map((m) =>
                m.id === userMsg.id ? { ...m, id: persistedUser.id } : m
            );
            setMessages(persistedMessages);

            await generateResponse(persistedMessages, targetModel, undefined, useSearch);
            return true;
        } catch (error) {
            setIsLoading(false);
            console.error('Failed to send message:', error);
            showToast('Failed to send message. Please try again.', 'error');
            return false;
        }
    }, [chatId, generateResponse, showToast, model, setIsLoading, lastRequestFailedRef]);

    const handleSend = useCallback(async (value: string, attachments: Attachment[], options: ChatSubmitOptions) => {
        if ((!value.trim() && attachments.length === 0) || isLoading) return false;
        setIsAtBottom(true);
        return sendMessage(value, attachments, messages, options);
    }, [isLoading, messages, sendMessage]);

    const handlePromptClick = (prompt: string) => {
        if (chatInputRef.current) {
            chatInputRef.current.setValue(prompt);
            chatInputRef.current.focus();
        }
    };

    const handleEdit = useCallback(async (messageId: string, newContent: string) => {
        setIsLoading(true);
        const localMessages = messages;
        const msgIndex = localMessages.findIndex(m => m.id === messageId);
        if (msgIndex === -1) {
            setIsLoading(false);
            return;
        }
        const editedMessageAttachments = localMessages[msgIndex].attachments ?? [];

        const anchorBeforeEditId = msgIndex > 0 ? localMessages[msgIndex - 1].id : null;
        try {
            const canonicalMessages = await getThreadMessages(chatId);
            const anchorDbIndex = anchorBeforeEditId
                ? canonicalMessages.findIndex((m) => m.id === anchorBeforeEditId)
                : -1;

            const deleteStartIndex = anchorBeforeEditId ? anchorDbIndex + 1 : 0;
            if (anchorBeforeEditId && anchorDbIndex === -1) {
                setIsLoading(false);
                showToast('Edit failed to align with saved history. Refresh and try again.', 'error');
                return;
            }

            const deleteIds = canonicalMessages.slice(deleteStartIndex).map((m) => m.id);
            if (deleteIds.length > 0) {
                deleteIds.forEach((id) => locallyDeletedMessageIdsRef.current.add(id));
            }
            await deleteMessagesByIds(deleteIds);
            const persistedUser = await addMessage(chatId, 'user', newContent, undefined, undefined, editedMessageAttachments);
            const keptMessages = canonicalMessages.slice(0, deleteStartIndex).map((m) => ({
                id: m.id,
                role: m.role,
                content: m.content,
                attachments: m.attachments ?? [],
                reasoning: m.reasoning,
                model_id: m.model_id,
            })) as ChatViewMessage[];
            const updatedMessages: ChatViewMessage[] = [
                ...keptMessages,
                {
                    id: persistedUser.id,
                    role: persistedUser.role,
                    content: persistedUser.content,
                    attachments: persistedUser.attachments ?? [],
                    reasoning: persistedUser.reasoning,
                    model_id: persistedUser.model_id,
                },
            ];

            setMessages(updatedMessages);
            if (persistedUser.id) {
                justAddedMessageIdRef.current = persistedUser.id;
            }
            void (async () => {
                const refreshResult = await refreshStoredMessages();
                if (!refreshResult.ok) {
                    showToast(refreshResult.error, 'error');
                }
            })();

            await generateResponse(updatedMessages);
        } catch (error) {
            setIsLoading(false);
            console.error('Failed to edit message:', error);
            showToast('Failed to edit message history. Please try again.', 'error');
        }
    }, [messages, chatId, showToast, generateResponse, refreshStoredMessages, setIsLoading]);

    const shouldShowLoadingBlank =
        storedMessages === null || (storedMessages && storedMessages.length > 0 && messages.length === 0);
    const shouldShowEmptyState = !!storedMessages && storedMessages.length === 0 && !isThinking;

    return (
        <div className="flex flex-col h-full bg-[#1a1520]">
            <div className="flex-1 min-h-0 relative">
                <ErrorBoundary
                    onError={(error) => {
                        console.error('[ui] chat-message-area-boundary', error);
                    }}
                    fallback={(
                        <div className="flex h-full items-center justify-center px-6">
                            <div className="w-full max-w-lg rounded-2xl border border-red-500/30 bg-red-950/20 p-6 text-zinc-100">
                                <h2 className="text-lg font-semibold">Message area failed to render</h2>
                                <p className="mt-2 text-sm text-zinc-300">
                                    You can continue using the input below, or reload to recover.
                                </p>
                                <button
                                    onClick={() => window.location.reload()}
                                    className="mt-4 rounded-md border border-white/20 px-3 py-2 text-sm hover:bg-white/10"
                                >
                                    Reload page
                                </button>
                            </div>
                        </div>
                    )}
                >
                    {shouldShowLoadingBlank ? null : shouldShowEmptyState ? (
                        <ChatEmptyState onPromptClick={handlePromptClick} />
                    ) : (
                        <ChatMessageList
                            messages={messages}
                            model={model}
                            isLoading={isLoading}
                            isThinking={isThinking}
                            virtuosoRef={virtuosoRef}
                            setIsAtBottom={setIsAtBottom}
                            onEdit={handleEdit}
                            onRetry={handleRetry}
                        />
                    )}
                </ErrorBoundary>
            </div>

            <ChatHeader
                showScrollButton={!isAtBottom}
                hasMessages={messages.length > 0}
                onScrollToBottom={scrollToBottom}
            />

            <ChatInput
                ref={chatInputRef}
                onSubmit={handleSend}
                threadId={chatId}
                onStop={handleStop}
                isLoading={isLoading}
                currentModel={model}
                onModelChange={handleModelChange}
                reasoningEffort={reasoningEffort}
                onReasoningEffortChange={handleReasoningEffortChange}
                systemPrompt={systemPrompt}
                onSystemPromptChange={handleSystemPromptChange}
            />
        </div>
    );
}
