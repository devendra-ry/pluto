import { useEffect, useMemo } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { createClient } from '@/utils/supabase/client';
import { getMessagesQueryKey } from '@/shared/lib/query-client';
import {
    type Message,
    mergeMessagesSorted,
    removeMessagesById,
    toMessage
} from '@/features/messages/lib/message-helpers';

export function useMessageSubscription(threadId: string | null) {
    const queryClient = useQueryClient();
    const supabase = useMemo(() => createClient(), []);

    useEffect(() => {
        if (!threadId) {
            return;
        }

        const queryKey = getMessagesQueryKey(threadId);
        let isActive = true;
        let channel: ReturnType<ReturnType<typeof createClient>['channel']> | null = null;

        const applyRealtimePayload = (payload: {
            eventType: 'INSERT' | 'UPDATE' | 'DELETE';
            new: unknown;
            old: unknown;
        }) => {
            queryClient.setQueryData<Message[]>(queryKey, (previous) => {
                const existing = previous ?? [];

                if (payload.eventType === 'DELETE') {
                    const deletedId =
                        payload.old && typeof payload.old === 'object' && typeof (payload.old as { id?: unknown }).id === 'string'
                            ? (payload.old as { id: string }).id
                            : null;
                    if (!deletedId) return existing;
                    return removeMessagesById(existing, new Set([deletedId]));
                }

                const nextMessage = toMessage(payload.new);
                if (!nextMessage || nextMessage.thread_id !== threadId) {
                    return existing;
                }

                if (nextMessage.deleted_at) {
                    return removeMessagesById(existing, new Set([nextMessage.id]));
                }

                return mergeMessagesSorted(existing, [nextMessage]);
            });
        };

        const unsubscribeRealtime = () => {
            if (channel) {
                supabase.removeChannel(channel);
                channel = null;
            }
        };

        const subscribeRealtime = () => {
            if (!isActive || channel) {
                return;
            }

            channel = supabase
                .channel(`messages_${threadId}`)
                .on('postgres_changes', {
                    event: '*',
                    schema: 'public',
                    table: 'messages',
                    filter: `thread_id=eq.${threadId}`
                }, (payload) => {
                    if (!isActive) return;
                    if (payload.eventType !== 'INSERT' && payload.eventType !== 'UPDATE' && payload.eventType !== 'DELETE') {
                        return;
                    }
                    applyRealtimePayload({
                        eventType: payload.eventType,
                        new: payload.new,
                        old: payload.old,
                    });
                })
                .subscribe();
        };

        subscribeRealtime();

        const handleVisibilityChange = () => {
            if (!isActive) return;
            if (document.visibilityState === 'visible') {
                void queryClient.invalidateQueries({ queryKey });
            }
        };

        if (typeof document !== 'undefined') {
            document.addEventListener('visibilitychange', handleVisibilityChange);
        }

        return () => {
            isActive = false;
            if (typeof document !== 'undefined') {
                document.removeEventListener('visibilitychange', handleVisibilityChange);
            }
            unsubscribeRealtime();
        };
    }, [queryClient, supabase, threadId]);
}