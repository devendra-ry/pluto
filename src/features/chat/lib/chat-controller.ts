import { prepareMessageAttachments } from '@/features/chat/lib/chat-attachments';
import {
    CONTEXT_RETRY_SCALE,
    estimatePreparedConversationTokens,
    estimateSystemPromptTokens,
    isContextOverflowError,
    resolveOutputTokenPlan,
    trimMessagesToInputBudget,
    type TrimmedContext,
} from '@/features/chat/lib/context-budget';
import { AVAILABLE_MODELS, SEARCH_ENABLED_MODELS } from '@/shared/core/constants';
import { resolveModelLimits } from '@/server/providers/model-limits';
import { resolveChatProvider } from '@/server/providers/provider-registry';
import { processAndTransformStream } from '@/features/chat/lib/stream-transform';
import { ChatRequestSchema } from '@/shared/core/types';
import {
    buildSseReplayResponse,
    getCachedChatStreamEvents,
    releaseChatStreamLock,
    readChatResumeOffset,
    readChatStreamId,
    reserveChatStreamLock,
    setCachedChatStreamEvents,
} from '@/server/redis/chat-stream-cache';
import { recordAbuseSignal } from '@/server/security/abuse-protection';
import type { AuthenticatedContext } from '@/utils/route-handler';

const SEARCH_ENABLED_MODEL_SET = new Set<string>(SEARCH_ENABLED_MODELS);
const GENERIC_CHAT_ERROR_MESSAGE = 'Unable to complete request right now. Please try again.';
const IS_DEV = process.env.NODE_ENV !== 'production';

export async function handleChatRequest(
    req: Request,
    { user, supabase }: AuthenticatedContext
): Promise<Response> {
    const encoder = new TextEncoder();
    const signal = req.signal;
    const streamId = readChatStreamId(req);
    const resumeOffset = readChatResumeOffset(req);
    let streamLockToken: string | null = null;
    if (streamId) {
        const cached = await getCachedChatStreamEvents(user.id, streamId);
        if (cached) {
            return buildSseReplayResponse(cached.events, resumeOffset);
        }
        if (resumeOffset > 0) {
            return new Response(
                JSON.stringify({ error: 'Unable to resume chat stream. Please retry the request.' }),
                {
                    status: 409,
                    headers: { 'Content-Type': 'application/json' },
                }
            );
        }
        streamLockToken = await reserveChatStreamLock(user.id, streamId);
        if (!streamLockToken) {
            return new Response(
                JSON.stringify({ error: 'A matching chat request is already in progress.' }),
                {
                    status: 409,
                    headers: { 'Content-Type': 'application/json' },
                }
            );
        }
    }

    let captureChunk: ((chunk: string | Uint8Array) => void) | null = null;

    const safeEnqueue = (controller: ReadableStreamDefaultController, chunk: string | Uint8Array) => {
        try {
            if (signal.aborted) return;
            if (captureChunk) captureChunk(chunk);
            const encoded = typeof chunk === 'string' ? encoder.encode(chunk) : chunk;
            controller.enqueue(encoded);
        } catch (error) {
            if (IS_DEV) {
                console.warn('[chat][controller] Failed to enqueue stream chunk', error);
            }
            // Ignore closed controller errors
        }
    };

    const stream = new ReadableStream({
        async start(controller) {
            let heartbeatInterval: ReturnType<typeof setInterval> | undefined;
            const capturedEvents: string[] = [];
            const captureDecoder = new TextDecoder();
            let captureBuffer = '';
            captureChunk = (chunk) => {
                const text = typeof chunk === 'string'
                    ? chunk
                    : captureDecoder.decode(chunk, { stream: true });
                captureBuffer += text;
                const lines = captureBuffer.split('\n');
                captureBuffer = lines.pop() || '';
                for (const line of lines) {
                    if (!line.startsWith('data: ')) continue;
                    capturedEvents.push(line.slice(6));
                }
            };

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
                const chatProvider = resolveChatProvider(modelConfig);

                if (modelConfig.capabilities.includes('imageGen')) {
                    safeEnqueue(controller, `data: ${JSON.stringify({ error: 'Selected model is image-generation only. Use image generation flow.' })}\n\n`);
                    controller.close();
                    return;
                }

                if (useSearch && (chatProvider.id !== 'google' || !SEARCH_ENABLED_MODEL_SET.has(model))) {
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

                    return chatProvider.getStream({
                        model,
                        messages: preparedMessages,
                        reasoningEffort: reasoningEffort || 'low',
                        modelConfig,
                        maxOutputTokens: outputPlan.requestMaxTokens,
                        systemPrompt: normalizedSystemPrompt,
                        useSearch,
                        tokenEstimates,
                        signal,
                    });
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
                if (streamId && capturedEvents.length > 0) {
                    await setCachedChatStreamEvents(user.id, streamId, capturedEvents);
                }
            } catch (error) {
                if (heartbeatInterval) clearInterval(heartbeatInterval);

                if (!signal.aborted) {
                    console.error('Chat API error:', error);
                    safeEnqueue(controller, `data: ${JSON.stringify({ error: GENERIC_CHAT_ERROR_MESSAGE })}\n\n`);
                    try { controller.close(); } catch (closeError) {
                        if (IS_DEV) {
                            console.warn('[chat][controller] Failed to close stream controller', closeError);
                        }
                    }
                    await recordAbuseSignal(user.id, 'chat', 'stream-failure');
                }
                if (streamId && capturedEvents.length > 0) {
                    await setCachedChatStreamEvents(user.id, streamId, capturedEvents);
                }
            } finally {
                captureChunk = null;
                if (streamId) {
                    await releaseChatStreamLock(user.id, streamId, streamLockToken);
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
