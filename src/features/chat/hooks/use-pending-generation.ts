'use client';

import { useEffect, useLayoutEffect, useRef } from 'react';
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
    showToast: (message: string, type?: 'success' | 'error' | 'info') => void;
    applyPendingReasoningEffort: (effort: ReasoningEffort) => void;
    generateResponse: (
        currentMessages: ChatViewMessage[],
        forcedModelId?: string,
        forcedSystemPrompt?: string,
        generationJobClaimToken?: string
    ) => Promise<boolean>;
}

export function usePendingGeneration({
    chatId,
    messages,
    messagesReady,
    isLoading,
    isThinking,
    lastRequestFailed,
    showToast,
    applyPendingReasoningEffort,
    generateResponse,
}: UsePendingGenerationParams) {
    const inFlightRef = useRef<{ chatId: string; messageId: string } | null>(null);
    const activeChatIdRef = useRef<string | null>(chatId);

    useLayoutEffect(() => {
        activeChatIdRef.current = chatId;
        return () => { activeChatIdRef.current = null; };
    }, [chatId]);

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
        if (!lastMessage || lastMessage.role !== 'user') {
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
                    if (activeChatIdRef.current === chatId && inFlightRef.current === run) {
                        showToast('Could not start the response. Refresh this chat to retry.', 'error');
                    }
                    return null;
                }
            })();

            if (!claimedJob) return;

            if (activeChatIdRef.current !== chatId || inFlightRef.current !== run) {
                // The claim token fences this release from any later claimant.
                await completeGenerationJob(
                    claimedJob.id,
                    claimedJob.claimToken,
                    'failed',
                    'Chat changed before generation started',
                );
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
                    forcedSystemPrompt,
                    claimedJob.claimToken,
                );
            } catch (error) {
                console.error('Failed during pending generation:', error);
                succeeded = false;
            }

            // The database rejects stale claim tokens, so completion is safe to
            // persist even when the user navigated away while generation ran.
            await completeGenerationJob(
                claimedJob.id,
                claimedJob.claimToken,
                succeeded ? 'completed' : 'failed',
                succeeded ? undefined : 'Generation did not complete'
            );
        })()
            .catch((error) => {
                console.error('Failed to finish pending generation job:', error);
            })
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
        showToast,
        applyPendingReasoningEffort,
    ]);
}
