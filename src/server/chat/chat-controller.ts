import 'server-only';

import { logger } from '@/server/logging/logger';

import { prepareMessageAttachments } from '@/server/chat/chat-attachments';
import {
    CONTEXT_RETRY_SCALE,
    estimatePreparedConversationTokens,
    estimateSystemPromptTokens,
    isContextOverflowError,
    resolveOutputTokenPlan,
    trimMessagesToInputBudget,
    type TrimmedContext,
} from '@/server/chat/context-budget';
import { AVAILABLE_MODELS } from '@/shared/core/constants';
import { resolveModelLimits } from '@/server/providers/model-limits';
import { resolveChatProvider } from '@/server/providers/provider-registry';
import { isTransientProviderError } from '@/server/providers/chat-streams';
import { ChatRequestSchema, type ChatMessage } from '@/shared/core/types';
import { MESSAGE_SELECT_COLUMNS, mapMessageRowToMessage } from '@/features/messages/server';
import {
    MAX_CHAT_MESSAGES,
    MAX_CHAT_REQUEST_ATTACHMENTS,
    MAX_CHAT_REQUEST_TEXT_CHARS,
} from '@/shared/validation/request-limits';
import { parseChatStreamEvent, serializeChatStreamEvent } from '@/shared/contracts/chat-stream';
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
import { assertNotTemporarilyBlocked, recordAbuseSignal } from '@/server/security/abuse-protection';
import { sharedTextEncoder } from '@/shared/lib/text-encoder';
import { ApiRequestError, parseJsonRequest } from '@/server/http/api-security';
import type { AuthenticatedContext } from '@/server/http/route-handler';
import type { Json } from '@/shared/lib/supabase/database.types';

const GENERIC_CHAT_ERROR_MESSAGE = 'Unable to complete request right now. Please try again.';
const IS_DEV = process.env.NODE_ENV !== 'production';

async function persistAssistantResponse(
    supabase: AuthenticatedContext['supabase'],
    userId: string,
    threadId: string,
    userMessageId: string,
    modelId: string,
    content: string,
    reasoning: string,
    replyStats?: Json,
) {
    const { data: existing, error: existingError } = await supabase
        .from('messages')
        .select('id')
        .eq('thread_id', threadId)
        .eq('reply_to_message_id', userMessageId)
        .is('deleted_at', null)
        .maybeSingle();
    if (existingError) throw existingError;
    if (existing) return existing.id;

    const { data, error } = await supabase
        .from('messages')
        .insert({
            thread_id: threadId,
            user_id: userId,
            role: 'assistant',
            content,
            reasoning: reasoning || null,
            model_id: modelId,
            attachments: [],
            reply_to_message_id: userMessageId,
            reply_stats: replyStats ?? null,
        })
        .select('id')
        .single();
    if (error) {
        // A concurrent retry may have inserted the response first.
        const { data: concurrent } = await supabase
            .from('messages')
            .select('id')
            .eq('thread_id', threadId)
            .eq('reply_to_message_id', userMessageId)
            .is('deleted_at', null)
            .maybeSingle();
        if (concurrent) return concurrent.id;
        throw error;
    }
    return data.id;
}

export async function handleChatRequest(
    req: Request,
    { user, supabase }: AuthenticatedContext
): Promise<Response> {
    const requestStartedAt = performance.now();
    const timing: Record<string, number> = {};
    let modelForMetrics = 'unknown';
    const signal = req.signal;
    let streamClosed = false;
    const streamId = readChatStreamId(req);
    const resumeOffset = readChatResumeOffset(req);
    let streamLockToken: string | null = null;
    if (streamId) {
        // Repeated stream failures block this user for the 'chat' scope.
        await assertNotTemporarilyBlocked(user.id, 'chat');

        const cached = await getCachedChatStreamEvents(user.id, streamId);
        if (cached) {
            // Only replay fully-completed streams. An incomplete cache means the
            // original writer died (or is still streaming); fabricating a clean
            // end here would make the client persist a truncated response.
            if (cached.events[cached.events.length - 1] !== '[DONE]') {
                return new Response(
                    serializeChatStreamEvent({ type: 'error', message: 'Unable to resume chat stream. Please retry the request.' }),
                    {
                        status: 409,
                        headers: { 'Content-Type': 'application/json' },
                    }
                );
            }
            return buildSseReplayResponse(cached.events, resumeOffset);
        }
        if (resumeOffset > 0) {
            return new Response(
                serializeChatStreamEvent({ type: 'error', message: 'Unable to resume chat stream. Please retry the request.' }),
                {
                    status: 409,
                    headers: { 'Content-Type': 'application/json' },
                }
            );
        }
        streamLockToken = await reserveChatStreamLock(user.id, streamId);
        if (!streamLockToken) {
            return new Response(
                serializeChatStreamEvent({ type: 'error', message: 'A matching chat request is already in progress.' }),
                {
                    status: 409,
                    headers: { 'Content-Type': 'application/json' },
                }
            );
        }
    }

    const safeEnqueue = (controller: ReadableStreamDefaultController, chunk: string | Uint8Array) => {
        try {
            if (signal.aborted || streamClosed) return;
            const encoded = typeof chunk === 'string' ? sharedTextEncoder.encode(chunk) : chunk;
            controller.enqueue(encoded);
        } catch (error) {
            if (IS_DEV) {
                logger.warn('[chat][controller] Failed to enqueue stream chunk', { error: error });
            }
            // Ignore closed controller errors
        }
    };

    const safeClose = (controller: ReadableStreamDefaultController) => {
        if (streamClosed) return;
        streamClosed = true;
        try {
            controller.close();
        } catch (error) {
            if (IS_DEV) {
                logger.warn('[chat][controller] Failed to close stream controller', { error: error });
            }
        }
    };

    const stream = new ReadableStream({
        async start(controller) {
            let heartbeatInterval: ReturnType<typeof setInterval> | undefined;
            let writer: ChatStreamEventWriter | null = null;
            let requestUserMessageId: string | null = null;
            let generationCompleted = false;

            const finishGenerationJob = async (status: 'completed' | 'failed', error?: string) => {
                if (!requestUserMessageId) return;
                const { data: jobs, error: lookupError } = await supabase
                    .from('generation_jobs')
                    .select('id')
                    .eq('user_id', user.id)
                    .eq('user_message_id', requestUserMessageId)
                    .in('status', ['pending', 'claimed'])
                    .limit(1);
                if (lookupError) {
                    if (IS_DEV) logger.warn('[chat] failed to find generation job', { error: lookupError });
                    return;
                }
                const jobId = jobs?.[0]?.id;
                if (!jobId) return;
                const { error: jobError } = await supabase.rpc('complete_generation_job', {
                    p_job_id: jobId,
                    p_status: status,
                    p_error: status === 'failed' ? (error ?? 'Generation failed') : null,
                });
                if (jobError && IS_DEV) {
                    logger.warn('[chat] failed to finalize generation job', { error: jobError });
                }
            };

            if (signal.aborted) return;

            try {
                const bodyParseStartedAt = performance.now();
                let body: unknown;
                try {
                    body = await parseJsonRequest(req);
                } catch (error) {
                    const message = error instanceof ApiRequestError ? error.message : 'Invalid request';
                    safeEnqueue(controller, `data: ${serializeChatStreamEvent({ type: 'error', message: message })}\n\n`);
                    safeClose(controller);
                    return;
                }
                const parseResult = ChatRequestSchema.safeParse(body);
                if (!parseResult.success) {
                    safeEnqueue(controller, `data: ${serializeChatStreamEvent({ type: 'error', message: 'Invalid request' })}\n\n`);
                    safeClose(controller);
                    return;
                }

                const { threadId, userMessageId, model, reasoningEffort, systemPrompt } = parseResult.data;
                modelForMetrics = model;
                timing.bodyParseMs = performance.now() - bodyParseStartedAt;
                requestUserMessageId = userMessageId;
                const modelConfig = AVAILABLE_MODELS.find(m => m.id === model);
                if (!modelConfig) {
                    safeEnqueue(controller, `data: ${serializeChatStreamEvent({ type: 'error', message: 'Invalid model selection' })}\n\n`);
                    safeClose(controller);
                    return;
                }

                const normalizedSystemPrompt = systemPrompt?.trim() ?? '';
                const chatProvider = resolveChatProvider(modelConfig);

                // Reconstruct history from persisted rows. This avoids sending and
                // validating a growing transcript in every browser request, and the
                // same query validates thread and message ownership.
                const historyStartedAt = performance.now();
                const limitsStartedAt = performance.now();
                const historyPromise = supabase
                        .from('messages')
                        .select(MESSAGE_SELECT_COLUMNS)
                        .eq('thread_id', threadId)
                        .eq('user_id', user.id)
                        .is('deleted_at', null)
                        .order('created_at', { ascending: false })
                        .order('id', { ascending: false })
                        .limit(MAX_CHAT_MESSAGES)
                        .then((result) => {
                            timing.historyLoadMs = performance.now() - historyStartedAt;
                            return result;
                        });
                const limitsPromise = resolveModelLimits(model, modelConfig, signal).finally(() => {
                    timing.modelLimitsMs = performance.now() - limitsStartedAt;
                });
                const [historyResult, limits] = await Promise.all([historyPromise, limitsPromise]);
                if (historyResult.error) throw historyResult.error;

                const storedMessages = (historyResult.data ?? [])
                    .map(mapMessageRowToMessage)
                    .reverse();
                const userMessageIndex = storedMessages.findIndex(
                    (message) => message.id === userMessageId && message.role === 'user'
                );
                if (userMessageIndex === -1) {
                    throw new ApiRequestError(403, 'Message not found or access denied');
                }
                const historyThroughUserMessage = storedMessages.slice(0, userMessageIndex + 1);
                let contextStartIndex = historyThroughUserMessage.length - 1;
                let contextTextCharacters = 0;
                let includedNewestMessage = false;
                for (let index = historyThroughUserMessage.length - 1; index >= 0; index -= 1) {
                    const message = historyThroughUserMessage[index];
                    if (!message) continue;
                    if (
                        includedNewestMessage
                        && contextTextCharacters + message.content.length > MAX_CHAT_REQUEST_TEXT_CHARS
                    ) {
                        break;
                    }
                    contextTextCharacters += message.content.length;
                    contextStartIndex = index;
                    includedNewestMessage = true;
                }
                const messages: ChatMessage[] = historyThroughUserMessage
                    .slice(contextStartIndex)
                    .map(({ role, content, attachments }) => ({ role, content, attachments }));

                const systemPromptTokenEstimate = estimateSystemPromptTokens(normalizedSystemPrompt);
                const systemPromptPlan = resolveOutputTokenPlan(limits, limits.maxOutputTokens, systemPromptTokenEstimate);
                if (systemPromptPlan.remainingForOutput <= 0) {
                    safeEnqueue(controller, `data: ${serializeChatStreamEvent({ type: 'error', message: 'System prompt is too long for the selected model context window.' })}\n\n`);
                    safeClose(controller);
                    return;
                }

                let trimmedContext = trimMessagesToInputBudget(messages, limits, 1, systemPromptTokenEstimate);
                const trimmedAttachmentCount = trimmedContext.messages.reduce(
                    (count, message) => count + (message.attachments?.length ?? 0),
                    0
                );
                if (trimmedAttachmentCount > MAX_CHAT_REQUEST_ATTACHMENTS) {
                    throw new ApiRequestError(400, 'Too many attachments in one request');
                }
                if (trimmedContext.trimmedCount > 0) {
                    logger.info(
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

                    const attachmentStartedAt = performance.now();
                    const preparedMessages = await prepareMessageAttachments(
                        context.messages,
                        supabase,
                        user.id,
                        modelConfig,
                        signal
                    );
                    timing.attachmentPreparationMs = (timing.attachmentPreparationMs ?? 0)
                        + performance.now() - attachmentStartedAt;
                    const estimatedInputTokens = estimatePreparedConversationTokens(preparedMessages);
                    const estimatedInputTokensWithSystemPrompt = estimatedInputTokens + systemPromptTokenEstimate;
                    const tokenEstimates = {
                        estimatedInputTokens,
                        estimatedInputTokensWithSystemPrompt,
                    };

                    const providerStartedAt = performance.now();
                    const providerStream = await chatProvider.getStream({
                        model,
                        messages: preparedMessages,
                        reasoningEffort: reasoningEffort || 'low',
                        modelConfig,
                        maxOutputTokens: outputPlan.requestMaxTokens,
                        systemPrompt: normalizedSystemPrompt,
                        tokenEstimates,
                        signal,
                    });
                    timing.providerConnectMs = (timing.providerConnectMs ?? 0)
                        + performance.now() - providerStartedAt;
                    return providerStream;
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

                    logger.warn(
                        `[chat] context-overflow model=${model} source=${limits.source} retrying with tighter budget ` +
                        `(inputBudget=${retryContext.inputBudget}, kept=${retryContext.messages.length})`
                    );
                    trimmedContext = retryContext;
                    sourceStream = await getSourceStream(trimmedContext);
                }

                // Start heartbeat now that provider connection is established.
                heartbeatInterval = setInterval(() => {
                    safeEnqueue(controller, ': keep-alive\n\n');
                }, 15000);
                // Batched event writer — buffers events and flushes via pipeline.
                writer = streamId ? createChatStreamWriter(user.id, streamId) : null;
                const captureEvent = writer
                    ? (event: string) => { writer!.push(event); }
                    : undefined;

                // Provider streams arrive in final SSE format with content and
                // reasoning already separated. Pipe bytes directly — no JSON
                // round-trip needed.
                const pipeDecoder = new TextDecoder();
                const reader = sourceStream.getReader();
                let pipeBuffer = '';
                let responseContent = '';
                let responseReasoning = '';
                const responseUsage: { current: { outputTokens?: number; inputTokens?: number; totalTokens?: number } | null } = { current: null };
                const responseStartedAt = performance.now();
                let firstTokenAt: number | null = null;
                let lastTokenAt: number | null = null;
                let providerStreamCompleted = false;
                let firstProviderTokenLogged = false;
                const processProviderLine = (rawLine: string) => {
                    const line = rawLine.trimEnd();
                    if (!line.startsWith('data: ')) return;
                    const event = line.substring(6);
                    captureEvent?.(event);
                    if (event === '[DONE]') return;
                    const parsed = parseChatStreamEvent(event);
                    if (!parsed) return;

                    if (parsed.type === 'error') {
                        throw new Error(parsed.message);
                    }
                    if (parsed.type === 'delta' && (parsed.content || parsed.reasoning)) {
                        const now = performance.now();
                        firstTokenAt ??= now;
                        lastTokenAt = now;
                        if (!firstProviderTokenLogged) {
                            firstProviderTokenLogged = true;
                            timing.providerFirstTokenMs = now - requestStartedAt;
                            logger.info('[chat][perf] first provider token', {
                                model: modelForMetrics,
                                ...timing,
                            });
                        }
                        responseContent += parsed.content;
                        responseReasoning += parsed.reasoning;
                    }
                    if (parsed.type === 'usage') {
                        responseUsage.current = {
                            ...(parsed.usage.inputTokens === undefined ? {} : { inputTokens: parsed.usage.inputTokens }),
                            ...(parsed.usage.outputTokens === undefined ? {} : { outputTokens: parsed.usage.outputTokens }),
                            ...(parsed.usage.totalTokens === undefined ? {} : { totalTokens: parsed.usage.totalTokens }),
                        };
                    }
                };
                try {
                    while (true) {
                        if (signal.aborted) break;
                        const { done, value } = await reader.read();
                        if (done) {
                            providerStreamCompleted = true;
                            break;
                        }

                        pipeBuffer += pipeDecoder.decode(value, { stream: true });
                        let nlIdx: number;
                        let searchFrom = 0;
                        while ((nlIdx = pipeBuffer.indexOf('\n', searchFrom)) !== -1) {
                            const line = pipeBuffer.substring(searchFrom, nlIdx).trimEnd();
                            searchFrom = nlIdx + 1;
                            processProviderLine(line);
                        }
                        pipeBuffer = searchFrom > 0 ? pipeBuffer.substring(searchFrom) : pipeBuffer;

                        // Enqueue the original bytes directly — no re-encode.
                        safeEnqueue(controller, value);
                    }
                    // Streams may end with a final SSE line that has no newline.
                    // Flush the decoder and parse that tail before persisting the
                    // response so the last provider token is not silently lost.
                    pipeBuffer += pipeDecoder.decode();
                    if (pipeBuffer.length > 0) processProviderLine(pipeBuffer);
                } finally {
                    reader.releaseLock();
                }

                if ((providerStreamCompleted || signal.aborted) && (responseContent || responseReasoning)) {
                    const endTime = lastTokenAt ?? performance.now();
                    const seconds = Math.max((endTime - (firstTokenAt ?? responseStartedAt)) / 1000, 0.001);
                    const outputTokens = responseUsage.current?.outputTokens;
                    const replyStats = outputTokens === undefined ? undefined : {
                        outputTokens,
                        seconds,
                        tokensPerSecond: outputTokens / seconds,
                        ttfbSeconds: firstTokenAt === null ? undefined : Math.max((firstTokenAt - responseStartedAt) / 1000, 0),
                        inputTokens: responseUsage.current?.inputTokens,
                        totalTokens: responseUsage.current?.totalTokens,
                        source: 'provider',
                    } satisfies Record<string, unknown>;
                    await persistAssistantResponse(
                        supabase,
                        user.id,
                        threadId,
                        userMessageId,
                        model,
                        responseContent,
                        responseReasoning,
                        replyStats as Json | undefined,
                    );
                    await finishGenerationJob('completed');
                    generationCompleted = true;
                    await supabase
                        .from('threads')
                        .update({ updated_at: new Date().toISOString() })
                        .eq('id', threadId)
                        .eq('user_id', user.id);
                } else if (signal.aborted || providerStreamCompleted) {
                    await finishGenerationJob('failed', 'Generation ended before a response was produced');
                }

                if (heartbeatInterval) {
                    clearInterval(heartbeatInterval);
                    heartbeatInterval = undefined;
                }
                if (!signal.aborted) {
                    safeClose(controller);
                }
                logger.info('[chat][perf] stream completed', {
                    model: modelForMetrics,
                    totalMs: performance.now() - requestStartedAt,
                    responseCharacters: responseContent.length + responseReasoning.length,
                    ...timing,
                });
                if (writer) {
                    await writer.close();
                }
            } catch (error) {
                if (heartbeatInterval) {
                    clearInterval(heartbeatInterval);
                    heartbeatInterval = undefined;
                }

                if (!signal.aborted) {
                    logger.warn('[chat][perf] stream failed', {
                        model: modelForMetrics,
                        totalMs: performance.now() - requestStartedAt,
                        ...timing,
                    });
                    await finishGenerationJob('failed', error instanceof Error ? error.message : 'Generation failed');
                    logger.error('Chat API error:', error);
                    const providerUnavailable = isTransientProviderError(error);
                    const message = providerUnavailable
                        ? 'The selected model is busy right now. Please retry or choose another model.'
                        : GENERIC_CHAT_ERROR_MESSAGE;
                    safeEnqueue(controller, `data: ${serializeChatStreamEvent({ type: 'error', message: message })}\n\n`);
                    safeClose(controller);
                    if (!providerUnavailable) {
                        await recordAbuseSignal(user.id, 'chat', 'stream-failure');
                    }
                }
                if (signal.aborted && !generationCompleted && requestUserMessageId) {
                    await finishGenerationJob('failed', 'Generation was interrupted');
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

    return new Response(stream, {
        headers: {
            'Content-Type': 'text/event-stream',
            'Cache-Control': 'no-cache',
            'Connection': 'keep-alive',
            'X-Accel-Buffering': 'no',
        },
    });
}
