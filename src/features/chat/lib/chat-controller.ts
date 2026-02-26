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
import { JsonToSseTransformStream, UI_MESSAGE_STREAM_HEADERS } from 'ai';
import {
    buildSseReplayResponse,
    getCachedChatStreamEvents,
    releaseChatStreamLock,
    readChatResumeOffset,
    readChatStreamId,
    reserveChatStreamLock,
    createChatStreamWriter,
    type ChatStreamEventWriter,
} from '@/server/redis/chat-stream-cache';
import { recordAbuseSignal } from '@/server/security/abuse-protection';
import type { AuthenticatedContext } from '@/utils/route-handler';

const SEARCH_ENABLED_MODEL_SET = new Set<string>(SEARCH_ENABLED_MODELS);
const GENERIC_CHAT_ERROR_MESSAGE = 'Unable to complete request right now. Please try again.';
const IS_DEV = process.env.NODE_ENV !== 'production';
type ProviderUsage = { outputTokens: number; inputTokens?: number; totalTokens?: number; source: 'provider' };

/**
 * Extract a string-typed field value from a JSON string using indexOf,
 * avoiding a full JSON.parse where possible.
 */
function extractJsonStringField(json: string, field: string): string {
    const needle = `"${field}":"`;
    const start = json.indexOf(needle);
    if (start === -1) return '';

    const valueStart = start + needle.length;
    let i = valueStart;
    while (i < json.length) {
        if (json.charCodeAt(i) === 92 /* backslash */) {
            i += 2;
            continue;
        }
        if (json.charCodeAt(i) === 34 /* quote */) {
            break;
        }
        i++;
    }

    if (i >= json.length) return '';

    const raw = json.substring(valueStart, i);
    if (raw.indexOf('\\') === -1) return raw;
    try {
        return JSON.parse(`"${raw}"`) as string;
    } catch {
        return raw;
    }
}

function readNonNegativeInt(value: unknown): number | undefined {
    if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) return undefined;
    return Math.floor(value);
}

function parseUsageEvent(data: string): ProviderUsage | null {
    if (
        !data.includes('"usage"')
        && !data.includes('"usageMetadata"')
        && !data.includes('"outputTokens"')
        && !data.includes('"completion_tokens"')
        && !data.includes('"tokens_completion"')
        && !data.includes('"tokens_prompt"')
        && !data.includes('"type":"data-usage"')
    ) {
        return null;
    }

    try {
        const parsed = JSON.parse(data) as Record<string, unknown>;
        const typedData = (parsed.type === 'data-usage' && parsed.data && typeof parsed.data === 'object')
            ? parsed.data as Record<string, unknown>
            : null;
        const normalizedUsage = (
            parsed.meta === 'usage'
            && parsed.usage
            && typeof parsed.usage === 'object'
        ) ? parsed.usage as Record<string, unknown> : null;

        const usage = typedData
            ?? normalizedUsage
            ?? ((parsed.usage && typeof parsed.usage === 'object') ? parsed.usage as Record<string, unknown> : null)
            ?? ((parsed.usageMetadata && typeof parsed.usageMetadata === 'object') ? parsed.usageMetadata as Record<string, unknown> : null)
            ?? parsed;
        if (!usage) return null;

        const inputTokens =
            readNonNegativeInt(usage.inputTokens) ??
            readNonNegativeInt(usage.prompt_tokens) ??
            readNonNegativeInt(usage.promptTokenCount) ??
            readNonNegativeInt(usage.tokens_prompt) ??
            readNonNegativeInt(usage.native_tokens_prompt);
        let outputTokens =
            readNonNegativeInt(usage.outputTokens) ??
            readNonNegativeInt(usage.completion_tokens) ??
            readNonNegativeInt(usage.candidatesTokenCount) ??
            readNonNegativeInt(usage.tokens_completion) ??
            readNonNegativeInt(usage.native_tokens_completion);
        const totalTokens =
            readNonNegativeInt(usage.totalTokens) ??
            readNonNegativeInt(usage.total_tokens) ??
            readNonNegativeInt(usage.totalTokenCount);

        if (outputTokens === undefined && inputTokens !== undefined && totalTokens !== undefined) {
            const inferred = totalTokens - inputTokens;
            if (inferred >= 0) outputTokens = inferred;
        }
        if (outputTokens === undefined) return null;

        return { outputTokens, inputTokens, totalTokens, source: 'provider' };
    } catch {
        return null;
    }
}

export async function handleChatRequest(
    req: Request,
    { user, supabase }: AuthenticatedContext
): Promise<Response> {
    const signal = req.signal;
    let streamClosed = false;
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

    const safeClose = (controller: ReadableStreamDefaultController<Record<string, unknown>>) => {
        if (streamClosed) return;
        streamClosed = true;
        try {
            controller.close();
        } catch (error) {
            if (IS_DEV) {
                console.warn('[chat][controller] Failed to close stream controller', error);
            }
        }
    };

    const stream = new ReadableStream<Record<string, unknown>>({
        async start(controller) {
            let writer: ChatStreamEventWriter | null = null;
            let textStarted = false;
            let reasoningStarted = false;
            const textId = 'text-1';
            const reasoningId = 'reasoning-1';

            const safeEnqueue = (chunk: Record<string, unknown>) => {
                try {
                    if (signal.aborted || streamClosed) return;
                    const serialized = JSON.stringify(chunk);
                    if (writer) {
                        writer.push(serialized);
                    }
                    controller.enqueue(chunk);
                } catch (error) {
                    if (IS_DEV) {
                        console.warn('[chat][controller] Failed to enqueue stream chunk', error);
                    }
                }
            };

            const emitStart = () => {
                safeEnqueue({ type: 'start' });
                safeEnqueue({ type: 'start-step' });
            };
            const emitFinish = () => {
                if (reasoningStarted) {
                    safeEnqueue({ type: 'reasoning-end', id: reasoningId });
                    reasoningStarted = false;
                }
                if (textStarted) {
                    safeEnqueue({ type: 'text-end', id: textId });
                    textStarted = false;
                }
                safeEnqueue({ type: 'finish-step' });
                safeEnqueue({ type: 'finish', finishReason: 'stop' });
            };

            if (signal.aborted) return;

            try {
                const body = await req.json();
                const parseResult = ChatRequestSchema.safeParse(body);
                if (!parseResult.success) {
                    safeEnqueue({ type: 'error', errorText: 'Invalid request' });
                    safeClose(controller);
                    return;
                }

                const { messages, model, reasoningEffort, systemPrompt, search } = parseResult.data;
                const modelConfig = AVAILABLE_MODELS.find(m => m.id === model);
                if (!modelConfig) {
                    safeEnqueue({ type: 'error', errorText: 'Invalid model selection' });
                    safeClose(controller);
                    return;
                }

                const useSearch = search === true;
                const normalizedSystemPrompt = systemPrompt?.trim() ?? '';
                const chatProvider = resolveChatProvider(modelConfig);

                if (modelConfig.capabilities.includes('imageGen')) {
                    safeEnqueue({ type: 'error', errorText: 'Selected model is image-generation only. Use image generation flow.' });
                    safeClose(controller);
                    return;
                }

                if (useSearch && (chatProvider.id !== 'google' || !SEARCH_ENABLED_MODEL_SET.has(model))) {
                    safeEnqueue({ type: 'error', errorText: 'Search is supported only for Gemini 2.5 Flash and Gemini 2.5 Flash Lite.' });
                    safeClose(controller);
                    return;
                }

                const limits = await resolveModelLimits(model, modelConfig, signal);
                const systemPromptTokenEstimate = estimateSystemPromptTokens(normalizedSystemPrompt);
                const systemPromptPlan = resolveOutputTokenPlan(limits, limits.maxOutputTokens, systemPromptTokenEstimate);
                if (systemPromptPlan.remainingForOutput <= 0) {
                    safeEnqueue({ type: 'error', errorText: 'System prompt is too long for the selected model context window.' });
                    safeClose(controller);
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

                // Batched event writer — buffers events and flushes via pipeline.
                writer = streamId ? createChatStreamWriter(user.id, streamId) : null;

                emitStart();

                const normalizedSourceStream = chatProvider.needsThinkTagTransform
                    ? new ReadableStream<Uint8Array>({
                        async start(normalizedController) {
                            await processAndTransformStream(
                                sourceStream,
                                normalizedController as unknown as ReadableStreamDefaultController,
                                signal
                            );
                            normalizedController.close();
                        }
                    })
                    : (sourceStream as ReadableStream<Uint8Array>);

                const decoder = new TextDecoder();
                const reader = normalizedSourceStream.getReader();
                let buffer = '';
                try {
                    while (true) {
                        if (signal.aborted) break;
                        const { done, value } = await reader.read();
                        if (done) break;
                        buffer += decoder.decode(value, { stream: true });

                        let searchFrom = 0;
                        while (true) {
                            const nlIdx = buffer.indexOf('\n', searchFrom);
                            if (nlIdx === -1) break;
                            const line = buffer.substring(searchFrom, nlIdx);
                            searchFrom = nlIdx + 1;
                            const trimmed = line.trim();
                            if (!trimmed.startsWith('data: ')) continue;
                            const data = trimmed.slice(6);
                            if (data === '[DONE]') continue;

                            if (data.includes('"error"')) {
                                let parsedError: string | null = null;
                                try {
                                    const parsed = JSON.parse(data) as Record<string, unknown>;
                                    const streamError = typeof parsed.error === 'string' ? parsed.error.trim() : '';
                                    if (streamError) {
                                        const streamDetails = typeof parsed.details === 'string' ? parsed.details.trim() : '';
                                        parsedError = streamDetails ? `${streamError}: ${streamDetails}` : streamError;
                                    }
                                } catch {
                                    // Ignore malformed error payloads and continue processing.
                                }
                                if (parsedError) {
                                    throw new Error(parsedError);
                                }
                            }

                            const usage = parseUsageEvent(data);
                            if (usage) {
                                safeEnqueue({ type: 'data-usage', data: usage });
                            }

                            const reasoning =
                                extractJsonStringField(data, 'r') ||
                                extractJsonStringField(data, 'reasoning_content') ||
                                extractJsonStringField(data, 'thinking');
                            if (reasoning) {
                                if (!reasoningStarted) {
                                    safeEnqueue({ type: 'reasoning-start', id: reasoningId });
                                    reasoningStarted = true;
                                }
                                safeEnqueue({ type: 'reasoning-delta', id: reasoningId, delta: reasoning });
                            }

                            const content =
                                extractJsonStringField(data, 'c') ||
                                extractJsonStringField(data, 'content');
                            if (content) {
                                if (!textStarted) {
                                    safeEnqueue({ type: 'text-start', id: textId });
                                    textStarted = true;
                                }
                                safeEnqueue({ type: 'text-delta', id: textId, delta: content });
                            }
                        }

                        buffer = searchFrom > 0 ? buffer.substring(searchFrom) : buffer;
                    }
                } finally {
                    reader.releaseLock();
                }

                emitFinish();
                if (!signal.aborted) {
                    safeClose(controller);
                }
                if (writer) {
                    await writer.close();
                }
            } catch (error) {
                if (!signal.aborted) {
                    console.error('Chat API error:', error);
                    const errorText = error instanceof Error && error.message
                        ? error.message
                        : GENERIC_CHAT_ERROR_MESSAGE;
                    safeEnqueue({ type: 'error', errorText });
                    safeClose(controller);
                    await recordAbuseSignal(user.id, 'chat', 'stream-failure');
                }
                if (writer) {
                    await writer.close();
                }
            } finally {
                if (streamId) {
                    await releaseChatStreamLock(user.id, streamId, streamLockToken);
                }
            }
        }
    });

    return new Response(
        stream
            .pipeThrough(new JsonToSseTransformStream())
            .pipeThrough(new TextEncoderStream()),
        {
        headers: UI_MESSAGE_STREAM_HEADERS,
        }
    );
}
