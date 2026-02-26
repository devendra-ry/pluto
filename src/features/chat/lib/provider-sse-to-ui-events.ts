import { processAndTransformStream } from '@/features/chat/lib/stream-transform';
import { parseProviderUsage, type ProviderUsage } from '@/features/chat/lib/provider-usage';

const STREAM_BUFFER_WARN_CHARS = 256 * 1024;
const STREAM_BUFFER_MAX_CHARS = 2 * 1024 * 1024;
const IS_DEV = process.env.NODE_ENV !== 'production';

export interface ParsedProviderSseEvent {
    contentDelta?: string;
    reasoningDelta?: string;
    usage?: ProviderUsage;
    errorText?: string;
}

function getString(value: unknown) {
    return typeof value === 'string' ? value : '';
}

function readDeltaText(payload: Record<string, unknown>) {
    const choices = payload.choices;
    if (!Array.isArray(choices) || choices.length === 0) {
        return { contentDelta: '', reasoningDelta: '' };
    }
    const first = choices[0];
    if (!first || typeof first !== 'object') {
        return { contentDelta: '', reasoningDelta: '' };
    }
    const delta = (first as Record<string, unknown>).delta;
    if (!delta || typeof delta !== 'object') {
        return { contentDelta: '', reasoningDelta: '' };
    }
    const deltaRecord = delta as Record<string, unknown>;
    const reasoningDelta =
        getString(deltaRecord.r)
        || getString(deltaRecord.reasoning_content)
        || getString(deltaRecord.reasoning)
        || getString(deltaRecord.thinking);
    const contentDelta =
        getString(deltaRecord.c)
        || getString(deltaRecord.content);
    return { contentDelta, reasoningDelta };
}

async function getNormalizedSourceStream(
    sourceStream: ReadableStream,
    needsThinkTagTransform: boolean,
    signal?: AbortSignal
) {
    if (!needsThinkTagTransform) {
        return sourceStream as ReadableStream<Uint8Array>;
    }

    return new ReadableStream<Uint8Array>({
        async start(controller) {
            await processAndTransformStream(
                sourceStream,
                controller as unknown as ReadableStreamDefaultController,
                signal
            );
            controller.close();
        }
    });
}

export async function* parseProviderSseToUiEvents({
    sourceStream,
    needsThinkTagTransform,
    signal,
}: {
    sourceStream: ReadableStream;
    needsThinkTagTransform: boolean;
    signal?: AbortSignal;
}): AsyncGenerator<ParsedProviderSseEvent, void, unknown> {
    const normalizedSourceStream = await getNormalizedSourceStream(sourceStream, needsThinkTagTransform, signal);
    const reader = normalizedSourceStream.getReader();
    const decoder = new TextDecoder();
    let buffer = '';
    let warnedLargeBuffer = false;

    try {
        while (true) {
            if (signal?.aborted) break;
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

                let parsed: Record<string, unknown>;
                try {
                    const payload = JSON.parse(data) as unknown;
                    if (!payload || typeof payload !== 'object') {
                        continue;
                    }
                    parsed = payload as Record<string, unknown>;
                } catch {
                    // Skip malformed JSON payloads from upstream chunks.
                    continue;
                }

                const streamError = getString(parsed.error).trim();
                if (streamError) {
                    const details = getString(parsed.details).trim();
                    yield {
                        errorText: details ? `${streamError}: ${details}` : streamError,
                    };
                }

                const usage = parseProviderUsage(parsed);
                if (usage) {
                    yield { usage };
                }

                const { contentDelta, reasoningDelta } = readDeltaText(parsed);
                if (reasoningDelta) {
                    yield { reasoningDelta };
                }
                if (contentDelta) {
                    yield { contentDelta };
                }
            }

            buffer = searchFrom > 0 ? buffer.substring(searchFrom) : buffer;
            if (!warnedLargeBuffer && buffer.length > STREAM_BUFFER_WARN_CHARS) {
                warnedLargeBuffer = true;
                if (IS_DEV) {
                    console.warn(`[provider-sse] Large pending SSE buffer (${buffer.length} chars)`);
                }
            }
            if (buffer.length > STREAM_BUFFER_MAX_CHARS) {
                throw new Error('Stream buffer overflow while parsing provider SSE response');
            }
        }
    } finally {
        reader.releaseLock();
    }
}
