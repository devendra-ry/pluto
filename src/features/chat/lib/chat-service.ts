import { type Attachment, type ChatMessage, type ReasoningEffort } from '@/shared/core/types';
import { createIdempotencyKey } from '@/shared/lib/idempotency';
import { DefaultChatTransport, type UIMessage, type UIMessageChunk } from 'ai';
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
                if (chunk.type === 'error') {
                    throw new Error(chunk.errorText || 'Unable to complete request right now. Please try again.');
                }
                if (chunk.type === 'reasoning-delta') {
                    if (chunk.delta) {
                        yield { type: 'reasoning', value: chunk.delta };
                    }
                    continue;
                }
                if (chunk.type === 'text-delta') {
                    if (chunk.delta) {
                        yield { type: 'content', value: chunk.delta };
                    }
                    continue;
                }
                if (chunk.type === 'data-usage') {
                    const usage = parseProviderUsage(chunk.data);
                    if (usage) {
                        yield { type: 'usage', value: usage };
                    }
                }
            }
        } finally {
            reader.releaseLock();
        }
    }
}

export const chatService = new ChatService();
