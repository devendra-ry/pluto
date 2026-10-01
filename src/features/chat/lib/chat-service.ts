import { type ChatMessage, type ReasoningEffort } from '@/shared/core/types';
import { createIdempotencyKey } from '@/shared/lib/idempotency';
import { sharedTextEncoder } from '@/shared/lib/text-encoder';
import { SseEventDecoder } from '@/shared/streaming/sse-line-decoder';
import { parseChatStreamEvent, parseChatStreamPayload, type ChatStreamEvent } from '@/shared/contracts/chat-stream';

interface ChatStreamParams {
    threadId?: string;
    userMessageId?: string;
    messages?: ChatMessage[];
    model: string;
    reasoningEffort: ReasoningEffort;
    systemPrompt?: string;
    signal?: AbortSignal;
}

export type ChatServiceStreamChunk =
    | { type: 'content'; value: string }
    | { type: 'reasoning'; value: string }
    | { type: 'usage'; value: { outputTokens: number; inputTokens?: number; reasoningTokens?: number; totalTokens?: number; source: 'provider' } }
    | { type: 'error'; value: string }
    | { type: 'done' };

const MAX_STREAM_RESUME_ATTEMPTS = 2;
const IS_DEV = process.env.NODE_ENV !== 'production';

function createAbortError(): Error {
    return new DOMException('The operation was aborted.', 'AbortError');
}

function isAbortError(error: unknown): error is Error {
    return error instanceof Error && error.name === 'AbortError';
}

function readNonNegativeInt(value: unknown): number | undefined {
    if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) return undefined;
    return Math.floor(value);
}

function parseUsageEvent(event: Extract<ChatStreamEvent, { type: 'usage' }>): { outputTokens: number; inputTokens?: number; reasoningTokens?: number; totalTokens?: number; source: 'provider' } | null {
    const usage = event.usage;
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
    const reasoningTokens =
        readNonNegativeInt(usage.reasoningTokens) ??
        readNonNegativeInt(usage.thoughtsTokenCount);

    if (outputTokens === undefined && inputTokens !== undefined && totalTokens !== undefined) {
        const inferred = totalTokens - inputTokens - (reasoningTokens ?? 0);
        if (inferred >= 0) outputTokens = inferred;
    }
    if (outputTokens === undefined) return null;

    return { outputTokens, inputTokens, reasoningTokens, totalTokens, source: 'provider' };
}

class ChatService {
    async *streamChat({
        model,
        threadId,
        userMessageId,
        reasoningEffort,
        systemPrompt,
        signal,
    }: ChatStreamParams): AsyncGenerator<ChatServiceStreamChunk, void, unknown> {
        const streamId = createIdempotencyKey('chat');
        let attempts = 0;
        let resumeByteOffset = 0;

        while (true) {
            let response: Response;
            try {
                response = await fetch('/api/chat', {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json',
                        'X-Idempotency-Key': streamId,
                        ...(resumeByteOffset > 0 ? { 'X-Chat-Resume-Offset': String(resumeByteOffset) } : {}),
                    },
                    body: JSON.stringify({
                        threadId,
                        userMessageId,
                        model,
                        reasoningEffort,
                        systemPrompt,
                    }),
                    ...(signal ? { signal } : {}),
                });
            } catch (error) {
                if (signal?.aborted) throw createAbortError();
                throw error;
            }

            if (!response.ok) {
                let message = `Failed to get response (${response.status})`;
                try {
                    const payload: unknown = await response.json();
                    const parsed = parseChatStreamPayload(payload);
                    const errorText = parsed?.type === 'error' ? parsed.message : '';
                    const detailsText = parsed?.type === 'error' ? parsed.details ?? '' : '';
                    if (errorText) {
                        message = detailsText ? `${errorText}: ${detailsText}` : errorText;
                    }
                } catch {
                    // Ignore parse failures and keep fallback status message.
                }
                throw new Error(message);
            }

            const reader = response.body?.getReader();
            if (!reader) return;

            const eventDecoder = new SseEventDecoder({
                label: 'chat-service',
                ...(IS_DEV ? { onWarning: (message: string) => console.warn(message) } : {}),
            });

            try {
                while (true) {
                    let readResult: ReadableStreamReadResult<Uint8Array<ArrayBufferLike>>;
                    try {
                        readResult = await reader.read();
                    } catch (readError) {
                        if (signal?.aborted) throw createAbortError();
                        if (isAbortError(readError)) throw readError;
                        const message = readError instanceof Error ? readError.message : 'stream read failure';
                        throw new Error(`RESUMEABLE_STREAM_READ:${message}`);
                    }

                    const { done, value } = readResult;
                    const events = done ? eventDecoder.finish() : eventDecoder.push(value);
                    for (const { data } of events) {
                        // Track acknowledged bytes by complete SSE data events so resume
                        // offsets stay aligned with replay semantics and avoid decode
                        // boundary drift from partial UTF-8 chunks.
                        resumeByteOffset += sharedTextEncoder.encode(`data: ${data}\n\n`).byteLength;

                        if (data === '[DONE]') return;

                        const parsed = parseChatStreamEvent(data);
                        if (parsed?.type === 'error') {
                            const message = parsed.message.trim();
                            if (message) {
                                const details = parsed.details?.trim() ?? '';
                                throw new Error(details ? `${message}: ${details}` : message);
                            }
                        } else if (parsed?.type === 'usage') {
                            const usage = parseUsageEvent(parsed);
                            if (usage) yield { type: 'usage', value: usage };
                        } else if (parsed?.type === 'delta') {
                            if (parsed.reasoning) yield { type: 'reasoning', value: parsed.reasoning };
                            if (parsed.content) yield { type: 'content', value: parsed.content };
                        }
                    }

                    if (done) {
                        // EOF alone cannot confirm that the server saved the reply.
                        // Resume a truncated connection unless finish() found [DONE].
                        throw new Error('RESUMEABLE_STREAM_READ:Chat stream ended before completion');
                    }
                }
            } catch (error) {
                if (signal?.aborted) throw createAbortError();
                if (isAbortError(error)) throw error;
                const isResumeableReadError =
                    error instanceof Error
                    && error.message.startsWith('RESUMEABLE_STREAM_READ:');

                if (!isResumeableReadError || signal?.aborted || attempts >= MAX_STREAM_RESUME_ATTEMPTS) {
                    if (isResumeableReadError) {
                        throw new Error(error.message.slice('RESUMEABLE_STREAM_READ:'.length));
                    }
                    throw error;
                }

                attempts += 1;
            } finally {
                // A consumer can stop iterating early, the signal can abort a pending
                // read, and [DONE] can arrive before the HTTP body closes. In each case
                // cancel the source and release the lock so the connection is freed.
                try {
                    void reader.cancel().catch(() => undefined);
                } catch {
                    // Cancellation is best effort; releasing the lock is still useful.
                }
                try {
                    reader.releaseLock();
                } catch {
                    // A pending read owns the lock until its rejection settles.
                }
            }
        }
    }
}

export const chatService = new ChatService();
