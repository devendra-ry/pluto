'use client';

import { useEffect, useRef } from 'react';
import { claimPendingGenerationJob, completeGenerationJob } from './use-generation-jobs';
import { type ChatViewMessage } from '../lib/chat-view';
import { type ReasoningEffort } from '@/shared/core/types';

interface UsePendingGenerationParams {
    chatId: string;
    messages: ChatViewMessage[];
    messagesReady: boolean;
    isLoading: boolean;
    isThinking: boolean;
    lastRequestFailed: boolean;
    applyPendingReasoningEffort: (effort: ReasoningEffort) => void;
    generateResponse: (
        currentMessages: ChatViewMessage[],
        forcedModelId?: string,
        forcedSystemPrompt?: string
    ) => Promise<boolean>;
}

export function usePendingGeneration({
    chatId,
    messages,
    messagesReady,
    isLoading,
    isThinking,
    lastRequestFailed,
    applyPendingReasoningEffort,
    generateResponse,
}: UsePendingGenerationParams) {
    const inFlightRef = useRef(false);

    useEffect(() => {
        if (inFlightRef.current) {
            return;
        }
        // Don't auto-retry if the last request failed or if canonical messages are still loading.
        if (lastRequestFailed || !messagesReady) {
            return;
        }
        if (messages.length === 0 || isLoading || isThinking) {
            return;
        }

        const lastMessage = messages[messages.length - 1];
        if (lastMessage.role !== 'user') {
            return;
        }

        let cancelled = false;
        inFlightRef.current = true;

        void (async () => {
            const claimedJob = await (async () => {
                try {
                    return await claimPendingGenerationJob(chatId, lastMessage.id);
                } catch (error) {
                    console.error('Failed to claim generation job:', error);
                    return null;
                }
            })();

            if (cancelled || !claimedJob) {
                return;
            }

            if (claimedJob.reasoningEffort) {
                applyPendingReasoningEffort(claimedJob.reasoningEffort);
            }
            let succeeded = false;
            try {
                const forcedModelId = claimedJob.modelId || lastMessage.model_id || undefined;
                const forcedSystemPrompt = claimedJob.systemPrompt || undefined;
                succeeded = await generateResponse(
                    messages,
                    forcedModelId,
                    forcedSystemPrompt
                );
            } catch (error) {
                console.error('Failed during pending generation:', error);
                succeeded = false;
            }

            if (cancelled) {
                return;
            }

            await completeGenerationJob(
                claimedJob.id,
                succeeded ? 'completed' : 'failed',
                succeeded ? undefined : 'Generation did not complete'
            );
        })()
            .finally(() => {
                inFlightRef.current = false;
            });

        return () => {
            cancelled = true;
        };
    }, [
        messages,
        messagesReady,
        isLoading,
        isThinking,
        generateResponse,
        chatId,
        lastRequestFailed,
        applyPendingReasoningEffort,
    ]);
}
