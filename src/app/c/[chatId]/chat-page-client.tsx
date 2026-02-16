'use client';

import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { type VirtuosoHandle } from 'react-virtuoso';
import dynamic from 'next/dynamic';

import { ChatEmptyState } from '@/components/chat-empty-state';
import { ErrorBoundary } from '@/components/error-boundary';
import { ChatHeader } from '@/components/chat-header';
import { ChatInput, type ChatInputHandle, type ChatSubmitOptions } from '@/components/chat-input';
import { useToast } from '@/components/ui/toast';
import { scheduleFrame } from '@/lib/animation-frame';
import { isImageAttachment } from '@/lib/attachments';
import { useChatStream } from '@/hooks/use-chat-stream';
import { addMessage, deleteMessagesByIds, getThreadMessages, useMessages, type Message } from '@/hooks/use-messages';
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
    SEARCH_ENABLED_MODELS,
} from '@/lib/constants';
import { type ChatViewMessage, type RetryMode } from '@/lib/chat-view';
import { type Attachment, type ReasoningEffort } from '@/lib/types';

interface ChatPageClientProps {
    chatId: string;
}

type DestructiveDeleteConfirm = {
    action: 'retry' | 'edit';
    deleteCount: number;
    resolve: (confirmed: boolean) => void;
};

const ChatMessageList = dynamic(
    () => import('@/components/chat-message-list').then((mod) => mod.ChatMessageList),
    { ssr: false }
);

const RETRY_MODE_HINTS_KEY = 'retry-mode-hints';
const SEARCH_ENABLED_MODEL_SET = new Set<string>(SEARCH_ENABLED_MODELS);

function areAttachmentListsEqual(left: Attachment[] | undefined, right: Attachment[] | undefined) {
    const a = left ?? [];
    const b = right ?? [];
    if (a.length !== b.length) return false;
    for (let i = 0; i < a.length; i++) {
        if (
            a[i].id !== b[i].id
            || a[i].name !== b[i].name
            || a[i].mimeType !== b[i].mimeType
            || a[i].size !== b[i].size
            || a[i].path !== b[i].path
            || a[i].url !== b[i].url
        ) {
            return false;
        }
    }
    return true;
}

function mapStoredMessageToViewMessage(message: Message): ChatViewMessage {
    return {
        id: message.id,
        role: message.role,
        content: message.content,
        attachments: message.attachments ?? [],
        reasoning: message.reasoning,
        model_id: message.model_id,
    };
}

function isSameMessageSnapshot(view: ChatViewMessage, stored: Message) {
    return (
        view.id === stored.id
        && view.role === stored.role
        && view.content === stored.content
        && (view.reasoning ?? undefined) === (stored.reasoning ?? undefined)
        && (view.model_id ?? undefined) === (stored.model_id ?? undefined)
        && areAttachmentListsEqual(view.attachments, stored.attachments)
    );
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

function getRetryModeHint(threadId: string, userMessageId: string): RetryMode | undefined {
    if (!threadId || !userMessageId) return undefined;
    const hints = readRetryModeHints();
    return hints[threadId]?.[userMessageId];
}

function hasImageAttachment(message: ChatViewMessage): boolean {
    return (message.attachments ?? []).some((attachment) => isImageAttachment(attachment.mimeType));
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
        return { forcedModelId: IMAGE_GENERATION_MODEL, forceSearchMode: false };
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
        nextAssistantMessage.model_id === IMAGE_GENERATION_MODEL
        || hasImageAttachment(nextAssistantMessage)
    ) {
        return { forcedModelId: IMAGE_GENERATION_MODEL, forceSearchMode: false };
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
    const [messagesReady, setMessagesReady] = useState(false);
    const [messagesChatId, setMessagesChatId] = useState<string | null>(null);
    const [deleteConfirm, setDeleteConfirm] = useState<DestructiveDeleteConfirm | null>(null);
    const hasInitialized = useRef(false);
    const justAddedMessageIdRef = useRef<string | null>(null);
    const locallyDeletedMessageIdsRef = useRef<Set<string>>(new Set());
    const persistRetryModeHintRef = useRef<((userMessageId: string, mode: RetryMode) => void) | null>(null);
    const prevChatIdRef = useRef<string | null>(null);
    const isAtBottomRef = useRef(true);
    const initialBottomScrollChatIdRef = useRef<string | null>(null);
    const { showToast } = useToast();

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
        reasoningEffort,
        systemPrompt,
        setMessages,
        justAddedMessageIdRef,
        persistRetryModeHintRef,
        showToast,
    });

    const getInputMode = useCallback(() => chatInputRef.current?.getMode(), []);

    const confirmDestructiveDelete = useCallback((context: {
        action: 'retry' | 'edit';
        deleteCount: number;
    }) => {
        return new Promise<boolean>((resolve) => {
            setDeleteConfirm({
                action: context.action,
                deleteCount: context.deleteCount,
                resolve,
            });
        });
    }, []);

    const closeDeleteConfirm = useCallback((confirmed: boolean) => {
        setDeleteConfirm((current) => {
            if (current) {
                current.resolve(confirmed);
            }
            return null;
        });
    }, []);

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
        confirmDestructiveDelete,
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

    const applyStoredMessages = useCallback((nextStoredMessages: Message[]) => {
        setMessages((prev) => {
            if (prev.length === nextStoredMessages.length) {
                const unchanged = prev.every((message, index) =>
                    isSameMessageSnapshot(message, nextStoredMessages[index])
                );
                if (unchanged) {
                    return prev;
                }
            }

            return nextStoredMessages.map(mapStoredMessageToViewMessage);
        });
    }, []);

    const syncLocalMessages = useCallback(() => {
        if (storedMessages === null) return;

        // Reset if we've switched chats.
        if (hasInitialized.current && storedMessages && storedMessages.length === 0 && messages.length > 0) {
            setMessages([]);
            hasInitialized.current = false;
            setMessagesReady(false);
        }

        if (!hasInitialized.current && storedMessages) {
            hasInitialized.current = true;
            setMessagesChatId(chatId);
            applyStoredMessages(storedMessages);
            setMessagesReady(true);
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

                setMessagesChatId(chatId);
                applyStoredMessages(storedMessages);
            }
        }
    }, [storedMessages, messages.length, chatId, isLoading, isThinking, applyStoredMessages]);

    useEffect(() => {
        // eslint-disable-next-line react-hooks/set-state-in-effect
        syncLocalMessages();
    }, [syncLocalMessages]);

    const resetLocalChatState = useCallback(() => {
        hasInitialized.current = false;
        setMessagesChatId(null);
        setMessages([]);
        setMessagesReady(false);

        if (chatInputRef.current) {
            chatInputRef.current.setValue('');
        }

        resetStreamState();
        setReasoningEffort(DEFAULT_REASONING_EFFORT);
        setSystemPrompt('');
        setIsAtBottom(true);
    }, [resetStreamState]);

    useLayoutEffect(() => {
        // Only reset when actually switching between different chats, not on initial mount.
        if (prevChatIdRef.current !== null && prevChatIdRef.current !== chatId) {
            // eslint-disable-next-line react-hooks/set-state-in-effect
            resetLocalChatState();
        }
        if (prevChatIdRef.current !== chatId) {
            initialBottomScrollChatIdRef.current = null;
        }
        prevChatIdRef.current = chatId;
    }, [chatId, resetLocalChatState]);

    const isThreadSynchronized = messagesChatId === chatId;
    const visibleMessages = useMemo(
        () => (isThreadSynchronized ? messages : []),
        [isThreadSynchronized, messages]
    );

    const scrollToBottom = useCallback(() => {
        if (virtuosoRef.current) {
            virtuosoRef.current.scrollToIndex({ index: visibleMessages.length - 1, align: 'end', behavior: 'smooth' });
            setIsAtBottom(true);
        }
    }, [visibleMessages.length]);

    useEffect(() => {
        isAtBottomRef.current = isAtBottom;
    }, [isAtBottom]);

    // Keep viewport pinned only while actively streaming and only if user stayed at bottom.
    useEffect(() => {
        if (!isThreadSynchronized || visibleMessages.length === 0) {
            return;
        }
        if (!isAtBottomRef.current) {
            return;
        }
        if (!isLoading && !isThinking) {
            return;
        }
        if (virtuosoRef.current) {
            scheduleFrame(() => {
                virtuosoRef.current?.scrollToIndex({ index: visibleMessages.length - 1, align: 'end' });
            });
        }
    }, [visibleMessages.length, isLoading, isThinking, isThreadSynchronized]);

    // Scroll to bottom exactly once when a thread finishes initial message sync.
    useEffect(() => {
        if (!messagesReady || !isThreadSynchronized || visibleMessages.length === 0) {
            return;
        }
        if (initialBottomScrollChatIdRef.current === chatId) {
            return;
        }

        initialBottomScrollChatIdRef.current = chatId;
        scheduleFrame(() => {
            scheduleFrame(() => {
                virtuosoRef.current?.scrollToIndex({ index: visibleMessages.length - 1, align: 'end' });
            });
        });
    }, [chatId, messagesReady, isThreadSynchronized, visibleMessages.length]);

    const handleAtBottomStateChange = useCallback((nextIsAtBottom: boolean) => {
        setIsAtBottom((prev) => (prev === nextIsAtBottom ? prev : nextIsAtBottom));
    }, []);

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
        if (lastRequestFailed || messagesChatId !== chatId) {
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
    }, [messages, isLoading, isThinking, generateResponse, chatId, lastRequestFailed, messagesChatId]);

    const sendMessage = useCallback(async (
        userMessage: string,
        attachments: Attachment[],
        existingMessages: ChatViewMessage[],
        options: ChatSubmitOptions
    ) => {
        setIsLoading(true);
        // Reset the failure flag when user manually sends a message.
        clearLastRequestFailure();
        const targetModel = options.mode === 'image' ? IMAGE_GENERATION_MODEL : model;
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
    }, [chatId, generateResponse, showToast, model, setIsLoading, clearLastRequestFailure]);

    const handleSend = useCallback(async (value: string, attachments: Attachment[], options: ChatSubmitOptions) => {
        if ((!value.trim() && attachments.length === 0) || isLoading) return false;
        setIsAtBottom(true);
        return sendMessage(value, attachments, visibleMessages, options);
    }, [isLoading, visibleMessages, sendMessage]);

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
        const { forcedModelId, forceSearchMode } = inferEditGenerationMode(localMessages, msgIndex, chatId);
        const editModelId = forcedModelId ?? model;

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
        model,
        confirmDestructiveDelete,
    ]);

    const shouldShowEmptyState = messagesReady && isThreadSynchronized && visibleMessages.length === 0 && !isThinking;
    // Keep Virtuoso permanently mounted so it never loses scroll position or
    // measured item sizes across thread switches.  Hide it with CSS when we
    // need to show the empty state or while messages are still loading.
    const hideMessageList = !messagesReady || !isThreadSynchronized || shouldShowEmptyState;

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

            {deleteConfirm && (
                <div
                    className="fixed inset-0 z-[150] bg-black/70 backdrop-blur-sm flex items-center justify-center p-4"
                    onClick={() => closeDeleteConfirm(false)}
                >
                    <div
                        className="w-full max-w-md rounded-xl border border-[#3a2a40] bg-[#17101c] p-5 shadow-2xl"
                        onClick={(e) => e.stopPropagation()}
                        role="dialog"
                        aria-modal="true"
                        aria-labelledby="delete-history-title"
                    >
                        <h2 id="delete-history-title" className="text-base font-semibold text-zinc-100">
                            Confirm history rewrite
                        </h2>
                        <p className="mt-2 text-sm text-zinc-400">
                            {deleteConfirm.action === 'retry'
                                ? `Retry will remove ${deleteConfirm.deleteCount} later message${deleteConfirm.deleteCount === 1 ? '' : 's'} from this thread and regenerate from that point.`
                                : `Edit & resend will remove ${deleteConfirm.deleteCount} later message${deleteConfirm.deleteCount === 1 ? '' : 's'} from this thread and regenerate from the edited message.`}
                        </p>
                        <p className="mt-1 text-sm text-zinc-400">
                            This is now a soft delete and can be restored from audit history.
                        </p>
                        <div className="mt-5 flex items-center justify-end gap-2">
                            <button
                                className="rounded-md border border-white/20 px-3 py-2 text-sm text-zinc-300 hover:text-zinc-100 hover:bg-white/10"
                                onClick={() => closeDeleteConfirm(false)}
                            >
                                Cancel
                            </button>
                            <button
                                className="rounded-md bg-red-600 px-3 py-2 text-sm text-white hover:bg-red-500"
                                onClick={() => closeDeleteConfirm(true)}
                            >
                                Confirm
                            </button>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
}
