import { type Attachment, type ChatMessage, type ReasoningEffort } from '@/shared/core/types';
import { createIdempotencyKey } from '@/shared/lib/idempotency';
import { sharedTextEncoder } from '@/shared/lib/text-encoder';

/**
 * Extract a string-typed field value from a JSON string using indexOf,
 * avoiding a full JSON.parse. Handles standard JSON escape sequences.
 * Returns '' if the field is absent, null, or not a string.
 */
function extractJsonStringField(json: string, field: string): string {
    // Look for "field":" pattern — the field must be a string value.
    const needle = `"${field}":"`;
    const start = json.indexOf(needle);
    if (start === -1) return '';

    const valueStart = start + needle.length;
    // Walk forward to find the unescaped closing quote.
    let i = valueStart;
    while (i < json.length) {
        if (json.charCodeAt(i) === 92 /* backslash */) {
            i += 2; // skip escaped character
            continue;
        }
        if (json.charCodeAt(i) === 34 /* quote */) {
            break;
        }
        i++;
    }

    if (i >= json.length) return '';

    const raw = json.substring(valueStart, i);
    // Fast path: no escapes → return as-is (most SSE chunks are plain text).
    if (raw.indexOf('\\') === -1) return raw;
    // Slow path: unescape JSON string escapes.
    try {
        return JSON.parse(`"${raw}"`) as string;
    } catch {
        return raw;
    }
}

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

const MAX_STREAM_RESUME_ATTEMPTS = 2;
const STREAM_BUFFER_WARN_CHARS = 256 * 1024;
const STREAM_BUFFER_MAX_CHARS = 2 * 1024 * 1024;
const IS_DEV = process.env.NODE_ENV !== 'production';

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
        let attempts = 0;
        let resumeByteOffset = 0;

        while (true) {
            const response = await fetch('/api/chat', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'X-Idempotency-Key': streamId,
                    ...(resumeByteOffset > 0 ? { 'X-Chat-Resume-Offset': String(resumeByteOffset) } : {}),
                },
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
            let warnedLargeBuffer = false;

            try {
                while (true) {
                    let readResult: ReadableStreamReadResult<Uint8Array<ArrayBufferLike>>;
                    try {
                        readResult = await reader.read();
                    } catch (readError) {
                        const message = readError instanceof Error ? readError.message : 'stream read failure';
                        throw new Error(`RESUMEABLE_STREAM_READ:${message}`);
                    }

                    const { done, value } = readResult;
                    if (done) {
                        return;
                    }

                    buffer += decoder.decode(value, { stream: true });

                    // indexOf-based line scanner — avoids split() array allocation.
                    let searchFrom = 0;
                    while (true) {
                        const nlIdx = buffer.indexOf('\n', searchFrom);
                        if (nlIdx === -1) break;

                        const line = buffer.substring(searchFrom, nlIdx);
                        searchFrom = nlIdx + 1;

                        if (!line.startsWith('data: ')) continue;
                        const data = line.substring(6);
                        // Track acknowledged bytes by complete SSE data events so resume
                        // offsets stay aligned with replay semantics and avoid decode
                        // boundary drift from partial UTF-8 chunks.
                        resumeByteOffset += sharedTextEncoder.encode(`data: ${data}\n\n`).byteLength;

                        if (data === '[DONE]') continue;

                        try {
                            // Fast path: check for error responses first (rare).
                            if (data.includes('"error"')) {
                                const parsed = JSON.parse(data) as Record<string, unknown>;
                                const streamError = typeof parsed.error === 'string' ? parsed.error.trim() : '';
                                if (streamError) {
                                    const streamDetails = typeof parsed.details === 'string' ? parsed.details.trim() : '';
                                    const normalizedStreamError = streamDetails ? `${streamError}: ${streamDetails}` : streamError;
                                    throw new Error(`STREAM_ERROR:${normalizedStreamError}`);
                                }
                            }

                            // Hot path: extract delta fields directly via indexOf
                            // instead of JSON.parse to avoid allocating a full object.
                            const reasoningContent =
                                extractJsonStringField(data, 'r') ||
                                extractJsonStringField(data, 'reasoning_content') ||
                                extractJsonStringField(data, 'thinking');

                            // Empty-string chunks are intentionally treated as no-op.
                            if (reasoningContent) {
                                yield { type: 'reasoning', value: reasoningContent };
                            }

                            const content =
                                extractJsonStringField(data, 'c') ||
                                extractJsonStringField(data, 'content');
                            // Empty-string chunks are intentionally treated as no-op.
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

                    // Keep only the unconsumed remainder in the buffer.
                    buffer = searchFrom > 0 ? buffer.substring(searchFrom) : buffer;
                    if (!warnedLargeBuffer && buffer.length > STREAM_BUFFER_WARN_CHARS) {
                        warnedLargeBuffer = true;
                        if (IS_DEV) {
                            console.warn(`[chat-service] Large pending SSE buffer (${buffer.length} chars)`);
                        }
                    }
                    if (buffer.length > STREAM_BUFFER_MAX_CHARS) {
                        throw new Error('Stream buffer overflow while parsing SSE response');
                    }
                }
            } catch (error) {
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
            }
        }
    }
}

export const chatService = new ChatService();
