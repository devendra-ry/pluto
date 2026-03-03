import { getOllamaStream } from '@/server/providers/chat-streams';
import { logModelLimits, toPositiveInt } from '@/server/providers/limits-utils';
import { serverEnv } from '@/shared/config/server';
import type { ChatProvider } from '@/server/providers/provider-types';

function normalizeOllamaBaseUrl(baseUrl: string) {
    const trimmed = baseUrl.trim();
    if (!trimmed) return 'https://ollama.com';
    return trimmed.replace(/\/+$/, '');
}

export const ollamaProvider: ChatProvider = {
    id: 'ollama',
    needsThinkTagTransform: false,
    getStream: async ({
        model,
        messages,
        reasoningEffort,
        maxOutputTokens,
        systemPrompt,
        tokenEstimates,
        signal,
    }) => getOllamaStream(
        model,
        messages,
        reasoningEffort,
        maxOutputTokens,
        systemPrompt,
        tokenEstimates,
        signal
    ),
    resolveModelLimits: async ({ model, signal }) => {
        const baseUrl = normalizeOllamaBaseUrl(serverEnv.OLLAMA_BASE_URL || 'https://ollama.com');
        const ollamaApiKey = serverEnv.OLLAMA_API_KEY;
        if (!ollamaApiKey) return null;
        const response = await fetch(`${baseUrl}/api/show`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                ...(ollamaApiKey ? { 'Authorization': `Bearer ${ollamaApiKey}` } : {}),
            },
            body: JSON.stringify({ model }),
            signal,
        });

        if (!response.ok) return null;

        const payload = await response.json() as Record<string, unknown>;
        const modelInfo = (payload.model_info && typeof payload.model_info === 'object')
            ? payload.model_info as Record<string, unknown>
            : null;
        const details = (payload.details && typeof payload.details === 'object')
            ? payload.details as Record<string, unknown>
            : null;

        const contextWindowTokens =
            toPositiveInt(payload.num_ctx) ??
            toPositiveInt(modelInfo?.['llama.context_length']) ??
            toPositiveInt(modelInfo?.['general.context_length']) ??
            toPositiveInt(details?.num_ctx);

        if (!contextWindowTokens) return null;

        const resolvedMaxOutput = toPositiveInt(payload.num_predict);

        logModelLimits('ollama-model-limits', {
            model,
            baseUrl,
            raw: {
                num_ctx: payload.num_ctx,
                num_predict: payload.num_predict,
                model_info_context_length: modelInfo?.['llama.context_length'],
                model_info_general_context_length: modelInfo?.['general.context_length'],
                details_num_ctx: details?.num_ctx,
            },
            resolved: {
                contextWindowTokens,
                maxOutputTokens: resolvedMaxOutput,
            },
        });

        return {
            contextWindowTokens,
            maxOutputTokens: resolvedMaxOutput,
            source: 'ollama',
        };
    },
};
