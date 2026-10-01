import assert from 'node:assert/strict';
import { performance } from 'node:perf_hooks';
import { mergeMessagesSorted, type Message } from '../src/features/messages/lib/message-helpers';

// The former realtime merge, retained here only as a reproducible baseline.
function baseline(existing: Message[], incoming: Message[]) {
    const byId = new Map(existing.map((message) => [message.id, message]));
    for (const message of incoming) byId.set(message.id, message);
    return [...byId.values()].sort((a, b) =>
        a.created_at.localeCompare(b.created_at) || a.id.localeCompare(b.id));
}

function medianDuration(run: () => void, iterations: number) {
    for (let index = 0; index < 20; index += 1) run();
    const samples = Array.from({ length: 7 }, () => {
        const started = performance.now();
        for (let index = 0; index < iterations; index += 1) run();
        return (performance.now() - started) / iterations;
    }).sort((a, b) => a - b);
    return samples[3]!;
}

for (const size of [100, 1_000, 10_000]) {
    const history: Message[] = Array.from({ length: size }, (_, index) => ({
        id: String(index).padStart(8, '0'),
        thread_id: 'benchmark',
        role: index % 2 === 0 ? 'user' : 'assistant',
        content: 'Message content',
        created_at: new Date(1_700_000_000_000 + index * 1000).toISOString(),
    }));
    const incoming = [{ ...history[size - 1]!, content: 'Updated response' }];
    assert.deepEqual(mergeMessagesSorted(history, incoming), baseline(history, incoming));
    const iterations = size === 10_000 ? 100 : 1_000;
    const beforeMs = medianDuration(() => { baseline(history, incoming); }, iterations);
    const afterMs = medianDuration(() => { mergeMessagesSorted(history, incoming); }, iterations);
    console.log(JSON.stringify({
        scenario: 'single realtime update', messages: size,
        beforeMs: Number(beforeMs.toFixed(4)), afterMs: Number(afterMs.toFixed(4)),
        speedup: Number((beforeMs / afterMs).toFixed(2)),
    }));
}
