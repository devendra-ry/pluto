/* eslint-disable react-hooks/preserve-manual-memoization, react-hooks/exhaustive-deps */
import { createRoot } from 'react-dom/client';
import { useCallback, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { QueryClientProvider } from '@tanstack/react-query';
import { ChatMessageList } from '../../../src/features/chat/components/chat-message-list';
import { useChatScroll } from '../../../src/features/chat/hooks/use-chat-scroll';
import { MessageSearchDialog } from '../../../src/features/chat/components/message-search-dialog';
import { useMessages } from '../../../src/features/messages/hooks/use-messages';
import type { VirtuosoHandle } from 'react-virtuoso';
import { getQueryClient } from './message-search-history-mock';

const THREAD_ID = '22222222-2222-4222-8222-222222222222';

function Harness() {
    const state = useMessages(THREAD_ID);
    const [searchOpen, setSearchOpen] = useState(true);
    const [jumpingId, setJumpingId] = useState<string | null>(null);
    const [pendingId, setPendingId] = useState<string | null>(null);
    const [highlightId, setHighlightId] = useState<string | null>(null);
    const [selectedId, setSelectedId] = useState<string | null>(null);
    const revision = useRef(0);
    const virtuosoRef = useRef<VirtuosoHandle | null>(null);
    const messages = useMemo(() => (state.messages ?? []).map(message => ({
        id: message.id,
        role: message.role,
        content: message.content,
        attachments: message.attachments,
        reasoning: message.reasoning,
        model_id: message.model_id,
    })), [state.messages]);
    const scroll = useChatScroll({
        chatId: THREAD_ID,
        messagesReady: state.messages !== null,
        messageCount: messages.length,
        virtuosoRef,
    });

    const closeSearch = useCallback(() => {
        revision.current += 1;
        setSearchOpen(false);
        setJumpingId(null);
        setPendingId(null);
    }, []);
    const openSearch = useCallback(() => setSearchOpen(true), []);
    const selectMessage = useCallback(async (id: string) => {
        const request = ++revision.current;
        setSelectedId(id);
        setJumpingId(id);
        const found = await state.loadMessagesThroughMessage(id, () => revision.current === request);
        if (revision.current !== request) return;
        if (found) setPendingId(id);
        setJumpingId(null);
    }, [state.loadMessagesThroughMessage]);

    const messageScrolled = useCallback((id: string) => {
        setHighlightId(id);
        setPendingId(null);
        closeSearch();
    }, [closeSearch]);

    useLayoutEffect(() => {
        window.messageSearchHarness = {
            snapshot: { ids: messages.map(message => message.id), selectedId, loadingOlder: state.isLoadingOlder },
            openSearch,
            closeSearch,
            scrollToBottom: scroll.scrollToBottom,
        };
    }, [closeSearch, messages, openSearch, scroll.scrollToBottom, selectedId, state.isLoadingOlder]);

    return <>
        <div style={{ height: 480, width: 760 }}>
            <ChatMessageList
                messages={messages}
                model="test-model"
                isLoading={false}
                isThinking={false}
                shouldAutoFollow={false}
                virtuosoRef={virtuosoRef}
                setIsAtBottom={scroll.handleAtBottomStateChange}
                onEdit={() => undefined}
                onRetry={() => undefined}
                onBranch={() => undefined}
                hasOlderMessages={state.hasOlderMessages}
                isLoadingOlder={state.isLoadingOlder}
                olderMessagesError={state.olderMessagesError}
                onLoadOlder={() => void state.loadOlderMessages()}
                highlightedMessageId={highlightId}
                scrollToMessageId={pendingId}
                onMessageScrolled={messageScrolled}
            />
        </div>
        <MessageSearchDialog
            threadId={THREAD_ID}
            open={searchOpen}
            onOpenChange={open => { if (open) openSearch(); else closeSearch(); }}
            onSelectMessage={id => { void selectMessage(id); }}
            jumpingMessageId={jumpingId}
        />
        <output aria-label="Selected message">{selectedId ?? 'none'}</output>
    </>;
}

createRoot(document.getElementById('root')!).render(
    <QueryClientProvider client={getQueryClient()}><Harness /></QueryClientProvider>,
);
