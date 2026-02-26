import { sharedTextEncoder } from '@/shared/lib/text-encoder';

export function buildSseReplayResponse(events: string[], byteOffset: number = 0) {
    // Each cached event was originally sent as `data: ${event}\n\n`.
    // Reconstruct cumulative byte lengths to find the first un-acked event.
    let accumulated = 0;
    let startIndex = 0;

    if (byteOffset > 0) {
        for (let i = 0; i < events.length; i++) {
            const eventBytes = sharedTextEncoder.encode(`data: ${events[i]}\n\n`).byteLength;
            if (accumulated + eventBytes <= byteOffset) {
                accumulated += eventBytes;
                startIndex = i + 1;
            } else {
                break;
            }
        }
    }

    const replayEvents = events.slice(startIndex);

    const stream = new ReadableStream({
        start(controller) {
            for (const event of replayEvents) {
                controller.enqueue(sharedTextEncoder.encode(`data: ${event}\n\n`));
            }
            if (replayEvents.length === 0 || replayEvents[replayEvents.length - 1] !== '[DONE]') {
                controller.enqueue(sharedTextEncoder.encode('data: [DONE]\n\n'));
            }
            controller.close();
        }
    });

    return new Response(stream, {
        headers: {
            'Content-Type': 'text/event-stream',
            'Cache-Control': 'no-cache',
            'Connection': 'keep-alive',
            'X-Vercel-AI-UI-Message-Stream': 'v1',
            'X-Accel-Buffering': 'no',
        },
    });
}
