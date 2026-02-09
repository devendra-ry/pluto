import { ChatRequestSchema, ChatMessage } from '@/lib/types';
import { AVAILABLE_MODELS } from '@/lib/constants';
import { GoogleGenAI } from '@google/genai';
import { OpenRouter } from '@openrouter/sdk';

export async function POST(req: Request) {
    try {
        const body = await req.json();

        // Validate request body with Zod
        const parseResult = ChatRequestSchema.safeParse(body);
        if (!parseResult.success) {
            return new Response(
                JSON.stringify({
                    error: 'Invalid request',
                    details: parseResult.error.flatten().fieldErrors
                }),
                { status: 400, headers: { 'Content-Type': 'application/json' } }
            );
        }

        const { messages, model, reasoningEffort } = parseResult.data;

        // Find model config
        const modelConfig = AVAILABLE_MODELS.find(m => m.id === model);

        // Handle Google models
        if (modelConfig?.provider === 'google') {
            return handleGoogleModel(model, messages, reasoningEffort);
        }

        // Handle OpenRouter models
        if (modelConfig?.provider === 'openrouter') {
            return handleOpenRouterModel(model, messages, reasoningEffort);
        }

        // Build request body with optional reasoning effort
        const requestBody: Record<string, unknown> = {
            model,
            messages,
            stream: true,
            temperature: 1.0,
            top_p: 0.95,
        };

        // Add reasoning effort if specified (for models that support it)
        if (reasoningEffort) {
            requestBody.reasoning_effort = reasoningEffort;
        }

        // Handle Kimi model's special thinking parameter
        if (modelConfig?.usesThinkingParam) {
            const enableThinking = reasoningEffort !== 'low';
            requestBody.chat_template_kwargs = { thinking: enableThinking };
        }

        // Check API key
        if (!process.env.CHUTES_API_KEY) {
            console.error('CHUTES_API_KEY is not configured');
            return new Response(
                JSON.stringify({ error: 'API configuration error' }),
                { status: 500, headers: { 'Content-Type': 'application/json' } }
            );
        }

        // Direct call to Chutes API (OpenAI-compatible endpoint)
        const response = await fetch('https://llm.chutes.ai/v1/chat/completions', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${process.env.CHUTES_API_KEY}`,
            },
            body: JSON.stringify(requestBody),
        });

        if (!response.ok) {
            const errorText = await response.text();
            console.error('Chutes API error:', errorText);
            return new Response(
                JSON.stringify({ error: 'AI service unavailable' }),
                { status: response.status, headers: { 'Content-Type': 'application/json' } }
            );
        }

        // Stream the response and transform thinking tags
        return new Response(transformThinkingStream(response.body as any), {
            headers: {
                'Content-Type': 'text/event-stream',
                'Cache-Control': 'no-cache',
                'Connection': 'keep-alive',
            },
        });
    } catch (error) {
        console.error('Chat API error:', error);
        return new Response(
            JSON.stringify({ error: 'Failed to generate response' }),
            { status: 500, headers: { 'Content-Type': 'application/json' } }
        );
    }
}

// Helper to handle Google GenAI models
async function handleGoogleModel(model: string, messages: ChatMessage[], reasoningEffort: string = 'low') {
    const apiKey = process.env.GEMINI_API_KEY;

    if (!apiKey) {
        return new Response(
            JSON.stringify({ error: 'Gemini API key is not configured' }),
            { status: 500, headers: { 'Content-Type': 'application/json' } }
        );
    }

    const ai = new GoogleGenAI({
        apiKey: apiKey,
    });

    // Convert messages to Google format
    const contents = messages.map(msg => ({
        role: msg.role === 'assistant' ? 'model' : 'user',
        parts: [{ text: msg.content }]
    }));

    const config: any = {};
    const modelConfig = AVAILABLE_MODELS.find(m => m.id === model);

    if (modelConfig?.supportsReasoning) {
        config.thinkingConfig = {
            includeThoughts: true,
        };

        // Determine if we use thinkingLevel (Gemini 3) or thinkingBudget (Gemini 2.5)
        const isGemini3 = model.startsWith('gemini-3');

        if (isGemini3) {
            const levelMap: Record<string, string> = {
                low: 'MINIMAL',
                medium: 'LOW',
                high: 'HIGH'
            };
            config.thinkingConfig.thinkingLevel = (levelMap[reasoningEffort] || 'LOW') as any;
        } else {
            const isFlash = model.includes('flash');
            const maxBudget = isFlash ? 24576 : 32768;

            const budgetMap: Record<string, number> = {
                low: 0,
                medium: -1, // Dynamic
                high: maxBudget
            };
            config.thinkingConfig.thinkingBudget = budgetMap[reasoningEffort] ?? -1;
        }
    }

    // Use the pattern from the user's snippet
    const response = await ai.models.generateContentStream({
        model,
        config,
        contents,
    });

    const encoder = new TextEncoder();
    const stream = new ReadableStream({
        async start(controller) {
            try {
                for await (const chunk of response) {
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
                controller.enqueue(encoder.encode('data: [DONE]\n\n'));
                controller.close();
            } catch (error) {
                console.error('Google stream error:', error);
                controller.error(error);
            }
        },
    });

    return new Response(stream, {
        headers: {
            'Content-Type': 'text/event-stream',
            'Cache-Control': 'no-cache',
            'Connection': 'keep-alive',
        },
    });
}

// Helper to handle OpenRouter models
async function handleOpenRouterModel(model: string, messages: ChatMessage[], reasoningEffort: string = 'low') {
    const apiKey = process.env.OPENROUTER_API_KEY;

    const openRouter = new OpenRouter({
        apiKey: apiKey || '',
        // OpenRouter recommends these headers for site rankings and to avoid some 401/403 errors
        httpReferer: process.env.VERCEL_URL ? `https://${process.env.VERCEL_URL}` : "http://localhost:3000",
        xTitle: "Pluto Chat",
    });

    const response = await openRouter.chat.send({
        chatGenerationParams: {
            model,
            messages: messages.map(msg => ({
                role: msg.role,
                content: msg.content
            })),
            stream: true,
            reasoning: {
                effort: reasoningEffort as any
            }
        }
    });

    const encoder = new TextEncoder();
    const stream = new ReadableStream({
        async start(controller) {
            try {
                for await (const chunk of response) {
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
                controller.enqueue(encoder.encode('data: [DONE]\n\n'));
                controller.close();
            } catch (error) {
                console.error('OpenRouter stream error:', error);
                controller.error(error);
            }
        },
    });

    // Wrap OpenRouter stream to handle <think> tags if they exist in content
    return new Response(transformThinkingStream(stream), {
        headers: {
            'Content-Type': 'text/event-stream',
            'Cache-Control': 'no-cache',
            'Connection': 'keep-alive',
        },
    });
}

/**
 * Transforms an SSE stream by parsing <think> tags in the 'content' field
 * and moving them to 'reasoning_content'.
 */
function transformThinkingStream(sourceStream: ReadableStream) {
    const encoder = new TextEncoder();
    const decoder = new TextDecoder();
    let isThinking = false;
    let buffer = '';

    return new ReadableStream({
        async start(controller) {
            const reader = sourceStream.getReader();

            try {
                while (true) {
                    const { done, value } = await reader.read();
                    if (done) break;

                    const chunk = decoder.decode(value, { stream: true });
                    const lines = chunk.split('\n');

                    for (const line of lines) {
                        if (!line.startsWith('data: ')) {
                            if (line.trim()) controller.enqueue(encoder.encode(line + '\n'));
                            continue;
                        }

                        const dataStr = line.slice(6).trim();
                        if (dataStr === '[DONE]') {
                            controller.enqueue(encoder.encode('data: [DONE]\n\n'));
                            continue;
                        }

                        try {
                            const parsed = JSON.parse(dataStr);
                            const choice = parsed.choices?.[0];
                            const delta = choice?.delta;
                            let content = delta?.content || '';
                            let reasoning = delta?.reasoning_content || '';

                            if (content) {
                                let newContent = '';
                                let newReasoning = reasoning;

                                // Very simple state-machine parsing for <think> tags across chunks
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

                                // Re-emit JSON with swapped content/reasoning
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
                                controller.enqueue(encoder.encode(`data: ${transformedData}\n\n`));
                            } else if (reasoning) {
                                // Already have reasoning, just pass through
                                controller.enqueue(encoder.encode(`data: ${dataStr}\n\n`));
                            } else {
                                // Other metadata, pass through
                                controller.enqueue(encoder.encode(`data: ${dataStr}\n\n`));
                            }
                        } catch (e) {
                            // If JSON parsing fails, just pass the raw line
                            controller.enqueue(encoder.encode(line + '\n'));
                        }
                    }
                }
            } catch (err) {
                controller.error(err);
            } finally {
                reader.releaseLock();
                controller.close();
            }
        }
    });
}
