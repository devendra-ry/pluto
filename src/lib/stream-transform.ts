/**
 * Processes a source SSE stream, handles chunk buffering to ensure lines aren't broken,
 * and transforms <think> tags into reasoning_content.
 */
export async function processAndTransformStream(
    sourceStream: ReadableStream,
    controller: ReadableStreamDefaultController,
    signal?: AbortSignal
) {
    const reader = sourceStream.getReader();
    const decoder = new TextDecoder();
    const encoder = new TextEncoder();
    let isThinking = false;
    let buffer = '';

    const safeEnqueue = (chunk: string | Uint8Array) => {
        try {
            if (signal?.aborted) return;
            const encoded = typeof chunk === 'string' ? encoder.encode(chunk) : chunk;
            controller.enqueue(encoded);
        } catch { }
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
                        let remaining = content;

                        while (remaining.length > 0) {
                            if (!isThinking) {
                                const thinkStartIdx = remaining.indexOf('<think>');
                                if (thinkStartIdx !== -1) {
                                    newContent += remaining.slice(0, thinkStartIdx);
                                    isThinking = true;
                                    remaining = remaining.slice(thinkStartIdx + 7);
                                } else {
                                    newContent += remaining;
                                    remaining = '';
                                }
                            } else {
                                const thinkEndIdx = remaining.indexOf('</think>');
                                if (thinkEndIdx !== -1) {
                                    newReasoning += remaining.slice(0, thinkEndIdx);
                                    isThinking = false;
                                    remaining = remaining.slice(thinkEndIdx + 8);
                                } else {
                                    newReasoning += remaining;
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
                } catch {
                    safeEnqueue(line + '\n');
                }
            }
        }
    } finally {
        reader.releaseLock();
    }
}
