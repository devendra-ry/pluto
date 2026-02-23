import type { PreparedChatMessage } from '@/features/chat/lib/chat-attachments';
import type { ModelConfig } from '@/lib/constants';
import type { ReasoningEffort } from '@/lib/types';

export type LimitsSource = 'google' | 'openrouter' | 'chutes' | 'fallback';

export interface ResolvedModelLimits {
    contextWindowTokens: number;
    maxOutputTokens: number | null;
    source: LimitsSource;
}

export interface RequestTokenEstimates {
    estimatedInputTokens?: number;
    estimatedInputTokensWithSystemPrompt?: number;
}

export interface ProviderBuildMessagesParams {
    messages: PreparedChatMessage[];
    systemPrompt?: string;
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
    id: 'google' | 'openrouter' | 'chutes';
    buildMessages: (params: ProviderBuildMessagesParams) => unknown;
    getStream: (params: ProviderGetStreamParams) => Promise<ReadableStream>;
    resolveModelLimits: (params: ProviderResolveLimitsParams) => Promise<ResolvedModelLimits | null>;
}
