import type { PreparedChatMessage } from '@/shared/contracts/chat';
import type { ModelConfig } from '@/shared/core/constants';
import type { ReasoningEffort } from '@/shared/core/types';

export type LimitsSource = 'google' | 'fallback';

export interface ResolvedModelLimits {
    contextWindowTokens: number;
    maxOutputTokens: number | null;
    source: LimitsSource;
}

export interface RequestTokenEstimates {
    estimatedInputTokens?: number;
    estimatedInputTokensWithSystemPrompt?: number;
}

export interface ProviderGetStreamParams {
    model: string;
    messages: PreparedChatMessage[];
    reasoningEffort: ReasoningEffort;
    modelConfig: ModelConfig;
    maxOutputTokens?: number | null;
    systemPrompt?: string;
    useSearch?: boolean;
    tokenEstimates?: RequestTokenEstimates;
    signal?: AbortSignal;
}

export interface ProviderResolveLimitsParams {
    model: string;
    signal?: AbortSignal;
}

export interface ChatProvider {
    id: string;
    getStream: (params: ProviderGetStreamParams) => Promise<ReadableStream>;
    resolveModelLimits: (params: ProviderResolveLimitsParams) => Promise<ResolvedModelLimits | null>;
}
