import { cookies } from 'next/headers';
import { dehydrate, HydrationBoundary, QueryClient } from '@tanstack/react-query';

import { ChatPageClient } from './chat-page-client';
import { loadThreadMessages } from '@/features/messages/server';
import { mapThreadRowToThread, THREAD_SELECT_COLUMNS } from '@/features/threads';
import type { Thread } from '@/shared/contracts/thread';
import { createClient } from '@/shared/lib/supabase/server';
import { getMessagesQueryKey } from '@/shared/lib/query-keys';

interface PageProps {
    params: Promise<{ chatId: string }>;
}

export default async function ChatPage({ params }: PageProps) {
    const { chatId } = await params;
    const cookieStore = await cookies();
    const supabase = createClient(cookieStore);

    // Prefetch thread + messages on the server so the first client render
    // already has data — no post-hydration fetch waterfall.
    const queryClient = new QueryClient({
        defaultOptions: {
            queries: {
                staleTime: 15_000,
                retry: 1,
                refetchOnWindowFocus: false,
            },
        },
    });

    let initialThread: Thread | undefined;
    await Promise.all([
        Promise.resolve(
            supabase
                .from('threads')
                .select(THREAD_SELECT_COLUMNS)
                .eq('id', chatId)
                .single()
                .then(({ data }) => {
                    initialThread = data ? mapThreadRowToThread(data) : undefined;
                })
        ).catch(() => undefined),
        Promise.resolve(
            queryClient.prefetchQuery({
                queryKey: getMessagesQueryKey(chatId),
                queryFn: () => loadThreadMessages(supabase, chatId),
            })
        ).catch(() => undefined),
    ]);

    return (
        <HydrationBoundary state={dehydrate(queryClient)}>
            <ChatPageClient chatId={chatId} {...(initialThread ? { initialThread } : {})} />
        </HydrationBoundary>
    );
}
