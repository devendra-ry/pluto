import { ChatRequestSchema, ChatMessage } from '@/lib/types';
import { AVAILABLE_MODELS } from '@/lib/constants';
import { GoogleGenAI } from '@google/genai';
import { OpenRouter } from '@openrouter/sdk';

export const runtime = 'edge';

export async function POST(req: Request) {
    const encoder = new TextEncoder();
    const signal = req.signal;

    // Helper to safely enqueue data without crashing if the stream is closed
    const safeEnqueue = (controller: ReadableStreamDefaultController, chunk: string | Uint8Array) => {
        try {
            if (signal.aborted) return;
            const encoded = typeof chunk === 'string' ? encoder.encode(chunk) : chunk;
            controller.enqueue(encoded);
        } catch (e) {
            // Ignore closed controller errors
        }
    };

    // Create the stream first so we can return the Response immediately
    const stream = new ReadableStream({
        async start(controller) {
            let heartbeatInterval: any;

            if (signal.aborted) return;

            try {
                const body = await req.json();

                // Validate request body with Zod
                const parseResult = ChatRequestSchema.safeParse(body);
                if (!parseResult.success) {
                    safeEnqueue(controller, `data: ${JSON.stringify({ error: 'Invalid request' })}\n\n`);
                    controller.close();
                    return;
                }

                const { messages, model, reasoningEffort } = parseResult.data;
                const modelConfig = AVAILABLE_MODELS.find(m => m.id === model);

                // Start heartbeat to keep connection alive while waiting for AI
                heartbeatInterval = setInterval(() => {
                    safeEnqueue(controller, ': keep-alive\n\n');
                }, 15000);

                let sourceStream: ReadableStream;

                if (modelConfig?.provider === 'google') {
                    sourceStream = await getGoogleStream(model, messages, reasoningEffort, signal);
                } else if (modelConfig?.provider === 'openrouter') {
                    sourceStream = await getOpenRouterStream(model, messages, reasoningEffort, signal);
                } else {
                    sourceStream = await getChutesStream(model, messages, reasoningEffort || 'low', modelConfig, signal);
                }

                // Clear heartbeat once we have the source stream
                if (heartbeatInterval) clearInterval(heartbeatInterval);

                // Process the stream with robust buffering and thinking-tag transformation
                await processAndTransformStream(sourceStream, controller, signal);

                if (!signal.aborted) {
                    controller.close();
                }
            } catch (error) {
                if (heartbeatInterval) clearInterval(heartbeatInterval);

                // Only log and send errors if the client hasn't already disconnected
                if (!signal.aborted) {
                    console.error('Chat API error:', error);
                    const errorMsg = error instanceof Error ? error.message : 'Unknown error';
                    safeEnqueue(controller, `data: ${JSON.stringify({ error: 'AI service error', details: errorMsg })}\n\n`);
                    try { controller.close(); } catch (e) { }
                }
            }
        }
    });

    return new Response(stream, {
        headers: {
            'Content-Type': 'text/event-stream',
            'Cache-Control': 'no-cache',
            'Connection': 'keep-alive',
        },
    });
}

async function getChutesStream(model: string, messages: ChatMessage[], reasoningEffort: string = 'low', modelConfig: any, signal?: AbortSignal) {
    const requestBody: Record<string, unknown> = {
        model,
        messages,
        stream: true,
        temperature: 1.0,
        top_p: 0.95,
        max_tokens: 65536,
    };

    if (reasoningEffort) requestBody.reasoning_effort = reasoningEffort;
    if (modelConfig?.usesThinkingParam) {
        requestBody.chat_template_kwargs = { thinking: reasoningEffort !== 'low' };
    }

    const response = await fetch('https://llm.chutes.ai/v1/chat/completions', {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${process.env.CHUTES_API_KEY}`,
        },
        body: JSON.stringify(requestBody),
        signal,
    });

    if (!response.ok) throw new Error(`Chutes API error: ${response.statusText}`);
    return response.body as ReadableStream;
}

async function getGoogleStream(model: string, messages: ChatMessage[], reasoningEffort: string = 'low', signal?: AbortSignal) {
    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey) throw new Error('Gemini API key missing');

    const ai = new GoogleGenAI({ apiKey });
    const contents = messages.map(msg => ({
        role: msg.role === 'assistant' ? 'model' : 'user',
        parts: [{ text: msg.content }]
    }));

    const config: { maxOutputTokens: number, thinkingConfig?: { includeThoughts: boolean, thinkingLevel?: string, thinkingBudget?: number } } = { maxOutputTokens: 65536 };
    const modelConfig = AVAILABLE_MODELS.find(m => m.id === model);

    if (modelConfig?.supportsReasoning && reasoningEffort) {
        config.thinkingConfig = { includeThoughts: true };
        const isGemini3 = model.startsWith('gemini-3');
        if (isGemini3) {
            const levelMap: Record<string, string> = { low: 'MINIMAL', medium: 'LOW', high: 'HIGH' };
            config.thinkingConfig.thinkingLevel = (levelMap[reasoningEffort] || 'LOW') as any;
        } else {
            const isFlash = model.includes('flash');
            const maxBudget = isFlash ? 24576 : 32768;
            const budgetMap: Record<string, number> = { low: 0, medium: -1, high: maxBudget };
            config.thinkingConfig.thinkingBudget = budgetMap[reasoningEffort] ?? -1;
        }
    }

    const response = await ai.models.generateContentStream({ model, config, contents });

    const encoder = new TextEncoder();
    return new ReadableStream({
        async start(controller) {
            try {
                for await (const chunk of response) {
                    if (signal?.aborted) break;

                    const candidate = chunk.candidates?.[0];
                    if (!candidate?.content?.parts) continue;
                    for (const part of candidate.content.parts) {
                        if (!part.text) continue;
                        const data = JSON.stringify({
                            choices: [{
                                delta: {
                                    content: part.thought ? undefined : part.text,
                                    reasoning_content: part.thought ? part.text : undefined
                                },
                                index: 0,
                                finish_reason: null
                            }]
                        });
                        controller.enqueue(encoder.encode(`data: ${data}\n\n`));
                    }
                }
                if (!signal?.aborted) {
                    controller.enqueue(encoder.encode('data: [DONE]\n\n'));
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

async function getOpenRouterStream(model: string, messages: ChatMessage[], reasoningEffort: string = 'low', signal?: AbortSignal) {
    const apiKey = process.env.OPENROUTER_API_KEY;
    const openRouter = new OpenRouter({
        apiKey: apiKey || '',
        httpReferer: process.env.VERCEL_URL ? `https://${process.env.VERCEL_URL}` : "http://localhost:3000",
        xTitle: "Pluto Chat",
    });

    const response = await openRouter.chat.send({
        chatGenerationParams: {
            model,
            messages: messages.map(msg => ({ role: msg.role, content: msg.content })),
            stream: true,
            maxTokens: 65536,
            reasoning: { effort: reasoningEffort as any }
        }
    });

    const encoder = new TextEncoder();
    return new ReadableStream({
        async start(controller) {
            try {
                for await (const chunk of response) {
                    if (signal?.aborted) break;

                    const delta = chunk.choices?.[0]?.delta;
                    if (delta && (delta.content || delta.reasoning)) {
                        const data = JSON.stringify({
                            choices: [{
                                delta: {
                                    content: delta.content ?? undefined,
                                    reasoning_content: delta.reasoning ?? undefined
                                },
                                index: 0,
                                finish_reason: null
                            }]
                        });
                        controller.enqueue(encoder.encode(`data: ${data}\n\n`));
                    }
                }
                if (!signal?.aborted) {
                    controller.enqueue(encoder.encode('data: [DONE]\n\n'));
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

/**
 * Processes a source SSE stream, handles chunk buffering to ensure lines aren't broken,
 * and transforms <think> tags into reasoning_content.
 */
async function processAndTransformStream(sourceStream: ReadableStream, controller: ReadableStreamDefaultController, signal?: AbortSignal) {
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
        } catch (e) { }
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
                    const reasoning = delta?.reasoning_content || '';

                    if (content) {
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
                } catch (e) {
                    safeEnqueue(line + '\n');
                }
            }
        }
    } finally {
        reader.releaseLock();
    }
}

