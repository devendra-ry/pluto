'use client';

import {
    createContext,
    useCallback,
    useContext,
    useSyncExternalStore,
    type ReactNode,
} from 'react';

import type { ChatResponseStats } from '@/shared/core/types';

export interface StreamedMessageSnapshot {
    content: string;
    reasoning: string;
    stats?: ChatResponseStats;
}

const EMPTY_SNAPSHOT: StreamedMessageSnapshot = Object.freeze({
    content: '',
    reasoning: '',
});

export class ChatStreamMessageStore {
    private readonly snapshots = new Map<string, StreamedMessageSnapshot>();
    private readonly listeners = new Map<string, Set<() => void>>();

    subscribe(messageId: string, listener: () => void) {
        const listeners = this.listeners.get(messageId) ?? new Set<() => void>();
        listeners.add(listener);
        this.listeners.set(messageId, listeners);
        return () => {
            listeners.delete(listener);
            if (listeners.size === 0) this.listeners.delete(messageId);
        };
    }

    getSnapshot(messageId: string) {
        return this.snapshots.get(messageId) ?? EMPTY_SNAPSHOT;
    }

    publish(messageId: string, snapshot: StreamedMessageSnapshot) {
        this.snapshots.set(messageId, snapshot);
        this.listeners.get(messageId)?.forEach((listener) => listener());
    }

    clear(messageId: string) {
        if (!this.snapshots.delete(messageId)) return;
        this.listeners.get(messageId)?.forEach((listener) => listener());
    }
}

const ChatStreamMessageStoreContext = createContext<ChatStreamMessageStore | null>(null);

export function ChatStreamMessageStoreProvider({
    store,
    children,
}: {
    store: ChatStreamMessageStore;
    children: ReactNode;
}) {
    return (
        <ChatStreamMessageStoreContext.Provider value={store}>
            {children}
        </ChatStreamMessageStoreContext.Provider>
    );
}

export function useStreamedMessage(messageId: string): StreamedMessageSnapshot {
    const store = useContext(ChatStreamMessageStoreContext);
    const subscribe = useCallback(
        (listener: () => void) => store?.subscribe(messageId, listener) ?? (() => {}),
        [store, messageId]
    );
    const getSnapshot = useCallback(
        () => store?.getSnapshot(messageId) ?? EMPTY_SNAPSHOT,
        [store, messageId]
    );
    return useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
}
