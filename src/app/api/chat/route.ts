import { prepareMessageAttachments } from '@/lib/chat-attachments';
import {
    CONTEXT_RETRY_SCALE,
    estimatePreparedConversationTokens,
    estimateSystemPromptTokens,
    isContextOverflowError,
    resolveOutputTokenPlan,
    trimMessagesToInputBudget,
    type TrimmedContext,
} from '@/lib/context-budget';
import { AVAILABLE_MODELS, SEARCH_ENABLED_MODELS } from '@/lib/constants';
import { getChutesStream, getGoogleStream, getOpenRouterStream } from '@/lib/providers/chat-streams';
import { resolveModelLimits } from '@/lib/providers/model-limits';
import { processAndTransformStream } from '@/lib/stream-transform';
import { ChatRequestSchema } from '@/lib/types';

import { assertValidPostOrigin, requireUser, toJsonErrorResponse } from '@/utils/api-security';

export const runtime = 'nodejs';

const SEARCH_ENABLED_MODEL_SET = new Set<string>(SEARCH_ENABLED_MODELS);

export async function POST(req: Request) {
    let supabase: Awaited<ReturnType<typeof requireUser>>['supabase'];
    let user: Awaited<ReturnType<typeof requireUser>>['user'];
    try {
        assertValidPostOrigin(req);
        const auth = await requireUser();
        supabase = auth.supabase;
        user = auth.user;
    } catch (error) {
        const response = toJsonErrorResponse(error);
        if (response) {
            return response;
        }
        return new Response(JSON.stringify({ error: 'Internal server error' }), {
            status: 500,
            headers: { 'Content-Type': 'application/json' },
        });
    }

    const encoder = new TextEncoder();
    const signal = req.signal;

    const safeEnqueue = (controller: ReadableStreamDefaultController, chunk: string | Uint8Array) => {
        try {
            if (signal.aborted) return;
            const encoded = typeof chunk === 'string' ? encoder.encode(chunk) : chunk;
            controller.enqueue(encoded);
        } catch {
            // Ignore closed controller errors
        }
    };

    const stream = new ReadableStream({
        async start(controller) {
            let heartbeatInterval: ReturnType<typeof setInterval> | undefined;

            if (signal.aborted) return;

            try {
                const body = await req.json();
                const parseResult = ChatRequestSchema.safeParse(body);
                if (!parseResult.success) {
                    safeEnqueue(controller, `data: ${JSON.stringify({ error: 'Invalid request' })}\n\n`);
                    controller.close();
                    return;
                }

                const { messages, model, reasoningEffort, systemPrompt, search } = parseResult.data;
                const modelConfig = AVAILABLE_MODELS.find(m => m.id === model);
                if (!modelConfig) {
                    safeEnqueue(controller, `data: ${JSON.stringify({ error: 'Invalid model selection' })}\n\n`);
                    controller.close();
                    return;
                }

                const useSearch = search === true;
                const normalizedSystemPrompt = systemPrompt?.trim() ?? '';

                if (modelConfig.capabilities.includes('imageGen')) {
                    safeEnqueue(controller, `data: ${JSON.stringify({ error: 'Selected model is image-generation only. Use image generation flow.' })}\n\n`);
                    controller.close();
                    return;
                }

                if (useSearch && (modelConfig.provider !== 'google' || !SEARCH_ENABLED_MODEL_SET.has(model))) {
                    safeEnqueue(controller, `data: ${JSON.stringify({ error: 'Search is supported only for Gemini 2.5 Flash and Gemini 2.5 Flash Lite.' })}\n\n`);
                    controller.close();
                    return;
                }

                const limits = await resolveModelLimits(model, modelConfig, signal);
                const systemPromptTokenEstimate = estimateSystemPromptTokens(normalizedSystemPrompt);
                const systemPromptPlan = resolveOutputTokenPlan(limits, limits.maxOutputTokens, systemPromptTokenEstimate);
                if (systemPromptPlan.remainingForOutput <= 0) {
                    safeEnqueue(controller, `data: ${JSON.stringify({ error: 'System prompt is too long for the selected model context window.' })}\n\n`);
                    controller.close();
                    return;
                }

                let trimmedContext = trimMessagesToInputBudget(messages, limits, 1, systemPromptTokenEstimate);
                if (trimmedContext.trimmedCount > 0) {
                    console.log(
                        `[chat] context-trimmed model=${model} source=${limits.source} trimmed=${trimmedContext.trimmedCount} ` +
                        `kept=${trimmedContext.messages.length} estTokens=${trimmedContext.estimatedTokens} ` +
                        `inputBudget=${trimmedContext.inputBudget} outputReserve=${trimmedContext.outputReserve} ` +
                        `systemPromptTokens=${systemPromptTokenEstimate} ` +
                        `window=${trimmedContext.contextWindow}`
                    );
                }

                heartbeatInterval = setInterval(() => {
                    safeEnqueue(controller, ': keep-alive\n\n');
                }, 15000);

                const getSourceStream = async (context: TrimmedContext) => {
                    const outputPlan = resolveOutputTokenPlan(
                        limits,
                        limits.maxOutputTokens,
                        context.estimatedTokens + systemPromptTokenEstimate
                    );
                    if (outputPlan.remainingForOutput <= 0) {
                        throw new Error('Input is too long for selected model context window.');
                    }

                    const preparedMessages = await prepareMessageAttachments(
                        context.messages,
                        supabase,
                        user.id,
                        modelConfig,
                        signal
                    );
                    const estimatedInputTokens = estimatePreparedConversationTokens(preparedMessages);
                    const estimatedInputTokensWithSystemPrompt = estimatedInputTokens + systemPromptTokenEstimate;
                    const tokenEstimates = {
                        estimatedInputTokens,
                        estimatedInputTokensWithSystemPrompt,
                    };

                    if (modelConfig.provider === 'google') {
                        return getGoogleStream(
                            model,
                            preparedMessages,
                            reasoningEffort ?? 'low',
                            outputPlan.requestMaxTokens,
                            normalizedSystemPrompt,
                            useSearch,
                            tokenEstimates,
                            signal
                        );
                    }
                    if (modelConfig.provider === 'openrouter') {
                        return getOpenRouterStream(
                            model,
                            preparedMessages,
                            reasoningEffort ?? 'low',
                            outputPlan.requestMaxTokens,
                            normalizedSystemPrompt,
                            tokenEstimates,
                            signal
                        );
                    }
                    return getChutesStream(
                        model,
                        preparedMessages,
                        reasoningEffort || 'low',
                        modelConfig,
                        outputPlan.requestMaxTokens,
                        normalizedSystemPrompt,
                        tokenEstimates,
                        signal
                    );
                };

                let sourceStream: ReadableStream;
                try {
                    sourceStream = await getSourceStream(trimmedContext);
                } catch (error) {
                    const shouldRetry = isContextOverflowError(error);
                    if (!shouldRetry || signal.aborted) {
                        throw error;
                    }

                    const retryContext = trimMessagesToInputBudget(messages, limits, CONTEXT_RETRY_SCALE, systemPromptTokenEstimate);
                    const canTighten = retryContext.messages.length < trimmedContext.messages.length
                        || retryContext.inputBudget < trimmedContext.inputBudget;
                    if (!canTighten) {
                        throw error;
                    }

                    console.warn(
                        `[chat] context-overflow model=${model} source=${limits.source} retrying with tighter budget ` +
                        `(inputBudget=${retryContext.inputBudget}, kept=${retryContext.messages.length})`
                    );
                    trimmedContext = retryContext;
                    sourceStream = await getSourceStream(trimmedContext);
                }

                if (heartbeatInterval) clearInterval(heartbeatInterval);
                await processAndTransformStream(sourceStream, controller, signal);

                if (!signal.aborted) {
                    controller.close();
                }
            } catch (error) {
                if (heartbeatInterval) clearInterval(heartbeatInterval);

                if (!signal.aborted) {
                    console.error('Chat API error:', error);
                    const errorMsg = error instanceof Error ? error.message : 'Unknown error';
                    safeEnqueue(controller, `data: ${JSON.stringify({ error: 'AI service error', details: errorMsg })}\n\n`);
                    try { controller.close(); } catch { }
                }
            }
        }
    });

    return new Response(stream, {
        headers: {
            'Content-Type': 'text/event-stream',
            'Cache-Control': 'no-cache',
            'Connection': 'keep-alive',
        },
    });
}
