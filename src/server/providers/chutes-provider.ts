import { getChutesApiKey } from '@/server/providers/chutes';
import { buildOpenAICompatibleMessages, getChutesStream } from '@/server/providers/chat-streams';
import { logModelLimits, toPositiveInt } from '@/server/providers/limits-utils';
import type { ChatProvider } from '@/server/providers/provider-types';

export const chutesProvider: ChatProvider = {
    id: 'chutes',
    buildMessages: ({ messages, systemPrompt }) => buildOpenAICompatibleMessages(messages, systemPrompt),
    getStream: async ({
        model,
        messages,
        reasoningEffort,
        modelConfig,
        maxOutputTokens,
        systemPrompt,
        tokenEstimates,
        signal,
    }) => getChutesStream(
        model,
        messages,
        reasoningEffort,
        modelConfig,
        maxOutputTokens,
        systemPrompt,
        tokenEstimates,
        signal
    ),
    resolveModelLimits: async ({ model, signal }) => {
        const apiKey = getChutesApiKey();
        if (!apiKey) return null;

        const response = await fetch('https://llm.chutes.ai/v1/models', {
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

        const contextWindowTokens =
            toPositiveInt(modelEntry.context_length) ??
            toPositiveInt(modelEntry.max_prompt_tokens) ??
            toPositiveInt(modelEntry.input_token_limit);

        if (!contextWindowTokens) return null;

        const resolvedMaxOutput =
            toPositiveInt(modelEntry.max_completion_tokens) ??
            toPositiveInt(modelEntry.max_output_tokens) ??
            toPositiveInt(modelEntry.output_token_limit) ??
            toPositiveInt(modelEntry.max_output_length);
        logModelLimits('chutes-model-limits', {
            model,
            raw: {
                context_length: modelEntry.context_length,
                max_prompt_tokens: modelEntry.max_prompt_tokens,
                input_token_limit: modelEntry.input_token_limit,
                max_completion_tokens: modelEntry.max_completion_tokens,
                max_output_tokens: modelEntry.max_output_tokens,
                output_token_limit: modelEntry.output_token_limit,
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
            source: 'chutes',
        };
    },
};