'use client';

import { createClient } from '@/shared/lib/supabase/client';

import { toReasoningEffort, type ReasoningEffort } from '@/shared/core/types';

type JobStatus = 'completed' | 'failed';

export interface EnqueueGenerationJobInput {
    threadId: string;
    userMessageId: string;
    modelId?: string | null;
    reasoningEffort?: ReasoningEffort | null;
    systemPrompt?: string | null;
}

export interface ClaimedGenerationJob {
    id: string;
    userMessageId: string;
    modelId: string | null;
    reasoningEffort: ReasoningEffort | null;
    systemPrompt: string | null;
}

export async function enqueueGenerationJob(input: EnqueueGenerationJobInput): Promise<void> {
    const supabase = createClient();

    const { error } = await supabase
        .from('generation_jobs')
        .insert({
            thread_id: input.threadId,
            user_message_id: input.userMessageId,
            model_id: input.modelId ?? null,
            reasoning_effort: input.reasoningEffort ?? null,
            system_prompt: input.systemPrompt ?? null,
            status: 'pending',
        });

    if (error) {
        throw new Error(`Failed to enqueue generation job (${error.message}). Apply the Supabase migrations and retry.`);
    }
}

export async function claimPendingGenerationJob(threadId: string, userMessageId?: string): Promise<ClaimedGenerationJob | null> {
    const supabase = createClient();

    const { data, error } = await supabase.rpc('claim_pending_generation_job', {
        p_thread_id: threadId,
        p_user_message_id: userMessageId,
        p_lease_seconds: 180,
    });

    if (error) {
        throw new Error(`Failed to claim generation job (${error.message}). Apply the Supabase migrations and retry.`);
    }

    const row = Array.isArray(data) ? data[0] : null;
    if (!row || typeof row !== 'object') {
        return null;
    }

    const record = row as Record<string, unknown>;
    const id = typeof record.id === 'string' ? record.id : null;
    const claimedUserMessageId = typeof record.user_message_id === 'string' ? record.user_message_id : null;
    if (!id || !claimedUserMessageId) {
        return null;
    }

    return {
        id,
        userMessageId: claimedUserMessageId,
        modelId: typeof record.model_id === 'string' ? record.model_id : null,
        reasoningEffort: toReasoningEffort(record.reasoning_effort) ?? null,
        systemPrompt: typeof record.system_prompt === 'string' ? record.system_prompt : null,
    };
}

export async function completeGenerationJob(
    jobId: string,
    status: JobStatus,
    errorMessage?: string
): Promise<void> {
    const supabase = createClient();

    const { error } = await supabase.rpc('complete_generation_job', {
        p_job_id: jobId,
        p_status: status,
        p_error: errorMessage,
    });

    if (error && process.env.NODE_ENV !== 'production') {
        console.warn('[generation_jobs] failed to mark job complete', { jobId, status, error: error.message });
    }
}
