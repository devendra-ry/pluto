import { GoogleGenAI, ThinkingLevel } from '@google/genai';

import { AVAILABLE_MODELS } from '@/shared/core/constants';
import { serverEnv } from '@/shared/config/server';
import type { PreparedChatMessage } from '@/shared/contracts/chat';
import { logModelLimits, resolveOutputTokenCap } from '@/server/providers/limits-utils';
import type { RequestTokenEstimates } from '@/server/providers/provider-types';
import type { ReasoningEffort } from '@/shared/core/types';
import { sharedTextEncoder } from '@/shared/lib/text-encoder';
import { logger } from '@/server/logging/logger';

const TRANSIENT_RETRY_DELAYS_MS = [500, 1500];

export function isTransientProviderError(error: unknown): boolean {
    if (!error || typeof error !== 'object') return false;
    const { code, status } = error as { code?: unknown; status?: unknown };
    return code === 429 || code === 503 || status === 429 || status === 503;
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
            await waitForRetry(retryDelaysMs[attempt], signal);
        }
    }
}

function toNonNegativeInt(value: unknown): number | undefined {
    if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) return undefined;
    return Math.floor(value);
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

    const response = await retryTransientProviderRequest(
        () => ai.models.generateContentStream({ model, config, contents }),
        signal,
    );
    return new ReadableStream({
        async start(controller) {
            try {
                let usage: { inputTokens?: number; outputTokens?: number; totalTokens?: number } | null = null;
                for await (const chunk of response) {
                    if (signal?.aborted) break;

                    const usageMetadata = (chunk as { usageMetadata?: unknown }).usageMetadata;
                    if (usageMetadata && typeof usageMetadata === 'object') {
                        const usageRecord = usageMetadata as Record<string, unknown>;
                        const inputTokens = toNonNegativeInt(usageRecord.promptTokenCount);
                        const outputTokens = toNonNegativeInt(usageRecord.candidatesTokenCount);
                        const totalTokens = toNonNegativeInt(usageRecord.totalTokenCount);
                        if (inputTokens !== undefined || outputTokens !== undefined || totalTokens !== undefined) {
                            usage = { inputTokens, outputTokens, totalTokens };
                        }
                    }

                    const candidate = chunk.candidates?.[0];
                    if (!candidate?.content?.parts) continue;
                    for (const part of candidate.content.parts) {
                        if (!part.text) continue;
                        const data = JSON.stringify(part.thought ? { r: part.text } : { c: part.text });
                        controller.enqueue(sharedTextEncoder.encode(`data: ${data}\n\n`));
                    }
                }
                if (!signal?.aborted) {
                    if (usage) {
                        const usageEvent = JSON.stringify({
                            meta: 'usage',
                            usage: {
                                source: 'provider',
                                inputTokens: usage.inputTokens,
                                outputTokens: usage.outputTokens,
                                totalTokens: usage.totalTokens,
                            }
                        });
                        controller.enqueue(sharedTextEncoder.encode(`data: ${usageEvent}\n\n`));
                    }
                    controller.enqueue(sharedTextEncoder.encode('data: [DONE]\n\n'));
                    controller.close();
                }
            } catch (e) {
                if (!signal?.aborted) {
                    controller.error(e);
                }
            }
        }
    });
}
