'use client';

import { useCallback, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { type VirtuosoHandle } from 'react-virtuoso';
import dynamic from 'next/dynamic';
import { useRouter } from 'next/navigation';

import { ChatDestructiveConfirmDialog } from '@/features/chat';
import { ChatEmptyState } from '@/features/chat';
import { ErrorBoundary } from '@/shared/components/error-boundary';
import { ChatHeader } from '@/features/chat';
import { ChatInput, type ChatInputHandle } from '@/features/chat';
import { useToast } from '@/components/ui/toast';
import { useChatMessageState } from '@/features/chat';
import { useChatScroll } from '@/features/chat';
import { useChatStream } from '@/features/chat';
import { useDestructiveDeleteConfirm } from '@/features/chat';
import { addMessage, deleteMessagesByIds, getThreadMessages, useMessages } from '@/features/messages';
import { usePendingGeneration } from '@/features/chat';
import { useRetryLogic } from '@/features/chat';
import { useThread, branchThread, type Thread } from '@/features/threads';
import { useThreadSettings } from '@/features/chat';
import { type ChatViewMessage } from '@/features/chat';
import { type Attachment } from '@/shared/core/types';

interface ChatPageClientProps {
    chatId: string;
    initialThread?: Thread;
}

const ChatMessageList = dynamic(
    () => import('@/features/chat').then((mod) => mod.ChatMessageList),
    { ssr: false }
);

export function ChatPageClient({ chatId, initialThread }: ChatPageClientProps) {
    const router = useRouter();
    const thread = useThread(chatId, initialThread);
    const { messages: storedMessages, refreshMessages: refreshStoredMessages } = useMessages(chatId);
    const virtuosoRef = useRef<VirtuosoHandle>(null);
    const chatInputRef = useRef<ChatInputHandle>(null);
    const [messages, setMessages] = useState<ChatViewMessage[]>([]);
    const justAddedMessageIdRef = useRef<string | null>(null);
    const locallyDeletedMessageIdsRef = useRef<Set<string>>(new Set());
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
        refreshMessages: refreshStoredMessages,
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

    const { handleRetry } = useRetryLogic({
        chatId,
        messages,
        setMessages,
        setIsLoading,
        showToast,
        generateResponse,
        refreshStoredMessages,
        locallyDeletedMessageIdsRef,
        confirmDestructiveDelete,
    });

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
        applyPendingReasoningEffort,
        generateResponse,
    });

    const sendMessage = useCallback(async (
        userMessage: string,
        attachments: Attachment[],
        existingMessages: ChatViewMessage[],
    ) => {
        setIsLoading(true);
        // Reset the failure flag when user manually sends a message.
        clearLastRequestFailure();
        const targetModel = modelRef.current;

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

            await generateResponse(persistedMessages, targetModel);
            return true;
        } catch (error) {
            setIsLoading(false);
            console.error('Failed to send message:', error);
            showToast('Failed to send message. Please try again.', 'error');
            return false;
        }
    }, [chatId, generateResponse, showToast, setIsLoading, clearLastRequestFailure, modelRef]);

    const handleSend = useCallback(async (value: string, attachments: Attachment[]) => {
        if ((!value.trim() && attachments.length === 0) || isLoading) return false;
        setIsAtBottom(true);
        return sendMessage(value, attachments, visibleMessages);
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
        const editModelId = modelRef.current;

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

            await generateResponse(updatedMessages, editModelId);
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

    const handleBranch = useCallback(async (messageId: string) => {
        if (!thread) return;
        setIsLoading(true);
        showToast('Branching conversation...', 'info');
        try {
            const newThread = await branchThread(chatId, messageId, thread, messages);
            showToast('Conversation branched successfully!', 'success');
            router.push(`/c/${newThread.id}`);
        } catch (error) {
            console.error('Failed to branch conversation:', error);
            showToast('Failed to branch conversation. Please try again.', 'error');
        } finally {
            setIsLoading(false);
        }
    }, [chatId, thread, messages, showToast, router, setIsLoading]);

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
                            onBranch={handleBranch}
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
