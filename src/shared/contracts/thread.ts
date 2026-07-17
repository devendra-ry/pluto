import type { ReasoningEffort } from '@/shared/core/types';

export interface Thread {
    id: string;
    title: string;
    model: string;
    reasoning_effort?: ReasoningEffort;
    system_prompt?: string | null;
    is_pinned?: boolean;
    created_at: string;
    updated_at: string;
    user_id?: string;
}
