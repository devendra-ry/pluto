'use client';

import { type ChatSubmitMode } from '@/features/chat/components/chat-input';
import { createClient } from '@/utils/supabase/client';

import { type ReasoningEffort } from '@/lib/types';

type JobStatus = 'completed' | 'failed';

function toReasoningEffort(value: unknown): ReasoningEffort | null {
    if (value === 'low' || value === 'medium' || value === 'high') {
        return value;
    }
    return null;
}

function toSubmitMode(value: unknown): ChatSubmitMode | null {
    if (value === 'chat' || value === 'image' || value === 'image-edit' || value === 'video' || value === 'search') {
        return value;
    }
    return null;
}

export interface EnqueueGenerationJobInput {
    threadId: string;
    userMessageId: string;
    mode: ChatSubmitMode;
    modelId?: string | null;
    useSearch?: boolean;
    reasoningEffort?: ReasoningEffort | null;
    systemPrompt?: string | null;
}

export interface ClaimedGenerationJob {
    id: string;
    userMessageId: string;
    mode: ChatSubmitMode;
    modelId: string | null;
    useSearch: boolean;
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
            mode: input.mode,
            model_id: input.modelId ?? null,
            use_search: Boolean(input.useSearch),
            reasoning_effort: input.reasoningEffort ?? null,
            system_prompt: input.systemPrompt ?? null,
            status: 'pending',
        });

    if (error) {
        throw new Error(`Failed to enqueue generation job (${error.message}). Run db/migration-generation-jobs.sql and retry.`);
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
        throw new Error(`Failed to claim generation job (${error.message}). Run db/migration-generation-jobs.sql and retry.`);
    }

    const row = Array.isArray(data) ? data[0] : null;
    if (!row || typeof row !== 'object') {
        return null;
    }

    const record = row as Record<string, unknown>;
    const id = typeof record.id === 'string' ? record.id : null;
    const claimedUserMessageId = typeof record.user_message_id === 'string' ? record.user_message_id : null;
    const mode = toSubmitMode(record.mode);

    if (!id || !claimedUserMessageId || !mode) {
        return null;
    }

    return {
        id,
        userMessageId: claimedUserMessageId,
        mode,
        modelId: typeof record.model_id === 'string' ? record.model_id : null,
        useSearch: record.use_search === true,
        reasoningEffort: toReasoningEffort(record.reasoning_effort),
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
