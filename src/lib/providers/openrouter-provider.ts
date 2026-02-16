import { buildOpenAICompatibleMessages, getOpenRouterStream } from '@/lib/providers/chat-streams';
import { serverEnv } from '@/lib/env/server';
import { logModelLimits, toPositiveInt } from '@/lib/providers/limits-utils';
import type { ChatProvider } from '@/lib/providers/provider-types';

export const openRouterProvider: ChatProvider = {
    id: 'openrouter',
    buildMessages: ({ messages, systemPrompt }) => buildOpenAICompatibleMessages(messages, systemPrompt),
    getStream: async ({
        model,
        messages,
        reasoningEffort,
        maxOutputTokens,
        systemPrompt,
        tokenEstimates,
        signal,
    }) => getOpenRouterStream(
        model,
        messages,
        reasoningEffort,
        maxOutputTokens,
        systemPrompt,
        tokenEstimates,
        signal
    ),
    resolveModelLimits: async ({ model, signal }) => {
        const apiKey = serverEnv.OPENROUTER_API_KEY;
        if (!apiKey) return null;

        const response = await fetch('https://openrouter.ai/api/v1/models', {
            method: 'GET',
            headers: {
                'Authorization': `Bearer ${apiKey}`,
            },
            signal,
        });

        if (!response.ok) return null;

        const payload = await response.json() as Record<string, unknown>;
        const data = payload.data;
        if (!Array.isArray(data)) return null;

        const modelEntry = data.find((item) => {
            if (!item || typeof item !== 'object') return false;
            const record = item as Record<string, unknown>;
            return record.id === model;
        }) as Record<string, unknown> | undefined;

        if (!modelEntry) return null;

        const topProvider = (modelEntry.top_provider && typeof modelEntry.top_provider === 'object')
            ? modelEntry.top_provider as Record<string, unknown>
            : null;

        const contextWindowTokens =
            toPositiveInt(modelEntry.context_length) ??
            toPositiveInt(topProvider?.context_length);

        if (!contextWindowTokens) return null;

        const resolvedMaxOutput =
            toPositiveInt(topProvider?.max_completion_tokens) ??
            toPositiveInt(modelEntry.max_completion_tokens) ??
            toPositiveInt(modelEntry.max_output_length);
        logModelLimits('openrouter-model-limits', {
            model,
            raw: {
                context_length: modelEntry.context_length,
                top_provider_context_length: topProvider?.context_length,
                max_completion_tokens: modelEntry.max_completion_tokens,
                top_provider_max_completion_tokens: topProvider?.max_completion_tokens,
                max_output_length: modelEntry.max_output_length,
            },
            resolved: {
                contextWindowTokens,
                maxOutputTokens: resolvedMaxOutput,
            },
        });

        return {
            contextWindowTokens,
            maxOutputTokens: resolvedMaxOutput,
            source: 'openrouter',
        };
    },
};
