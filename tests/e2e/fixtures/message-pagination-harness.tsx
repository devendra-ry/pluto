import { createRoot } from 'react-dom/client';
import { useLayoutEffect, useMemo, useRef } from 'react';
import { QueryClientProvider } from '@tanstack/react-query';
import { ChatMessageList } from '../../../src/features/chat/components/chat-message-list';
import { useMessages } from '../../../src/features/messages/hooks/use-messages';
import { useChatScroll } from '../../../src/features/chat/hooks/use-chat-scroll';
import type { VirtuosoHandle } from 'react-virtuoso';
import { getQueryClient } from './message-pagination-supabase-mock';

declare global {
    interface Window {
        messagePaginationHarness: {
            loadOlder: () => Promise<void>;
            retryOlder: () => Promise<void>;
            scrollToIndex: (index: number) => void;
            snapshot: {
                ids: string[];
                hasOlder: boolean | undefined;
                loadingOlder: boolean;
                olderError: string | null;
                syncStatus: string;
            };
        };
    }
}

const THREAD_ID = '22222222-2222-4222-8222-222222222222';

function Harness() {
    const state = useMessages(THREAD_ID);
    const virtuosoRef = useRef<VirtuosoHandle | null>(null);
    const messages = useMemo(() => (state.messages ?? []).map((message) => ({
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
    useLayoutEffect(() => {
        window.messagePaginationHarness = {
            loadOlder: state.loadOlderMessages,
            retryOlder: state.loadOlderMessages,
            scrollToIndex: (index) => virtuosoRef.current?.scrollToIndex({ index, align: 'start' }),
            snapshot: {
                ids: messages.map((message) => message.id),
                hasOlder: state.hasOlderMessages,
                loadingOlder: state.isLoadingOlder,
                olderError: state.olderMessagesError,
                syncStatus: state.syncStatus,
            },
        };
    }, [state.loadOlderMessages, state.hasOlderMessages, state.isLoadingOlder, state.olderMessagesError, state.syncStatus, messages]);

    return <div style={{ height: 360, width: 720 }}>
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
        />
    </div>;
}

createRoot(document.getElementById('root')!).render(
    <QueryClientProvider client={getQueryClient()}><Harness /></QueryClientProvider>,
);
