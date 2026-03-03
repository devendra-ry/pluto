import type { PreparedChatMessage } from '@/features/chat/server';
import type { ModelConfig } from '@/shared/core/constants';
import type { ReasoningEffort } from '@/shared/core/types';

export type LimitsSource = 'google' | 'openrouter' | 'chutes' | 'ollama' | 'fallback';

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
    id: 'google' | 'openrouter' | 'chutes' | 'ollama';
    /**
     * Whether the provider's stream may contain `<think>` tags that need to be
     * parsed and transformed into `reasoning_content` fields. Providers that
     * natively separate thoughts from content (e.g. Google) can set this to
     * `false` to skip the transform layer entirely, avoiding a redundant
     * JSON parse/stringify round-trip.
     */
    needsThinkTagTransform: boolean;
    getStream: (params: ProviderGetStreamParams) => Promise<ReadableStream>;
    resolveModelLimits: (params: ProviderResolveLimitsParams) => Promise<ResolvedModelLimits | null>;
}
