import { sharedTextEncoder } from '@/shared/lib/text-encoder';

/**
 * Replays cached SSE events from `byteOffset`. Events are sent verbatim —
 * never append a synthetic `[DONE]`; callers must ensure the stream is
 * complete (last event is `[DONE]`) before replaying, otherwise clients
 * would persist a truncated response as finished.
 */
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

    const stream = new ReadableStream({
        pull(controller) {
            const event = events[startIndex];
            if (event === undefined) {
                controller.close();
                return;
            }
            startIndex += 1;
            controller.enqueue(sharedTextEncoder.encode(`data: ${event}\n\n`));
        }
    });

    return new Response(stream, {
        headers: {
            'Content-Type': 'text/event-stream',
            'Cache-Control': 'no-cache',
            'Connection': 'keep-alive',
            'X-Accel-Buffering': 'no',
        },
    });
}
