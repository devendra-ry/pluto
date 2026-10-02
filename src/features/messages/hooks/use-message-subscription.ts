'use client';

import { useEffect, useMemo, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { createClient } from '@/shared/lib/supabase/client';
import { getMessagesQueryKey } from '@/shared/lib/query-client';
import {
    mergeMessagesSorted,
    removeMessagesById,
    toMessage
} from '../lib/message-helpers';
import { canonicalMessageAttachments } from '../lib/load-thread-messages';
import { updateMessagePages, type MessagePages } from '../lib/message-pages';

type SyncStatus = 'connecting' | 'connected' | 'reconnecting' | 'offline';

export function useMessageSubscription(threadId: string | null) {
    const queryClient = useQueryClient();
    const supabase = useMemo(() => createClient(), []);
    const [connection, setConnection] = useState<{ threadId: string | null; status: SyncStatus }>({ threadId: null, status: 'connecting' });

    useEffect(() => {
        if (!threadId) {
            return;
        }

        const queryKey = getMessagesQueryKey(threadId);
        let isActive = true;
        let channel: ReturnType<ReturnType<typeof createClient>['channel']> | null = null;
        let subscribed = false;
        let channelHealthy = false;
        let needsReconcile = false;
        let refreshTimer: ReturnType<typeof setTimeout> | null = null;
        let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
        let reconnectDelay = 1_000;
        const setStatus = (status: SyncStatus) => { if (isActive) setConnection({ threadId, status }); };
        const reconcile = () => {
            if (!isActive || refreshTimer || !navigator.onLine) return;
            refreshTimer = setTimeout(() => {
                refreshTimer = null;
                if (!isActive) return;
                void queryClient.invalidateQueries({ queryKey }, { throwOnError: true }).then(() => {
                    if (!isActive || !navigator.onLine) return;
                    needsReconcile = false;
                    setStatus(channelHealthy ? 'connected' : 'reconnecting');
                }).catch(() => {
                    needsReconcile = true;
                    setStatus(navigator.onLine ? (channelHealthy ? 'connected' : 'reconnecting') : 'offline');
                });
            }, 100);
        };

        const applyRealtimePayload = (payload: {
            eventType: 'INSERT' | 'UPDATE' | 'DELETE';
            new: unknown;
            old: unknown;
        }) => {
            queryClient.setQueryData<MessagePages>(queryKey, previous => updateMessagePages(previous, existing => {

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

                return mergeMessagesSorted(existing, [canonicalMessageAttachments(nextMessage)]);
            }));
            // Restart an overlapping read so its older snapshot cannot erase
            // the realtime event (including a deletion) just applied above.
            if (queryClient.getQueryState(queryKey)?.fetchStatus === 'fetching') reconcile();
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

            const subscribingChannel = supabase
                .channel(`messages_${threadId}`)
                .on('postgres_changes', {
                    event: '*',
                    schema: 'public',
                    table: 'messages',
                    filter: `thread_id=eq.${threadId}`
                }, (payload) => {
                    if (!isActive || channel !== subscribingChannel) return;
                    if (payload.eventType !== 'INSERT' && payload.eventType !== 'UPDATE' && payload.eventType !== 'DELETE') {
                        return;
                    }
                    applyRealtimePayload({
                        eventType: payload.eventType,
                        new: payload.new,
                        old: payload.old,
                    });
                });
            channel = subscribingChannel;
            subscribingChannel.subscribe(status => {
                    if (!isActive || channel !== subscribingChannel) return;
                    if (status === 'SUBSCRIBED') {
                        channelHealthy = true;
                        reconnectDelay = 1_000;
                        setStatus(navigator.onLine ? 'connected' : 'offline');
                        if (subscribed || needsReconcile) reconcile();
                        subscribed = true;
                        needsReconcile = false;
                    } else if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT' || status === 'CLOSED') {
                        channelHealthy = false;
                        needsReconcile = true;
                        setStatus(navigator.onLine ? 'reconnecting' : 'offline');
                        if (status === 'CLOSED') {
                            // The SDK removes closed channels from its socket;
                            // unlike errored channels they cannot rejoin themselves.
                            channel = null;
                            reconnectTimer = setTimeout(() => {
                                reconnectTimer = null;
                                if (isActive && navigator.onLine) subscribeRealtime();
                            }, reconnectDelay);
                            reconnectDelay = Math.min(reconnectDelay * 2, 30_000);
                        }
                    }
                });
        };

        subscribeRealtime();
        const handleOffline = () => { needsReconcile = true; setStatus('offline'); };
        const handleOnline = () => {
            setStatus('reconnecting');
            if (reconnectTimer) clearTimeout(reconnectTimer);
            reconnectTimer = null;
            if (!channel) subscribeRealtime();
            reconcile();
        };
        if (!navigator.onLine) handleOffline();
        window.addEventListener('offline', handleOffline);
        window.addEventListener('online', handleOnline);

        const handleVisibilityChange = () => {
            if (!isActive) return;
            if (document.visibilityState === 'visible') {
                reconcile();
            }
        };

        if (typeof document !== 'undefined') {
            document.addEventListener('visibilitychange', handleVisibilityChange);
        }

        return () => {
            isActive = false;
            if (refreshTimer) clearTimeout(refreshTimer);
            if (reconnectTimer) clearTimeout(reconnectTimer);
            window.removeEventListener('offline', handleOffline);
            window.removeEventListener('online', handleOnline);
            if (typeof document !== 'undefined') {
                document.removeEventListener('visibilitychange', handleVisibilityChange);
            }
            unsubscribeRealtime();
        };
    }, [queryClient, supabase, threadId]);
    return connection.threadId === threadId ? connection.status : 'connecting';
}
