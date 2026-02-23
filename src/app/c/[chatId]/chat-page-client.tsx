'use client';

import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { type VirtuosoHandle } from 'react-virtuoso';
import dynamic from 'next/dynamic';

import { ChatDestructiveConfirmDialog } from '@/features/chat/components/chat-destructive-confirm-dialog';
import { ChatEmptyState } from '@/components/chat-empty-state';
import { ErrorBoundary } from '@/shared/components/error-boundary';
import { ChatHeader } from '@/components/chat-header';
import { ChatInput, type ChatInputHandle, type ChatSubmitOptions } from '@/features/chat/components/chat-input';
import { useToast } from '@/components/ui/toast';
import { useChatMessageState } from '@/features/chat/hooks/use-chat-message-state';
import { useChatScroll } from '@/features/chat/hooks/use-chat-scroll';
import { useChatStream } from '@/features/chat/hooks/use-chat-stream';
import { useDestructiveDeleteConfirm } from '@/features/chat/hooks/use-destructive-delete-confirm';
import { addMessage, deleteMessagesByIds, getThreadMessages, useMessages } from '@/features/messages/hooks/use-messages';
import { usePendingGeneration } from '@/features/chat/hooks/use-pending-generation';
import { useRetryLogic } from '@/features/chat/hooks/use-retry-logic';
import { useThread } from '@/features/threads/hooks/use-threads';
import { useThreadSettings } from '@/features/chat/hooks/use-thread-settings';
import {
    IMAGE_GENERATION_MODEL,
    isImageGenerationModel,
    SEARCH_ENABLED_MODELS,
    VIDEO_GENERATION_MODEL,
} from '@/lib/constants';
import { isImageAttachment } from '@/lib/attachments';
import { type ChatViewMessage, type RetryMode } from '@/lib/chat-view';
import { type Attachment } from '@/lib/types';

interface ChatPageClientProps {
    chatId: string;
}

const ChatMessageList = dynamic(
    () => import('@/features/chat/components/chat-message-list').then((mod) => mod.ChatMessageList),
    { ssr: false }
);

const RETRY_MODE_HINTS_KEY = 'retry-mode-hints';
const SEARCH_ENABLED_MODEL_SET = new Set<string>(SEARCH_ENABLED_MODELS);

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

function getRetryModeHint(threadId: string, userMessageId: string): RetryMode | undefined {
    if (!threadId || !userMessageId) return undefined;
    const hints = readRetryModeHints();
    return hints[threadId]?.[userMessageId];
}

function hasImageAttachment(message: ChatViewMessage): boolean {
    return (message.attachments ?? []).some((attachment) => isImageAttachment(attachment.mimeType));
}

function hasVideoAttachment(message: ChatViewMessage): boolean {
    return (message.attachments ?? []).some((attachment) => attachment.mimeType.startsWith('video/'));
}

function looksLikeSearchResponse(content: string): boolean {
    return /\[\d+\]\(https?:\/\/[^\s)]+\)/.test(content);
}

function inferEditGenerationMode(
    localMessages: ChatViewMessage[],
    anchorUserIndex: number,
    threadId: string
) {
    const anchorUser = localMessages[anchorUserIndex];
    if (!anchorUser || anchorUser.role !== 'user') {
        return { forcedModelId: undefined as string | undefined, forceSearchMode: false };
    }

    const hint = getRetryModeHint(threadId, anchorUser.id);
    if (hint === 'image') {
        return {
            forcedModelId: isImageGenerationModel(anchorUser.model_id) ? anchorUser.model_id : IMAGE_GENERATION_MODEL,
            forceSearchMode: false,
        };
    }
    if (hint === 'video') {
        return { forcedModelId: VIDEO_GENERATION_MODEL, forceSearchMode: false };
    }
    if (hint === 'search') {
        return { forcedModelId: undefined as string | undefined, forceSearchMode: true };
    }

    const nextAssistantMessage = localMessages
        .slice(anchorUserIndex + 1)
        .find((message) => message.role === 'assistant');
    if (!nextAssistantMessage) {
        return { forcedModelId: undefined as string | undefined, forceSearchMode: false };
    }

    if (
        nextAssistantMessage.model_id === VIDEO_GENERATION_MODEL
        || hasVideoAttachment(nextAssistantMessage)
    ) {
        return { forcedModelId: VIDEO_GENERATION_MODEL, forceSearchMode: false };
    }

    if (
        isImageGenerationModel(nextAssistantMessage.model_id)
        || hasImageAttachment(nextAssistantMessage)
    ) {
        return { forcedModelId: nextAssistantMessage.model_id || IMAGE_GENERATION_MODEL, forceSearchMode: false };
    }

    if (
        nextAssistantMessage.model_id
        && SEARCH_ENABLED_MODEL_SET.has(nextAssistantMessage.model_id)
        && looksLikeSearchResponse(nextAssistantMessage.content)
    ) {
        return { forcedModelId: undefined as string | undefined, forceSearchMode: true };
    }

    return { forcedModelId: undefined as string | undefined, forceSearchMode: false };
}

export function ChatPageClient({ chatId }: ChatPageClientProps) {
    const thread = useThread(chatId);
    const { messages: storedMessages, refreshMessages: refreshStoredMessages } = useMessages(chatId);
    const virtuosoRef = useRef<VirtuosoHandle>(null);
    const chatInputRef = useRef<ChatInputHandle>(null);
    const [messages, setMessages] = useState<ChatViewMessage[]>([]);
    const justAddedMessageIdRef = useRef<string | null>(null);
    const locallyDeletedMessageIdsRef = useRef<Set<string>>(new Set());
    const persistRetryModeHintRef = useRef<((userMessageId: string, mode: RetryMode) => void) | null>(null);
    const prevChatIdRef = useRef<string | null>(null);
    const { showToast } = useToast();

    const {
        model,
        modelRef,
        reasoningEffort,
        reasoningEffortRef,
        systemPrompt,
        applyPendingReasoningEffort,
        resetThreadScopedState,
        handleModelChange,
        handleReasoningEffortChange,
        handleSystemPromptChange,
    } = useThreadSettings({
        chatId,
        thread,
        showToast,
    });

    const {
        isLoading,
        isThinking,
        setIsLoading,
        handleStop,
        generateResponse,
        lastRequestFailed,
        clearLastRequestFailure,
        resetStreamState,
    } = useChatStream({
        chatId,
        model,
        reasoningEffortRef,
        systemPrompt,
        setMessages,
        justAddedMessageIdRef,
        persistRetryModeHintRef,
        showToast,
    });

    const { messagesReady } = useChatMessageState({
        setMessages,
        storedMessages,
        isLoading,
        isThinking,
        justAddedMessageIdRef,
        locallyDeletedMessageIdsRef,
    });

    const visibleMessages = useMemo(() => messages, [messages]);

    const { isAtBottom, setIsAtBottom, scrollToBottom, handleAtBottomStateChange } = useChatScroll({
        chatId,
        messagesReady,
        messageCount: visibleMessages.length,
        virtuosoRef,
    });

    const {
        deleteConfirm,
        confirmDestructiveDelete,
        closeDeleteConfirm,
    } = useDestructiveDeleteConfirm();

    const getInputMode = useCallback(() => chatInputRef.current?.getMode(), []);
    const getInputImageModelId = useCallback(() => chatInputRef.current?.getImageModelId(), []);

    const { handleRetry, persistRetryModeHint } = useRetryLogic({
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
    });

    useEffect(() => {
        persistRetryModeHintRef.current = persistRetryModeHint;
    }, [persistRetryModeHint]);

    useLayoutEffect(() => {
        // Only reset when actually switching between different chats, not on initial mount.
        if (prevChatIdRef.current !== null && prevChatIdRef.current !== chatId) {
            setMessages([]);
            chatInputRef.current?.setValue('');
            resetStreamState();
            resetThreadScopedState();
            setIsAtBottom(true);
        }
        prevChatIdRef.current = chatId;
    }, [chatId, resetStreamState, resetThreadScopedState, setIsAtBottom]);

    usePendingGeneration({
        chatId,
        messages,
        messagesReady,
        isLoading,
        isThinking,
        lastRequestFailed,
        chatInputRef,
        applyPendingReasoningEffort,
        generateResponse,
    });

    const sendMessage = useCallback(async (
        userMessage: string,
        attachments: Attachment[],
        existingMessages: ChatViewMessage[],
        options: ChatSubmitOptions
    ) => {
        setIsLoading(true);
        // Reset the failure flag when user manually sends a message.
        clearLastRequestFailure();
        const isImageMode = options.mode === 'image' || options.mode === 'image-edit';
        const isVideoMode = options.mode === 'video';
        const selectedImageModelId = options.imageModelId && isImageGenerationModel(options.imageModelId)
            ? options.imageModelId
            : IMAGE_GENERATION_MODEL;
        const targetModel = isImageMode ? selectedImageModelId : (isVideoMode ? VIDEO_GENERATION_MODEL : modelRef.current);
        const useSearch = options.mode === 'search';

        const userMsg: ChatViewMessage = {
            id: crypto.randomUUID(),
            role: 'user',
            content: userMessage,
            attachments,
            model_id: targetModel,
        };

        const updatedMessages = [...existingMessages, userMsg];
        setMessages(updatedMessages);

        try {
            const persistedUser = await addMessage(chatId, 'user', userMessage, undefined, targetModel, attachments);
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
    }, [chatId, generateResponse, showToast, setIsLoading, clearLastRequestFailure, modelRef]);

    const handleSend = useCallback(async (value: string, attachments: Attachment[], options: ChatSubmitOptions) => {
        if ((!value.trim() && attachments.length === 0) || isLoading) return false;
        setIsAtBottom(true);
        return sendMessage(value, attachments, visibleMessages, options);
    }, [isLoading, visibleMessages, sendMessage, setIsAtBottom]);

    const handlePromptClick = useCallback((prompt: string) => {
        if (chatInputRef.current) {
            chatInputRef.current.setValue(prompt);
            chatInputRef.current.focus();
        }
    }, []);

    const handleEdit = useCallback(async (messageId: string, newContent: string) => {
        setIsLoading(true);
        const localMessages = messages;
        const msgIndex = localMessages.findIndex(m => m.id === messageId);
        if (msgIndex === -1) {
            setIsLoading(false);
            return;
        }
        const editedMessageAttachments = localMessages[msgIndex].attachments ?? [];
        const { forcedModelId, forceSearchMode } = inferEditGenerationMode(localMessages, msgIndex, chatId);
        const editModelId = forcedModelId ?? modelRef.current;

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
                const confirmed = await confirmDestructiveDelete({
                    action: 'edit',
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
                reason: 'edit',
                anchorMessageId: anchorBeforeEditId,
                threadId: chatId,
            });
            const persistedUser = await addMessage(chatId, 'user', newContent, undefined, editModelId, editedMessageAttachments);
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

            await generateResponse(updatedMessages, forcedModelId, undefined, forceSearchMode);
        } catch (error) {
            setIsLoading(false);
            console.error('Failed to edit message:', error);
            showToast('Failed to edit message history. Please try again.', 'error');
        }
    }, [
        messages,
        chatId,
        showToast,
        generateResponse,
        refreshStoredMessages,
        setIsLoading,
        confirmDestructiveDelete,
        modelRef,
    ]);

    const shouldShowEmptyState = messagesReady && visibleMessages.length === 0 && !isThinking;
    // Keep Virtuoso permanently mounted so it never loses scroll position or
    // measured item sizes across thread switches. Hide it with CSS when we
    // need to show the empty state or while messages are still loading.
    const hideMessageList = !messagesReady || shouldShowEmptyState;

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
                    {shouldShowEmptyState && (
                        <ChatEmptyState onPromptClick={handlePromptClick} />
                    )}
                    <div
                        className="absolute inset-0"
                        style={hideMessageList ? { opacity: 0, pointerEvents: 'none' } : undefined}
                    >
                        <ChatMessageList
                            messages={visibleMessages}
                            model={model}
                            isLoading={isLoading}
                            isThinking={isThinking}
                            shouldAutoFollow={isLoading || isThinking}
                            virtuosoRef={virtuosoRef}
                            setIsAtBottom={handleAtBottomStateChange}
                            onEdit={handleEdit}
                            onRetry={handleRetry}
                        />
                    </div>
                </ErrorBoundary>
            </div>

            <ChatHeader
                showScrollButton={!isAtBottom}
                hasMessages={visibleMessages.length > 0}
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

            <ChatDestructiveConfirmDialog
                confirm={deleteConfirm}
                onClose={closeDeleteConfirm}
            />
        </div>
    );
}



