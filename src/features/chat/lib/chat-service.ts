import { type Attachment, type ChatMessage, type ReasoningEffort } from '@/shared/core/types';
import { createIdempotencyKey } from '@/shared/lib/idempotency';
import { DefaultChatTransport, type UIMessage, type UIMessageChunk } from 'ai';
import { fetchEventSource, type EventSourceMessage } from '@microsoft/fetch-event-source';
import { parseProviderUsage } from '@/features/chat/lib/provider-usage';

export interface ChatStreamParams {
    messages: ChatMessage[];
    model: string;
    reasoningEffort: ReasoningEffort;
    systemPrompt?: string;
    search: boolean;
    signal?: AbortSignal;
}

export interface ImageVideoGenerationParams {
    threadId: string;
    model: string;
    prompt: string;
    attachments: Attachment[];
    isVideo: boolean;
    signal?: AbortSignal;
}

export type StreamChunk =
    | { type: 'content'; value: string }
    | { type: 'reasoning'; value: string }
    | { type: 'usage'; value: { outputTokens: number; inputTokens?: number; totalTokens?: number; source: 'provider' } }
    | { type: 'error'; value: string }
    | { type: 'done' };

export interface GenerationResult {
    attachment: Attachment;
    content: string;
    operation: string;
    revisedPrompt?: string;
}

type StreamQueueEntry =
    | { type: 'chunk'; chunk: StreamChunk }
    | { type: 'error'; error: Error }
    | { type: 'done' };

function isAttachment(value: unknown): value is Attachment {
    if (!value || typeof value !== 'object') return false;
    const record = value as Record<string, unknown>;
    return (
        typeof record.id === 'string' &&
        typeof record.name === 'string' &&
        typeof record.mimeType === 'string' &&
        typeof record.size === 'number' &&
        typeof record.path === 'string' &&
        typeof record.url === 'string'
    );
}

const transport = new DefaultChatTransport<UIMessage>({
    api: '/api/chat',
    prepareSendMessagesRequest: ({ api, body, headers, credentials }) => {
        const payload = body as Record<string, unknown>;
        return {
            api,
            headers,
            credentials,
            body: {
                messages: Array.isArray(payload.messagesPayload) ? payload.messagesPayload : [],
                model: typeof payload.model === 'string' ? payload.model : '',
                reasoningEffort: payload.reasoningEffort,
                systemPrompt: typeof payload.systemPrompt === 'string' ? payload.systemPrompt : undefined,
                search: payload.search === true,
            },
        };
    },
});

function normalizeTransportError(error: unknown): string {
    if (!(error instanceof Error)) {
        return 'Failed to get response';
    }
    const message = error.message || 'Failed to get response';
    try {
        const parsed = JSON.parse(message) as Record<string, unknown>;
        const errorText = typeof parsed.error === 'string' ? parsed.error : '';
        const detailsText = typeof parsed.details === 'string' ? parsed.details : '';
        if (errorText) {
            return detailsText ? `${errorText}: ${detailsText}` : errorText;
        }
    } catch {
        // Error message is not JSON.
    }
    return message;
}

function normalizeResponseErrorPayload(payload: Record<string, unknown>, fallback: string): string {
    const errorText = typeof payload.error === 'string' ? payload.error : '';
    const detailsText = typeof payload.details === 'string' ? payload.details : '';
    if (errorText) {
        return detailsText ? `${errorText}: ${detailsText}` : errorText;
    }
    return fallback;
}

function mapUiChunkToStreamChunk(chunk: UIMessageChunk): StreamChunk | null {
    if (chunk.type === 'error') {
        throw new Error(chunk.errorText || 'Unable to complete request right now. Please try again.');
    }
    if (chunk.type === 'reasoning-delta') {
        if (chunk.delta) {
            return { type: 'reasoning', value: chunk.delta };
        }
        return null;
    }
    if (chunk.type === 'text-delta') {
        if (chunk.delta) {
            return { type: 'content', value: chunk.delta };
        }
        return null;
    }
    if (chunk.type === 'data-usage') {
        const usage = parseProviderUsage(chunk.data);
        if (usage) {
            return { type: 'usage', value: usage };
        }
    }
    return null;
}

export class ChatService {
    async generateImageOrVideo({
        threadId,
        model,
        prompt,
        attachments,
        isVideo,
        signal,
    }: ImageVideoGenerationParams): Promise<GenerationResult> {
        const endpoint = isVideo ? '/api/videos' : '/api/images';

        const response = await fetch(endpoint, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'X-Idempotency-Key': createIdempotencyKey(isVideo ? 'video' : 'image'),
            },
            body: JSON.stringify({
                threadId,
                model,
                prompt,
                attachments,
            }),
            signal,
        });

        const payload = await response.json().catch(() => ({})) as Record<string, unknown>;

        if (!response.ok) {
            const errorMessage =
                typeof payload.error === 'string'
                    ? payload.error
                    : (
                        isVideo
                            ? 'Failed to generate video'
                            : (attachments.length > 0 ? 'Failed to edit image' : 'Failed to generate image')
                    );
            throw new Error(errorMessage);
        }

        const attachment = isAttachment(payload.attachment) ? payload.attachment : null;
        if (!attachment) {
            throw new Error(isVideo
                ? 'Video generation did not return a valid attachment'
                : 'Image generation did not return a valid attachment');
        }

        const revisedPrompt = typeof payload.revisedPrompt === 'string'
            ? payload.revisedPrompt.trim()
            : '';
        const operation = typeof payload.operation === 'string' ? payload.operation : '';
        const isEditOperation = !isVideo && (operation === 'edit' || attachments.length > 0);

        const assistantContent = revisedPrompt
            ? `${isVideo ? 'Generated video.' : (isEditOperation ? 'Edited image.' : 'Generated image.')}\nPrompt rewrite: ${revisedPrompt}`
            : (isVideo ? 'Generated video.' : (isEditOperation ? 'Edited image.' : 'Generated image.'));

        return {
            attachment,
            content: assistantContent,
            operation,
            revisedPrompt,
        };
    }

    async *streamChat({
        messages,
        model,
        reasoningEffort,
        systemPrompt,
        search,
        signal,
    }: ChatStreamParams): AsyncGenerator<StreamChunk, void, unknown> {
        const isBrowserRuntime = typeof window !== 'undefined' && typeof document !== 'undefined';
        if (isBrowserRuntime) {
            yield* this.streamChatWithFetchEventSource({
                messages,
                model,
                reasoningEffort,
                systemPrompt,
                search,
                signal,
            });
            return;
        }
        yield* this.streamChatWithTransport({
            messages,
            model,
            reasoningEffort,
            systemPrompt,
            search,
            signal,
        });
    }

    private async *streamChatWithFetchEventSource({
        messages,
        model,
        reasoningEffort,
        systemPrompt,
        search,
        signal,
    }: ChatStreamParams): AsyncGenerator<StreamChunk, void, unknown> {
        const streamId = createIdempotencyKey('chat');
        const queue: StreamQueueEntry[] = [];
        let queueResolve: (() => void) | null = null;
        let streamError: Error | null = null;
        let streamDone = false;

        const flushQueueWaiter = () => {
            if (queueResolve) {
                queueResolve();
                queueResolve = null;
            }
        };
        const enqueue = (entry: StreamQueueEntry) => {
            queue.push(entry);
            flushQueueWaiter();
        };
        const waitForQueue = () => {
            if (queue.length > 0 || streamDone) {
                return Promise.resolve();
            }
            return new Promise<void>((resolve) => {
                queueResolve = resolve;
            });
        };

        const handleMessage = (message: EventSourceMessage) => {
            if (!message.data || message.data === '[DONE]') {
                return;
            }
            let parsed: unknown;
            try {
                parsed = JSON.parse(message.data);
            } catch {
                return;
            }
            if (!parsed || typeof parsed !== 'object') return;
            const chunk = parsed as UIMessageChunk;
            const mapped = mapUiChunkToStreamChunk(chunk);
            if (mapped) {
                enqueue({ type: 'chunk', chunk: mapped });
            }
        };

        const streamPromise = fetchEventSource('/api/chat', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'X-Idempotency-Key': streamId,
            },
            body: JSON.stringify({
                messages,
                model,
                reasoningEffort,
                systemPrompt,
                search,
            }),
            signal,
            openWhenHidden: true,
            async onopen(response) {
                if (response.ok) {
                    return;
                }
                const fallback = `Failed to get response (${response.status})`;
                try {
                    const text = await response.text();
                    if (!text) {
                        throw new Error(fallback);
                    }
                    let message = text.trim() || fallback;
                    try {
                        const payload = JSON.parse(text) as Record<string, unknown>;
                        message = normalizeResponseErrorPayload(payload, message);
                    } catch {
                        // Non-JSON error body, use text as-is.
                    }
                    throw new Error(message);
                } catch (error) {
                    throw new Error(normalizeTransportError(error));
                }
            },
            onmessage(message) {
                try {
                    handleMessage(message);
                } catch (error) {
                    streamError = error instanceof Error ? error : new Error('Failed to parse stream message');
                    throw streamError;
                }
            },
            onclose() {
                streamDone = true;
                enqueue({ type: 'done' });
            },
            onerror(error) {
                const normalized = new Error(normalizeTransportError(error));
                streamError = normalized;
                enqueue({ type: 'error', error: normalized });
                throw normalized;
            },
        }).catch((error) => {
            if (signal?.aborted) {
                return;
            }
            if (!streamError) {
                const normalized = new Error(normalizeTransportError(error));
                streamError = normalized;
                enqueue({ type: 'error', error: normalized });
            }
        }).finally(() => {
            streamDone = true;
            enqueue({ type: 'done' });
        });

        while (true) {
            await waitForQueue();
            while (queue.length > 0) {
                const entry = queue.shift() as StreamQueueEntry;
                if (entry.type === 'chunk') {
                    yield entry.chunk;
                    continue;
                }
                if (entry.type === 'error') {
                    throw entry.error;
                }
                if (entry.type === 'done') {
                    await streamPromise;
                    if (streamError) {
                        throw streamError;
                    }
                    return;
                }
            }
        }
    }

    private async *streamChatWithTransport({
        messages,
        model,
        reasoningEffort,
        systemPrompt,
        search,
        signal,
    }: ChatStreamParams): AsyncGenerator<StreamChunk, void, unknown> {
        const streamId = createIdempotencyKey('chat');
        let stream: ReadableStream<UIMessageChunk>;
        try {
            stream = await transport.sendMessages({
                trigger: 'submit-message',
                chatId: 'pluto-chat',
                messageId: undefined,
                messages: [],
                body: {
                    messagesPayload: messages,
                    model,
                    reasoningEffort,
                    systemPrompt,
                    search,
                },
                headers: {
                    'X-Idempotency-Key': streamId,
                },
                abortSignal: signal,
            });
        } catch (error) {
            throw new Error(normalizeTransportError(error));
        }

        const reader = stream.getReader();
        try {
            while (true) {
                const { done, value } = await reader.read();
                if (done) break;
                const chunk = value as UIMessageChunk;
                const mapped = mapUiChunkToStreamChunk(chunk);
                if (mapped) {
                    yield mapped;
                }
            }
        } finally {
            reader.releaseLock();
        }
    }
}

export const chatService = new ChatService();
