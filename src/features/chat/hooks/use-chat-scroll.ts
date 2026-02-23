'use client';

import { useCallback, useEffect, useRef, useState, type MutableRefObject } from 'react';
import { type VirtuosoHandle } from 'react-virtuoso';

import { scheduleFrame } from '@/shared/lib/animation-frame';

interface UseChatScrollParams {
    chatId: string;
    messagesReady: boolean;
    messageCount: number;
    virtuosoRef: MutableRefObject<VirtuosoHandle | null>;
}

export function useChatScroll({ chatId, messagesReady, messageCount, virtuosoRef }: UseChatScrollParams) {
    const [isAtBottom, setIsAtBottom] = useState(true);
    const initialBottomScrollChatIdRef = useRef<string | null>(null);
    const prevChatIdRef = useRef<string | null>(null);

    useEffect(() => {
        if (prevChatIdRef.current !== chatId) {
            initialBottomScrollChatIdRef.current = null;
            prevChatIdRef.current = chatId;
        }
    }, [chatId]);

    const scrollToBottom = useCallback(() => {
        if (virtuosoRef.current) {
            virtuosoRef.current.scrollToIndex({ index: messageCount - 1, align: 'end', behavior: 'smooth' });
            setIsAtBottom(true);
        }
    }, [messageCount, virtuosoRef]);

    // Scroll to bottom exactly once when a thread finishes initial message sync.
    useEffect(() => {
        if (!messagesReady || messageCount === 0) {
            return;
        }
        if (initialBottomScrollChatIdRef.current === chatId) {
            return;
        }

        initialBottomScrollChatIdRef.current = chatId;
        scheduleFrame(() => {
            scheduleFrame(() => {
                virtuosoRef.current?.scrollToIndex({ index: messageCount - 1, align: 'end' });
            });
        });
    }, [chatId, messagesReady, messageCount, virtuosoRef]);

    const handleAtBottomStateChange = useCallback((nextIsAtBottom: boolean) => {
        setIsAtBottom((prev) => (prev === nextIsAtBottom ? prev : nextIsAtBottom));
    }, []);

    return {
        isAtBottom,
        setIsAtBottom,
        scrollToBottom,
        handleAtBottomStateChange,
    };
}
