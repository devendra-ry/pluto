import { ChatRequestSchema } from '@/lib/types';
import { AVAILABLE_MODELS } from '@/lib/constants';

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
