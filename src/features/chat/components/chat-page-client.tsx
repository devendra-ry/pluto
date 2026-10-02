'use client';

import { useCallback, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { type VirtuosoHandle } from 'react-virtuoso';
import dynamic from 'next/dynamic';
import { useRouter } from 'next/navigation';
import { Loader2 } from 'lucide-react';

import { ChatDestructiveConfirmDialog } from './chat-destructive-confirm-dialog';
import { ChatEmptyState } from './chat-empty-state';
import { ErrorBoundary } from '@/shared/components/error-boundary';
import { ChatHeader } from './chat-header';
import { MessageSearchDialog } from './message-search-dialog';
import { ChatInput, type ChatInputHandle } from './chat-input';
import { useToast } from '@/components/ui/toast';
import { Button } from '@/components/ui/button';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { useChatMessageState } from '../hooks/use-chat-message-state';
import { useChatScroll } from '../hooks/use-chat-scroll';
import { useChatStream } from '../hooks/use-chat-stream';
import { useDestructiveDeleteConfirm } from '../hooks/use-destructive-delete-confirm';
import { addMessage, editUserMessageAtomically, refreshThreadMessage, refreshThreadReply, useMessages } from '@/features/messages';
import { usePendingGeneration } from '../hooks/use-pending-generation';
import { useRetryLogic } from '../hooks/use-retry-logic';
import { ChatStreamMessageStoreProvider } from './chat-stream-message-store';
import { useThread, branchThread, type Thread } from '@/features/threads';
import { useThreadSettings } from '../hooks/use-thread-settings';
import { type ChatViewMessage } from '@/shared/contracts/chat';
import { type Attachment } from '@/shared/core/types';
import { ChatActionGate } from '../lib/chat-action-gate';

interface ChatPageClientProps {
    chatId: string;
    initialThread?: Thread;
}

const ChatMessageList = dynamic(
    () => import('./chat-message-list').then((mod) => mod.ChatMessageList),
    { ssr: false }
);

function restoreMissingMessages(
    currentMessages: ChatViewMessage[],
    originalMessages: ChatViewMessage[],
    removeIds: ReadonlySet<string>,
): ChatViewMessage[] {
    const restored = currentMessages.filter(message => !removeIds.has(message.id));
    const presentIds = new Set(restored.map(message => message.id));

    originalMessages.forEach((message, index) => {
        if (removeIds.has(message.id) || presentIds.has(message.id)) return;
        const nextOriginal = originalMessages
            .slice(index + 1)
            .find(candidate => presentIds.has(candidate.id));
        const insertAt = nextOriginal
            ? restored.findIndex(candidate => candidate.id === nextOriginal.id)
            : restored.length;
        restored.splice(insertAt < 0 ? restored.length : insertAt, 0, message);
        presentIds.add(message.id);
    });

    return restored;
}

export function ChatPageClient({ chatId, initialThread }: ChatPageClientProps) {
    const router = useRouter();
    const thread = useThread(chatId, initialThread);
    const { messages: storedMessages, error: messagesError, isLoading: isLoadingMessages, refreshMessages,
        hasOlderMessages, isLoadingOlder, olderMessagesError, loadOlderMessages, loadMessagesThroughMessage, syncStatus } = useMessages(chatId);
    const [isRefreshingMessages, setIsRefreshingMessages] = useState(false);
    const retryMessages = async () => {
        setIsRefreshingMessages(true);
        try {
            const result = await refreshMessages();
            if (!result.ok) showToast(result.error, 'error');
        } finally { setIsRefreshingMessages(false); }
    };
    const refreshPersistedReply = useCallback(
        (userMessageId: string) => refreshThreadReply(chatId, userMessageId),
        [chatId]
    );
    const virtuosoRef = useRef<VirtuosoHandle>(null);
    const chatInputRef = useRef<ChatInputHandle>(null);
    const activeChatIdRef = useRef(chatId);
    activeChatIdRef.current = chatId;
    const [messages, setMessages] = useState<ChatViewMessage[]>([]);
    const [isMessageSearchOpen, setIsMessageSearchOpen] = useState(false);
    const [jumpingMessageId, setJumpingMessageId] = useState<string | null>(null);
    const [pendingScrollMessageId, setPendingScrollMessageId] = useState<string | null>(null);
    const [highlightedMessageId, setHighlightedMessageId] = useState<string | null>(null);
    const searchJumpRevisionRef = useRef(0);
    const messagesRef = useRef(messages);
    messagesRef.current = messages;
    const justAddedMessageIdRef = useRef<string | null>(null);
    const locallyDeletedMessageIdsRef = useRef<Set<string>>(new Set());
    const prevChatIdRef = useRef<string | null>(null);
    const actionGateRef = useRef<ChatActionGate<string> | null>(null);
    if (!actionGateRef.current) actionGateRef.current = new ChatActionGate<string>();
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
        streamedMessageStore,
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
        refreshPersistedReply,
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
        locallyDeletedMessageIdsRef,
        confirmDestructiveDelete,
        actionGate: actionGateRef.current,
        isLoading,
    });

    useLayoutEffect(() => {
        const gate = actionGateRef.current;
        gate?.setScope(chatId);
        return () => gate?.invalidate();
    }, [chatId]);

    useLayoutEffect(() => {
        searchJumpRevisionRef.current += 1;
        setIsMessageSearchOpen(false);
        setJumpingMessageId(null);
        setPendingScrollMessageId(null);
        setHighlightedMessageId(null);
        return () => {
            searchJumpRevisionRef.current += 1;
        };
    }, [chatId]);

    useLayoutEffect(() => {
        if (!highlightedMessageId) return;
        const timer = window.setTimeout(() => setHighlightedMessageId(null), 3500);
        return () => window.clearTimeout(timer);
    }, [highlightedMessageId]);

    const handleSearchResultSelected = useCallback(async (messageId: string) => {
        const scopeChatId = chatId;
        const revision = ++searchJumpRevisionRef.current;
        const shouldContinue = () => searchJumpRevisionRef.current === revision && activeChatIdRef.current === scopeChatId;
        setJumpingMessageId(messageId);
        try {
            const found = await loadMessagesThroughMessage(messageId, shouldContinue);
            if (!shouldContinue()) return;
            if (!found) {
                setJumpingMessageId(null);
                showToast('That message is no longer available in this conversation.', 'error');
                return;
            }
            setPendingScrollMessageId(messageId);
        } catch (error) {
            if (!shouldContinue()) return;
            console.error('[chat] Unable to load the selected search result:', error);
            setJumpingMessageId(null);
            showToast('Could not load that message. Try again.', 'error');
        }
    }, [chatId, loadMessagesThroughMessage, showToast]);

    const handleMessageSearchOpenChange = useCallback((open: boolean) => {
        if (!open) {
            searchJumpRevisionRef.current += 1;
            setJumpingMessageId(null);
            setPendingScrollMessageId(null);
        }
        setIsMessageSearchOpen(open);
    }, []);

    const handleMessageScrolled = useCallback((messageId: string) => {
        setHighlightedMessageId(messageId);
        setPendingScrollMessageId(null);
        setJumpingMessageId(null);
        handleMessageSearchOpenChange(false);
    }, [handleMessageSearchOpenChange]);

    useLayoutEffect(() => {
        // Only reset when actually switching between different chats, not on initial mount.
        if (prevChatIdRef.current !== null && prevChatIdRef.current !== chatId) {
            closeDeleteConfirm(false);
            justAddedMessageIdRef.current = null;
            locallyDeletedMessageIdsRef.current.clear();
            setMessages([]);
            chatInputRef.current?.setValue('');
            resetStreamState();
            resetThreadScopedState();
            setIsAtBottom(true);
        }
        prevChatIdRef.current = chatId;
    }, [chatId, closeDeleteConfirm, resetStreamState, resetThreadScopedState, setIsAtBottom]);

    usePendingGeneration({
        chatId,
        messages,
        messagesReady,
        isLoading,
        isThinking,
        lastRequestFailed,
        showToast,
        applyPendingReasoningEffort,
        generateResponse,
    });

    const sendMessage = useCallback(async (
        userMessage: string,
        attachments: Attachment[],
        existingMessages: ChatViewMessage[],
    ) => {
        const gate = actionGateRef.current;
        const lease = gate?.acquire(chatId);
        if (!gate || !lease) return false;

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
        setMessages(prev => gate.isValid(lease) ? [...prev, userMsg] : prev);

        try {
            const persistedUser = await addMessage(chatId, 'user', userMessage, undefined, targetModel, attachments);
            if (!gate.isCurrent(lease)) return false;
            const persistedMessages = updatedMessages.map((m) =>
                m.id === userMsg.id ? { ...m, id: persistedUser.id } : m
            );
            setMessages(prev => gate.isValid(lease)
                ? prev.map(message => message.id === userMsg.id ? { ...message, id: persistedUser.id } : message)
                : prev);

            if (!gate.isCurrent(lease)) return false;
            await generateResponse(persistedMessages, targetModel);
            return true;
        } catch (error) {
            if (gate.isCurrent(lease)) {
                setIsLoading(false);
                setMessages(prev => gate.isValid(lease)
                    ? prev.filter(message => message.id !== userMsg.id)
                    : prev);
                console.error('Failed to send message:', error);
                showToast('Failed to send message. Please try again.', 'error');
            }
            return false;
        } finally {
            if (gate.isCurrent(lease)) setIsLoading(false);
            gate.release(lease);
        }
    }, [chatId, generateResponse, showToast, setIsLoading, clearLastRequestFailure, modelRef]);

    const handleSend = useCallback(async (value: string, attachments: Attachment[]) => {
        if ((!value.trim() && attachments.length === 0) || isLoading || !messagesReady || messagesError) return false;
        setIsAtBottom(true);
        return sendMessage(value, attachments, messagesRef.current);
    }, [isLoading, messagesReady, messagesError, sendMessage, setIsAtBottom]);

    const handlePromptClick = useCallback((prompt: string) => {
        if (chatInputRef.current) {
            chatInputRef.current.setValue(prompt);
            chatInputRef.current.focus();
        }
    }, []);

    const handleEdit = useCallback(async (messageId: string, newContent: string) => {
        if (isLoading) return;
        const gate = actionGateRef.current;
        const lease = gate?.acquire(chatId);
        if (!gate || !lease) return;

        setIsLoading(true);
        const localMessages = messagesRef.current;
        const msgIndex = localMessages.findIndex(m => m.id === messageId);
        if (msgIndex === -1) {
            setIsLoading(false);
            gate.release(lease);
            return;
        }
        const editedMessage = localMessages[msgIndex];
        if (!editedMessage) {
            setIsLoading(false);
            gate.release(lease);
            return;
        }
        const editedMessageAttachments = editedMessage.attachments ?? [];
        const editModelId = modelRef.current;

        const deleteIds = localMessages.slice(msgIndex).map((message) => message.id);
        const optimisticMessageId = crypto.randomUUID();
        const keptMessages = localMessages.slice(0, msgIndex);
        const optimisticMessage: ChatViewMessage = {
            id: optimisticMessageId,
            role: 'user',
            content: newContent,
            attachments: editedMessageAttachments,
            model_id: editModelId,
        };
        let editCommitted = false;
        try {
            if (deleteIds.length > 0) {
                const confirmed = await confirmDestructiveDelete({
                    action: 'edit',
                    deleteCount: deleteIds.length,
                });
                if (!gate.isCurrent(lease)) return;
                if (!confirmed) {
                    setIsLoading(false);
                    return;
                }
            }
            if (deleteIds.length > 0) {
                deleteIds.forEach((id) => locallyDeletedMessageIdsRef.current.add(id));
            }
            const deleteIdSet = new Set(deleteIds);
            setMessages(prev => gate.isValid(lease)
                ? [...prev.filter(message => !deleteIdSet.has(message.id)), optimisticMessage]
                : prev);

            const result = await editUserMessageAtomically({
                threadId: chatId,
                messageId,
                content: newContent,
                modelId: editModelId,
                attachments: editedMessageAttachments,
            });
            if (!gate.isCurrent(lease)) return;
            editCommitted = true;
            result.deletedMessageIds.forEach((id) => locallyDeletedMessageIdsRef.current.add(id));
            const updatedMessages = [...keptMessages, { ...optimisticMessage, id: result.userMessageId }];

            setMessages(prev => gate.isValid(lease)
                ? prev.map(message => message.id === optimisticMessageId
                    ? { ...message, id: result.userMessageId }
                    : message)
                : prev);
            justAddedMessageIdRef.current = result.userMessageId;
            void (async () => {
                const refreshResult = await refreshThreadMessage(chatId, result.userMessageId);
                if (!refreshResult.ok && gate.isCurrent(lease)) {
                    showToast(refreshResult.error, 'error');
                }
            })();

            if (!gate.isCurrent(lease)) return;
            await generateResponse(updatedMessages, editModelId);
        } catch (error) {
            if (gate.isCurrent(lease)) {
                setIsLoading(false);
                if (!editCommitted) {
                    deleteIds.forEach((id) => locallyDeletedMessageIdsRef.current.delete(id));
                    setMessages(prev => gate.isValid(lease)
                        ? restoreMissingMessages(
                            prev.filter(message => message.id !== optimisticMessageId),
                            localMessages,
                            new Set(),
                        )
                        : prev);
                    console.error('Failed to edit message:', error);
                    showToast('Failed to edit message history. Please try again.', 'error');
                } else {
                    console.error('Failed to generate edited response:', error);
                    showToast('Failed to generate response. Please try again.', 'error');
                }
            }
        } finally {
            if (gate.isCurrent(lease)) setIsLoading(false);
            gate.release(lease);
        }
    }, [
        chatId,
        isLoading,
        showToast,
        generateResponse,
        setIsLoading,
        confirmDestructiveDelete,
        modelRef,
    ]);

    const handleBranch = useCallback(async (messageId: string) => {
        if (!thread || isLoading) return;
        const gate = actionGateRef.current;
        const lease = gate?.acquire(chatId);
        if (!gate || !lease) return;

        setIsLoading(true);
        showToast('Branching conversation...', 'info');
        try {
            const newThread = await branchThread(chatId, messageId, thread, messagesRef.current);
            if (!gate.isCurrent(lease)) return;
            showToast('Conversation branched successfully!', 'success');
            router.push(`/c/${newThread.id}`);
        } catch (error) {
            if (!gate.isCurrent(lease)) return;
            console.error('Failed to branch conversation:', error);
            showToast('Failed to branch conversation. Please try again.', 'error');
        } finally {
            if (gate.isCurrent(lease)) setIsLoading(false);
            gate.release(lease);
        }
    }, [chatId, thread, isLoading, showToast, router, setIsLoading]);

    const shouldShowEmptyState = messagesReady && !messagesError && visibleMessages.length === 0 && !isThinking;
    // Keep Virtuoso permanently mounted so it never loses scroll position or
    // measured item sizes across thread switches. Hide it with CSS when we
    // need to show the empty state or while messages are still loading.
    const hideMessageList = !messagesReady || shouldShowEmptyState || (Boolean(messagesError) && visibleMessages.length === 0);

    return (
        <div className="flex h-full flex-col bg-background">
            <div className="flex-1 min-h-0 relative">
                <ErrorBoundary
                    onError={(error) => {
                        console.error('[ui] chat-message-area-boundary', error);
                    }}
                    fallback={(
                        <div className="flex h-full items-center justify-center px-6">
                            <Alert variant="destructive" className="w-full max-w-lg rounded-2xl p-6">
                                <h2 className="text-lg font-semibold">Message area failed to render</h2>
                                <AlertDescription className="mt-2">
                                    You can continue using the input below, or reload to recover.
                                </AlertDescription>
                                <Button variant="outline" className="mt-4" onClick={() => window.location.reload()}>
                                    Reload page
                                </Button>
                            </Alert>
                        </div>
                    )}
                >
                    {isLoadingMessages && visibleMessages.length === 0 && (
                        <div role="status" className="flex h-full items-center justify-center gap-2 text-sm text-muted-foreground">
                            <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> Loading conversation…
                        </div>
                    )}
                    {messagesError && (
                        <div className={visibleMessages.length ? 'relative z-10 mx-auto max-w-3xl p-4' : 'flex h-full items-center justify-center px-6'}>
                            <Alert variant="destructive" className="w-full max-w-lg rounded-2xl p-5">
                                <h2 className="font-semibold">Unable to load this conversation</h2>
                                <AlertDescription className="mt-2">Your draft is still here. Try loading your messages again before sending.</AlertDescription>
                                <Button variant="outline" className="mt-3" disabled={isRefreshingMessages} onClick={() => void retryMessages()}>{isRefreshingMessages ? 'Retrying…' : 'Try again'}</Button>
                            </Alert>
                        </div>
                    )}
                    {shouldShowEmptyState && (
                        <ChatEmptyState onPromptClick={handlePromptClick} />
                    )}
                    {(syncStatus === 'offline' || syncStatus === 'reconnecting') && <div role="status" className="absolute inset-x-0 top-0 z-20 flex items-center justify-center gap-3 border-b border-border bg-background/95 px-4 py-2 text-sm text-muted-foreground">
                        <span>{syncStatus === 'offline' ? 'You are offline. Your draft stays available.' : 'Live updates interrupted. Reconnecting…'}</span>
                        {syncStatus === 'reconnecting' && <button type="button" onClick={() => void retryMessages()} disabled={isRefreshingMessages} className="rounded-lg px-2 py-1 text-foreground hover:bg-accent">Refresh</button>}
                    </div>}
                    <div
                        className="absolute inset-0"
                        aria-hidden={hideMessageList || undefined}
                        inert={hideMessageList || undefined}
                        style={hideMessageList ? { opacity: 0, pointerEvents: 'none' } : undefined}
                    >
                        <ChatStreamMessageStoreProvider store={streamedMessageStore}>
                            <ChatMessageList
                                key={chatId}
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
                                hasOlderMessages={hasOlderMessages}
                                isLoadingOlder={isLoadingOlder}
                                olderMessagesError={olderMessagesError}
                                onLoadOlder={() => void loadOlderMessages()}
                                highlightedMessageId={highlightedMessageId}
                                scrollToMessageId={pendingScrollMessageId}
                                onMessageScrolled={handleMessageScrolled}
                            />
                        </ChatStreamMessageStoreProvider>
                    </div>
                </ErrorBoundary>
            </div>

            <ChatHeader
                showScrollButton={!isAtBottom}
                hasMessages={visibleMessages.length > 0}
                onScrollToBottom={scrollToBottom}
                onSearchMessages={() => setIsMessageSearchOpen(true)}
            />

            <MessageSearchDialog
                threadId={chatId}
                open={isMessageSearchOpen}
                onOpenChange={handleMessageSearchOpenChange}
                onSelectMessage={handleSearchResultSelected}
                jumpingMessageId={jumpingMessageId}
            />

            <ChatInput
                key={chatId}
                ref={chatInputRef}
                onSubmit={handleSend}
                threadId={chatId}
                onStop={handleStop}
                isLoading={isLoading}
                submitDisabled={!messagesReady || Boolean(messagesError)}
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
