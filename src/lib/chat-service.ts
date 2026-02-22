import { type Attachment, type ChatMessage, type ReasoningEffort } from '@/lib/types';

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
            headers: { 'Content-Type': 'application/json' },
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
        const response = await fetch('/api/chat', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                messages,
                model,
                reasoningEffort,
                systemPrompt,
                search,
            }),
            signal,
        });

        if (!response.ok) {
            let message = `Failed to get response (${response.status})`;
            try {
                const payload = await response.json() as Record<string, unknown>;
                const errorText = typeof payload.error === 'string' ? payload.error : '';
                const detailsText = typeof payload.details === 'string' ? payload.details : '';
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

        const decoder = new TextDecoder();
        let buffer = '';

        while (true) {
            const { done, value } = await reader.read();
            if (done) break;

            buffer += decoder.decode(value, { stream: true });
            const lines = buffer.split('\n');
            buffer = lines.pop() || '';

            for (const line of lines) {
                if (line.startsWith('data: ')) {
                    const data = line.slice(6);
                    if (data === '[DONE]') continue;

                    try {
                        const parsed = JSON.parse(data) as Record<string, unknown>;
                        const streamError = typeof parsed.error === 'string' ? parsed.error.trim() : '';

                        if (streamError) {
                            const streamDetails = typeof parsed.details === 'string' ? parsed.details.trim() : '';
                            const normalizedStreamError = streamDetails ? `${streamError}: ${streamDetails}` : streamError;
                            throw new Error(`STREAM_ERROR:${normalizedStreamError}`);
                        }

                        const choices = Array.isArray(parsed.choices)
                            ? parsed.choices as Array<Record<string, unknown>>
                            : [];
                        const delta = (choices[0]?.delta ?? {}) as Record<string, unknown>;

                        const reasoningContent =
                            (typeof delta.reasoning_content === 'string' ? delta.reasoning_content : '') ||
                            (typeof delta.thinking === 'string' ? delta.thinking : '');

                        if (reasoningContent) {
                            yield { type: 'reasoning', value: reasoningContent };
                        }

                        const content = typeof delta.content === 'string' ? delta.content : '';
                        if (content) {
                            yield { type: 'content', value: content };
                        }
                    } catch (streamChunkError) {
                         if (
                            streamChunkError instanceof Error
                            && streamChunkError.message.startsWith('STREAM_ERROR:')
                        ) {
                            throw new Error(streamChunkError.message.slice('STREAM_ERROR:'.length));
                        }
                        // Skip malformed JSON
                    }
                }
            }
        }
    }
}

export const chatService = new ChatService();
