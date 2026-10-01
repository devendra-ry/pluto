'use client';

import {
    createContext,
    useCallback,
    useContext,
    useEffect,
    useSyncExternalStore,
    type ReactNode,
} from 'react';

import type { ChatResponseStats } from '@/shared/core/types';
import { areStatsEqual } from '../lib/chat-stream-state';

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
    private readonly completed = new Set<string>();

    subscribe(messageId: string, listener: () => void) {
        const listeners = this.listeners.get(messageId) ?? new Set<() => void>();
        listeners.add(listener);
        this.listeners.set(messageId, listeners);
        return () => {
            listeners.delete(listener);
            if (listeners.size === 0) {
                this.listeners.delete(messageId);
                if (this.completed.has(messageId)) this.clear(messageId);
            }
        };
    }

    getSnapshot(messageId: string) {
        return this.snapshots.get(messageId) ?? EMPTY_SNAPSHOT;
    }

    publish(messageId: string, snapshot: StreamedMessageSnapshot) {
        const previous = this.snapshots.get(messageId);
        if (previous?.content === snapshot.content && previous.reasoning === snapshot.reasoning
            && areStatsEqual(previous.stats, snapshot.stats)) return;
        this.completed.delete(messageId);
        this.snapshots.set(messageId, snapshot);
        this.listeners.get(messageId)?.forEach((listener) => listener());
    }

    clear(messageId: string) {
        this.completed.delete(messageId);
        if (!this.snapshots.delete(messageId)) return;
        this.listeners.get(messageId)?.forEach((listener) => listener());
    }

    /** Keep the final visible snapshot until React commits the message props. */
    complete(messageId: string) {
        this.completed.add(messageId);
        if (!this.listeners.has(messageId)) this.clear(messageId);
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

export function useStreamedMessageSelector<T>(messageId: string, selector: (snapshot: StreamedMessageSnapshot) => T): T {
    const store = useContext(ChatStreamMessageStoreContext);
    const subscribe = useCallback((listener: () => void) => {
        if (!store) return () => {};
        let previous = selector(store.getSnapshot(messageId));
        return store.subscribe(messageId, () => {
            const next = selector(store.getSnapshot(messageId));
            if (Object.is(previous, next)) return;
            previous = next;
            listener();
        });
    }, [store, messageId, selector]);
    const getSnapshot = useCallback(() => selector(store?.getSnapshot(messageId) ?? EMPTY_SNAPSHOT), [store, messageId, selector]);
    return useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
}

export function useClearCommittedStream(messageId: string, isStreaming: boolean | undefined, content: string, reasoning: string | undefined) {
    const store = useContext(ChatStreamMessageStoreContext);
    useEffect(() => {
        if (!store || isStreaming) return;
        const snapshot = store.getSnapshot(messageId);
        if (snapshot.content === content && snapshot.reasoning === (reasoning ?? '')) store.clear(messageId);
    }, [store, messageId, isStreaming, content, reasoning]);
}
