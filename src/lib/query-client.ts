'use client';

import { QueryClient } from '@tanstack/react-query';

export const MESSAGE_QUERY_KEY_PREFIX = 'messages';

export function getMessagesQueryKey(threadId: string) {
    return [MESSAGE_QUERY_KEY_PREFIX, threadId] as const;
}

function createQueryClient() {
    return new QueryClient({
        defaultOptions: {
            queries: {
                staleTime: 15_000,
                gcTime: 10 * 60_000,
                retry: 1,
                refetchOnWindowFocus: false,
            },
        },
    });
}

let browserQueryClient: QueryClient | undefined;

export function getQueryClient() {
    if (!browserQueryClient) {
        browserQueryClient = createQueryClient();
    }
    return browserQueryClient;
}
