'use client';

import { useEffect, useRef } from 'react';
import { claimPendingGenerationJob, completeGenerationJob } from './use-generation-jobs';
import type { ChatViewMessage } from '@/shared/contracts/chat';
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
    const inFlightRef = useRef<{ chatId: string; messageId: string } | null>(null);

    useEffect(() => {
        // React Strict Mode re-runs effects on mount. Keep the same claim
        // across that replay so a second claim cannot steal the job.
        if (inFlightRef.current?.chatId === chatId) {
            return;
        }
        if (inFlightRef.current) inFlightRef.current = null;
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

        const run = { chatId, messageId: lastMessage.id };
        inFlightRef.current = run;

        void (async () => {
            const claimedJob = await (async () => {
                try {
                    return await claimPendingGenerationJob(chatId, lastMessage.id);
                } catch (error) {
                    console.error('Failed to claim generation job:', error);
                    return null;
                }
            })();

            if (inFlightRef.current !== run || !claimedJob) {
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

            if (inFlightRef.current !== run) {
                return;
            }

            await completeGenerationJob(
                claimedJob.id,
                succeeded ? 'completed' : 'failed',
                succeeded ? undefined : 'Generation did not complete'
            );
        })()
            .finally(() => {
                if (inFlightRef.current === run) {
                    inFlightRef.current = null;
                }
            });
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
