'use client';

import { createClient } from '@/shared/lib/supabase/client';
import { toReasoningEffort, type Attachment, type ReasoningEffort } from '@/shared/core/types';
import type { Json } from '@/shared/lib/supabase/database.types';

type JobStatus = 'completed' | 'failed';

export interface StartChatWithMessageInput {
    threadId?: string | null;
    content: string;
    modelId: string;
    reasoningEffort: ReasoningEffort;
    systemPrompt: string | null;
    attachments: Attachment[];
}

export interface StartedChat {
    threadId: string;
    userMessageId: string;
}

export async function startChatWithMessage(input: StartChatWithMessageInput): Promise<StartedChat> {
    const supabase = createClient();
    const attachments = JSON.parse(JSON.stringify(input.attachments)) as Json;
    const { data, error } = await supabase.rpc('start_chat_with_message', {
        p_thread_id: input.threadId ?? null,
        p_content: input.content,
        p_model: input.modelId,
        p_reasoning_effort: input.reasoningEffort,
        p_system_prompt: input.systemPrompt,
        p_attachments: attachments,
    });

    if (error) {
        throw new Error(`Failed to start chat (${error.message}). Apply the Supabase migrations and retry.`);
    }

    const startedChat = data?.[0];
    if (!startedChat || !startedChat.thread_id || !startedChat.user_message_id) {
        throw new Error('The chat could not be started. Please try again.');
    }

    return {
        threadId: startedChat.thread_id,
        userMessageId: startedChat.user_message_id,
    };
}

export interface ClaimedGenerationJob {
    id: string;
    userMessageId: string;
    modelId: string | null;
    reasoningEffort: ReasoningEffort | null;
    systemPrompt: string | null;
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
