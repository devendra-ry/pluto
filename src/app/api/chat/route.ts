export async function POST(req: Request) {
    try {
        const { messages, model, reasoningEffort } = await req.json();

        // Build request body with optional reasoning effort
        const requestBody: Record<string, unknown> = {
            model,
            messages,
            stream: true,
        };

        // Add reasoning effort if specified (for models that support it)
        if (reasoningEffort && reasoningEffort !== 'low') {
            requestBody.reasoning_effort = reasoningEffort;
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
                JSON.stringify({ error: 'AI API error', details: errorText }),
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
