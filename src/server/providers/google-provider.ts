import { buildGoogleContents, getGoogleStream } from '@/server/providers/chat-streams';
import { serverEnv } from '@/shared/config/server';
import { logModelLimits, toPositiveInt } from '@/server/providers/limits-utils';
import type { ChatProvider } from '@/server/providers/provider-types';

export const googleProvider: ChatProvider = {
    id: 'google',
    buildMessages: ({ messages }) => buildGoogleContents(messages),
    getStream: async ({
        model,
        messages,
        reasoningEffort,
        maxOutputTokens,
        systemPrompt,
        useSearch,
        tokenEstimates,
        signal,
    }) => getGoogleStream(
        model,
        messages,
        reasoningEffort,
        maxOutputTokens,
        systemPrompt,
        useSearch ?? false,
        tokenEstimates,
        signal
    ),
    resolveModelLimits: async ({ model, signal }) => {
        const modelId = model.startsWith('models/') ? model.slice('models/'.length) : model;
        const url = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(modelId)}`;
        const response = await fetch(url, {
            method: 'GET',
            headers: {
                'x-goog-api-key': serverEnv.GEMINI_API_KEY,
            },
            signal
        });
        if (!response.ok) return null;

        const payload = await response.json() as Record<string, unknown>;
        const contextWindowTokens = toPositiveInt(payload.inputTokenLimit);
        if (!contextWindowTokens) return null;

        const resolvedMaxOutput = toPositiveInt(payload.outputTokenLimit);
        logModelLimits('google-model-limits', {
            model,
            raw: {
                inputTokenLimit: payload.inputTokenLimit,
                outputTokenLimit: payload.outputTokenLimit,
            },
            resolved: {
                contextWindowTokens,
                maxOutputTokens: resolvedMaxOutput,
            },
        });

        return {
            contextWindowTokens,
            maxOutputTokens: resolvedMaxOutput,
            source: 'google',
        };
    },
};

