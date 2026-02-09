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
            return handleGoogleModel(model, messages);
        }

        // Handle OpenRouter models
        if (modelConfig?.provider === 'openrouter') {
            return handleOpenRouterModel(model, messages);
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
        if (reasoningEffort && reasoningEffort !== 'low') {
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

        // Stream the response directly
        return new Response(response.body, {
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
async function handleGoogleModel(model: string, messages: ChatMessage[]) {
    const ai = new GoogleGenAI({
        apiKey: process.env.GEMINI_API_KEY || '',
    });

    // Convert messages to Google format
    const contents = messages.map(msg => ({
        role: msg.role === 'assistant' ? 'model' : 'user',
        parts: [{ text: msg.content }]
    }));

    const config: { thinkingConfig?: { includeThoughts: boolean } } = {};
    if (model === 'gemini-3-flash-preview') {
        config.thinkingConfig = {
            includeThoughts: true,
        };
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
                    const text = chunk.text;
                    if (text) {
                        const data = JSON.stringify({
                            choices: [{
                                delta: { content: text },
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
async function handleOpenRouterModel(model: string, messages: ChatMessage[]) {
    const openRouter = new OpenRouter({
        apiKey: process.env.OPENROUTER_API_KEY || '',
    });

    const response = await openRouter.chat.send({
        chatGenerationParams: {
            model,
            messages: messages.map(msg => ({
                role: msg.role,
                content: msg.content
            })),
            stream: true,
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

    return new Response(stream, {
        headers: {
            'Content-Type': 'text/event-stream',
            'Cache-Control': 'no-cache',
            'Connection': 'keep-alive',
        },
    });
}
