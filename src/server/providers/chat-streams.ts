import { GoogleGenAI, ThinkingLevel } from '@google/genai';

import { AVAILABLE_MODELS } from '@/shared/core/constants';
import { serverEnv } from '@/shared/config/server';
import type { PreparedChatMessage } from '@/shared/contracts/chat';
import { logModelLimits, resolveOutputTokenCap } from '@/server/providers/limits-utils';
import type { RequestTokenEstimates } from '@/server/providers/provider-types';
import type { ReasoningEffort } from '@/shared/core/types';
import { sharedTextEncoder } from '@/shared/lib/text-encoder';
import { serializeChatStreamEvent } from '@/shared/contracts/chat-stream';
import { logger } from '@/server/logging/logger';

const TRANSIENT_RETRY_DELAYS_MS = [500, 1500];

export function isInterruptedProviderStream(error: unknown): boolean {
    return error instanceof Error && error.message === 'Incomplete JSON segment at the end';
}

export function isTransientProviderError(error: unknown): boolean {
    if (!error || typeof error !== 'object') return false;
    const { code, status } = error as { code?: unknown; status?: unknown };
    return code === 429 || code === 503 || status === 429 || status === 503
        || isInterruptedProviderStream(error);
}

function waitForRetry(delayMs: number, signal?: AbortSignal): Promise<void> {
    return new Promise((resolve, reject) => {
        const onAbort = () => {
            clearTimeout(timer);
            reject(new DOMException('Aborted', 'AbortError'));
        };
        const timer = setTimeout(() => {
            signal?.removeEventListener('abort', onAbort);
            resolve();
        }, delayMs);
        if (signal?.aborted) onAbort();
        else signal?.addEventListener('abort', onAbort, { once: true });
    });
}

export async function retryTransientProviderRequest<T>(
    request: () => Promise<T>,
    signal?: AbortSignal,
    retryDelaysMs: readonly number[] = TRANSIENT_RETRY_DELAYS_MS,
): Promise<T> {
    for (let attempt = 0; ; attempt += 1) {
        if (signal?.aborted) throw new DOMException('Aborted', 'AbortError');
        try {
            return await request();
        } catch (error) {
            if (!isTransientProviderError(error) || attempt >= retryDelaysMs.length || signal?.aborted) {
                throw error;
            }
            logger.warn('[chat] provider temporarily unavailable; retrying', { attempt: attempt + 1 });
            const retryDelay = retryDelaysMs[attempt];
            if (retryDelay === undefined) throw error;
            await waitForRetry(retryDelay, signal);
        }
    }
}

function toNonNegativeInt(value: unknown): number | undefined {
    if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) return undefined;
    return Math.floor(value);
}

interface GoogleStreamChunk {
    usageMetadata?: {
        promptTokenCount?: unknown;
        candidatesTokenCount?: unknown;
        thoughtsTokenCount?: unknown;
        totalTokenCount?: unknown;
    };
    candidates?: Array<{
        content?: { parts?: Array<{ text?: string; thought?: boolean }> };
    }>;
}

const ABORTED_STREAM = Symbol('aborted-stream');

export function streamGoogleResponse(
    response: AsyncIterable<GoogleStreamChunk>,
    abortController: AbortController,
    onSettled: () => void = () => {},
    restart?: () => Promise<AsyncIterable<GoogleStreamChunk>>,
    retryDelaysMs: readonly number[] = TRANSIENT_RETRY_DELAYS_MS,
): ReadableStream<Uint8Array> {
    const signal = abortController.signal;
    let iterator = response[Symbol.asyncIterator]();
    let emittedText = false;
    let retryAttempt = 0;
    let cancelled = false;
    let settled = false;
    let iteratorStopped = false;
    let usage: {
        inputTokens?: number;
        outputTokens?: number;
        reasoningTokens?: number;
        totalTokens?: number;
    } | null = null;

    let resolveAborted!: () => void;
    const aborted = new Promise<typeof ABORTED_STREAM>((resolve) => {
        resolveAborted = () => resolve(ABORTED_STREAM);
        if (signal.aborted) resolveAborted();
        else signal.addEventListener('abort', resolveAborted, { once: true });
    });

    const stopIterator = () => {
        if (iteratorStopped || !iterator.return) return;
        iteratorStopped = true;
        try {
            void Promise.resolve(iterator.return()).catch(() => {});
        } catch {
            // Cancellation is best-effort; the provider abort signal stops the request.
        }
    };

    const finish = () => {
        if (settled) return;
        settled = true;
        signal.removeEventListener('abort', resolveAborted);
        onSettled();
    };

    return new ReadableStream<Uint8Array>({
        async pull(controller) {
            if (cancelled || settled) return;
            if (signal.aborted) {
                stopIterator();
                controller.close();
                finish();
                return;
            }
            for (;;) {
                try {
                    const next = await Promise.race([iterator.next(), aborted]);
                    if (cancelled) return;
                    if (next === ABORTED_STREAM || signal.aborted || next.done) {
                        if (signal.aborted) stopIterator();
                        else if (!cancelled) {
                            if (usage) {
                                const usageEvent = serializeChatStreamEvent({
                                    type: 'usage',
                                    usage: {
                                        source: 'provider',
                                        ...(usage.inputTokens === undefined ? {} : { inputTokens: usage.inputTokens }),
                                        ...(usage.outputTokens === undefined ? {} : { outputTokens: usage.outputTokens }),
                                        ...(usage.reasoningTokens === undefined ? {} : { reasoningTokens: usage.reasoningTokens }),
                                        ...(usage.totalTokens === undefined ? {} : { totalTokens: usage.totalTokens }),
                                    }
                                });
                                controller.enqueue(sharedTextEncoder.encode(`data: ${usageEvent}\n\n`));
                            }
                            controller.enqueue(sharedTextEncoder.encode('data: [DONE]\n\n'));
                        }
                        controller.close();
                        finish();
                        return;
                    }

                    const chunk = next.value;
                    const usageMetadata = chunk.usageMetadata;
                    if (usageMetadata) {
                        const inputTokens = toNonNegativeInt(usageMetadata.promptTokenCount);
                        const outputTokens = toNonNegativeInt(usageMetadata.candidatesTokenCount);
                        const reasoningTokens = toNonNegativeInt(usageMetadata.thoughtsTokenCount);
                        const totalTokens = toNonNegativeInt(usageMetadata.totalTokenCount);
                        if (inputTokens !== undefined || outputTokens !== undefined || reasoningTokens !== undefined || totalTokens !== undefined) {
                            usage = {
                                inputTokens: inputTokens ?? usage?.inputTokens,
                                outputTokens: outputTokens ?? usage?.outputTokens,
                                reasoningTokens: reasoningTokens ?? usage?.reasoningTokens,
                                totalTokens: totalTokens ?? usage?.totalTokens,
                            };
                        }
                    }

                    const candidate = chunk.candidates?.[0];
                    let emittedChunk = false;
                    for (const part of candidate?.content?.parts ?? []) {
                        if (cancelled || signal.aborted) break;
                        if (!part.text) continue;
                        emittedText = true;
                        emittedChunk = true;
                        const data = serializeChatStreamEvent(part.thought
                            ? { type: 'delta', content: '', reasoning: part.text }
                            : { type: 'delta', content: part.text, reasoning: '' });
                        controller.enqueue(sharedTextEncoder.encode(`data: ${data}\n\n`));
                    }
                    if (emittedChunk) return;
                } catch (error) {
                    const delay = retryDelaysMs[retryAttempt];
                    if (!cancelled && !signal.aborted && !emittedText && restart
                        && isTransientProviderError(error) && delay !== undefined) {
                        stopIterator();
                        retryAttempt += 1;
                        logger.warn('[chat] provider stream interrupted before text; retrying', { attempt: retryAttempt });
                        try {
                            await waitForRetry(delay, signal);
                            if (cancelled || signal.aborted) throw new DOMException('Aborted', 'AbortError');
                            const restarted = await restart();
                            iterator = restarted[Symbol.asyncIterator]();
                            iteratorStopped = false;
                            usage = null;
                            if (cancelled || signal.aborted) stopIterator();
                            continue;
                        } catch (restartError) {
                            error = restartError;
                        }
                    }
                    if (!cancelled) {
                        if (signal.aborted) controller.close();
                        else controller.error(error);
                        stopIterator();
                        finish();
                    }
                    return;
                }
            }
        },
        cancel(reason) {
            cancelled = true;
            if (!signal.aborted) abortController.abort(reason);
            stopIterator();
            finish();
        },
    });
}

export function buildGoogleContents(messages: PreparedChatMessage[]) {
    return messages.map((message) => {
        const parts: Array<Record<string, unknown>> = [];

        if (message.content) {
            parts.push({ text: message.content });
        }

        for (const attachment of message.attachments) {
            parts.push({
                inlineData: {
                    mimeType: attachment.mimeType,
                    data: attachment.base64Data,
                },
            });
        }

        if (parts.length === 0) {
            parts.push({ text: ' ' });
        }

        return {
            role: message.role === 'assistant' ? 'model' : 'user',
            parts,
        };
    });
}

export async function getGoogleStream(
    model: string,
    messages: PreparedChatMessage[],
    reasoningEffort: ReasoningEffort = 'low',
    maxOutputTokens?: number | null,
    systemPrompt?: string,
    tokenEstimates?: RequestTokenEstimates,
    signal?: AbortSignal
) {
    const ai = new GoogleGenAI({ apiKey: serverEnv.GEMINI_API_KEY });
    const contents = buildGoogleContents(messages);

    const config: {
        maxOutputTokens: number;
        thinkingConfig?: {
            includeThoughts: boolean;
            thinkingLevel?: ThinkingLevel;
            thinkingBudget?: number;
        };
        tools?: Array<{ googleSearch: Record<string, never> }>;
        systemInstruction?: string;
    } = { maxOutputTokens: resolveOutputTokenCap(maxOutputTokens) };
    logModelLimits('google-request', {
        model,
        resolvedMaxOutputTokens: maxOutputTokens,
        requestMaxOutputTokens: config.maxOutputTokens,
        messageCount: messages.length,
        estimatedInputTokens: tokenEstimates?.estimatedInputTokens,
        estimatedInputTokensWithSystemPrompt: tokenEstimates?.estimatedInputTokensWithSystemPrompt,
    });
    const modelConfig = AVAILABLE_MODELS.find(m => m.id === model);

    if (modelConfig?.supportsReasoning && reasoningEffort) {
        config.thinkingConfig = { includeThoughts: true };
        const isGemini3 = model.includes('gemini-3');
        if (isGemini3) {
            const levelMap: Record<string, ThinkingLevel> = {
                low: ThinkingLevel.LOW,
                medium: ThinkingLevel.MEDIUM,
                high: ThinkingLevel.HIGH
            };
            config.thinkingConfig.thinkingLevel = levelMap[reasoningEffort] || ThinkingLevel.MEDIUM;
        } else {
            const isFlash = model.includes('flash');
            const maxBudget = isFlash ? 24576 : 32768;
            const budgetMap: Record<string, number> = { low: 0, medium: -1, high: maxBudget };
            config.thinkingConfig.thinkingBudget = budgetMap[reasoningEffort] ?? -1;
        }
    }

    if (systemPrompt && systemPrompt.trim().length > 0) {
        config.systemInstruction = systemPrompt.trim();
    }

    const providerAbortController = new AbortController();
    const onRequestAbort = () => providerAbortController.abort(signal?.reason);
    if (signal?.aborted) onRequestAbort();
    else signal?.addEventListener('abort', onRequestAbort, { once: true });

    let response: AsyncIterable<GoogleStreamChunk>;
    try {
        response = await retryTransientProviderRequest(
            () => ai.models.generateContentStream({
                model,
                config: { ...config, abortSignal: providerAbortController.signal },
                contents,
            }),
            providerAbortController.signal,
        );
    } catch (error) {
        signal?.removeEventListener('abort', onRequestAbort);
        throw error;
    }

    return streamGoogleResponse(response, providerAbortController, () => {
        signal?.removeEventListener('abort', onRequestAbort);
    }, () => ai.models.generateContentStream({
        model,
        config: { ...config, abortSignal: providerAbortController.signal },
        contents,
    }));
}
