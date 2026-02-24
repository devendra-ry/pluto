/**
 * Processes a source SSE stream, handles chunk buffering to ensure lines aren't broken,
 * and transforms <think> tags into reasoning_content.
 */

/** Module-level singleton — TextEncoder is stateless. */
const sharedEncoder = new TextEncoder();

export async function processAndTransformStream(
    sourceStream: ReadableStream,
    controller: ReadableStreamDefaultController,
    signal?: AbortSignal
) {
    const reader = sourceStream.getReader();
    const decoder = new TextDecoder();
    const isDev = process.env.NODE_ENV !== 'production';
    let isThinking = false;
    let buffer = '';
    let pendingTagFragment = '';

    const THINK_START_TAG = '<think>';
    const THINK_END_TAG = '</think>';

    const safeEnqueue = (chunk: string | Uint8Array) => {
        try {
            if (signal?.aborted) return;
            const encoded = typeof chunk === 'string' ? sharedEncoder.encode(chunk) : chunk;
            controller.enqueue(encoded);
        } catch (error) {
            if (isDev) {
                console.warn('[stream-transform] Failed to enqueue chunk', error);
            }
        }
    };

    const flushPendingTagFragment = () => {
        if (!pendingTagFragment) return;
        const tailData = JSON.stringify({
            choices: [{
                delta: {
                    content: isThinking ? undefined : pendingTagFragment,
                    reasoning_content: isThinking ? pendingTagFragment : undefined
                }
            }]
        });
        safeEnqueue(`data: ${tailData}\n\n`);
        pendingTagFragment = '';
    };

    const splitTrailingTagFragment = (text: string, tag: string) => {
        const maxFragmentLen = Math.min(tag.length - 1, text.length);
        for (let len = maxFragmentLen; len > 0; len--) {
            if (text.endsWith(tag.slice(0, len))) {
                return {
                    emittable: text.slice(0, -len),
                    fragment: text.slice(-len)
                };
            }
        }
        return { emittable: text, fragment: '' };
    };

    try {
        while (true) {
            if (signal?.aborted) break;

            const { done, value } = await reader.read();
            if (done) break;

            buffer += decoder.decode(value, { stream: true });
            const lines = buffer.split('\n');
            // Keep the last partial line in the buffer
            buffer = lines.pop() || '';

            for (const line of lines) {
                if (signal?.aborted) break;

                const trimmedLine = line.trim();
                if (!trimmedLine) continue;

                if (!trimmedLine.startsWith('data: ')) {
                    safeEnqueue(line + '\n');
                    continue;
                }

                const dataStr = trimmedLine.slice(6);
                if (dataStr === '[DONE]') {
                    flushPendingTagFragment();
                    safeEnqueue('data: [DONE]\n\n');
                    continue;
                }

                try {
                    const parsed = JSON.parse(dataStr);
                    const choice = parsed.choices?.[0];
                    const delta = choice?.delta;
                    const content = delta?.content || '';
                    const reasoning = delta?.reasoning_content || delta?.reasoning || delta?.thinking || '';

                    if (content || reasoning) {
                        let newContent = '';
                        let newReasoning = reasoning;
                        let remaining = pendingTagFragment + content;
                        pendingTagFragment = '';

                        while (remaining.length > 0) {
                            if (!isThinking) {
                                const thinkStartIdx = remaining.indexOf(THINK_START_TAG);
                                if (thinkStartIdx !== -1) {
                                    newContent += remaining.slice(0, thinkStartIdx);
                                    isThinking = true;
                                    remaining = remaining.slice(thinkStartIdx + THINK_START_TAG.length);
                                } else {
                                    const { emittable, fragment } = splitTrailingTagFragment(remaining, THINK_START_TAG);
                                    newContent += emittable;
                                    pendingTagFragment = fragment;
                                    remaining = '';
                                }
                            } else {
                                const thinkEndIdx = remaining.indexOf(THINK_END_TAG);
                                if (thinkEndIdx !== -1) {
                                    newReasoning += remaining.slice(0, thinkEndIdx);
                                    isThinking = false;
                                    remaining = remaining.slice(thinkEndIdx + THINK_END_TAG.length);
                                } else {
                                    const { emittable, fragment } = splitTrailingTagFragment(remaining, THINK_END_TAG);
                                    newReasoning += emittable;
                                    pendingTagFragment = fragment;
                                    remaining = '';
                                }
                            }
                        }

                        const transformedData = JSON.stringify({
                            ...parsed,
                            choices: [{
                                ...choice,
                                delta: {
                                    ...delta,
                                    content: newContent || undefined,
                                    reasoning_content: newReasoning || undefined
                                }
                            }]
                        });
                        safeEnqueue(`data: ${transformedData}\n\n`);
                    } else {
                        // Pass through non-content chunks (reasoning, metadata)
                        safeEnqueue(`data: ${dataStr}\n\n`);
                    }
                } catch (error) {
                    if (isDev) {
                        console.warn('[stream-transform] Failed to parse SSE data chunk', error);
                    }
                    safeEnqueue(line + '\n');
                }
            }
        }

        // Flush any unresolved trailing fragment so no model text is dropped at stream end.
        flushPendingTagFragment();
    } finally {
        reader.releaseLock();
    }
}