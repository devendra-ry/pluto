import { test, before } from 'node:test';
import assert from 'node:assert';

let buildGoogleContents: any;
let retryTransientProviderRequest: any;
let ChatStreamEventWriter: any;
let streamGoogleResponse: any;
let isTransientProviderError: any;

before(async () => {
    process.env.GEMINI_API_KEY = 'dummy';
    process.env.NEXT_PUBLIC_SUPABASE_URL = 'https://example.supabase.co';
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = 'dummy';
    const mod = await import('../src/server/providers/chat-streams');
    const cacheMod = await import('../src/server/redis/chat-stream-cache');
    buildGoogleContents = mod.buildGoogleContents;
    retryTransientProviderRequest = mod.retryTransientProviderRequest;
    streamGoogleResponse = mod.streamGoogleResponse;
    isTransientProviderError = mod.isTransientProviderError;
    ChatStreamEventWriter = cacheMod.ChatStreamEventWriter;
});

test('classifies truncated provider framing without treating arbitrary JSON errors as transient', () => {
    assert.strictEqual(isTransientProviderError(new Error('Incomplete JSON segment at the end')), true);
    assert.strictEqual(isTransientProviderError(new SyntaxError('Unexpected token')), false);
});

test('retries truncated provider streams before text and discards stale usage', async () => {
    const response = {
        async *[Symbol.asyncIterator]() {
            yield { usageMetadata: { promptTokenCount: 999 } };
            throw new Error('Incomplete JSON segment at the end');
        },
    };
    let restarts = 0;
    let settlements = 0;
    const body = await new Response(streamGoogleResponse(response, new AbortController(),
        () => { settlements += 1; }, async () => {
            restarts += 1;
            return { async *[Symbol.asyncIterator]() {
                yield { candidates: [{ content: { parts: [{ text: 'recovered' }] } }] };
            } };
        }, [0])).text();
    assert.strictEqual(restarts, 1);
    assert.strictEqual(settlements, 1);
    assert.match(body, /recovered/);
    assert.doesNotMatch(body, /999/);
    assert.ok(body.endsWith('data: [DONE]\n\n'));
});

for (const thought of [false, true]) {
    test(`does not restart a truncated provider stream after ${thought ? 'reasoning' : 'answer'} text`, async () => {
        const response = { async *[Symbol.asyncIterator]() {
            yield { candidates: [{ content: { parts: [{ text: 'partial', thought }] } }] };
            throw new Error('Incomplete JSON segment at the end');
        } };
        let restarts = 0;
        const reader = streamGoogleResponse(response, new AbortController(), undefined,
            async () => { restarts += 1; return response; }, [0]).getReader();
        assert.match(new TextDecoder().decode((await reader.read()).value), /partial/);
        await assert.rejects(reader.read(), /Incomplete JSON/);
        assert.strictEqual(restarts, 0);
    });
}

test('bounds retries for repeatedly truncated streams', async () => {
    const response = { async *[Symbol.asyncIterator]() {
        throw new Error('Incomplete JSON segment at the end');
    } };
    let restarts = 0;
    await assert.rejects(new Response(streamGoogleResponse(response, new AbortController(), undefined,
        async () => { restarts += 1; return response; }, [0, 0])).text(), /Incomplete JSON/);
    assert.strictEqual(restarts, 2);
});

import type { PreparedChatMessage } from '../src/shared/contracts/chat';

test('buildGoogleContents formats text and provider roles', () => {
    const messages: PreparedChatMessage[] = [
        { role: 'user', content: 'Hello', attachments: [] },
        { role: 'assistant', content: 'Hi there', attachments: [] },
    ];
    assert.deepStrictEqual(buildGoogleContents(messages), [
        { role: 'user', parts: [{ text: 'Hello' }] },
        { role: 'model', parts: [{ text: 'Hi there' }] },
    ]);
});

test('buildGoogleContents formats inline attachments', () => {
    const messages: PreparedChatMessage[] = [{
        role: 'user',
        content: 'Look at this',
        attachments: [{ name: 'image.png', mimeType: 'image/png', base64Data: 'base64string' }],
    }];
    const parts = buildGoogleContents(messages)[0].parts;
    assert.deepStrictEqual(parts[1], { inlineData: { mimeType: 'image/png', data: 'base64string' } });
});

test('retries a temporary provider outage before streaming starts', async () => {
    let calls = 0;
    const result = await retryTransientProviderRequest(async () => {
        calls += 1;
        if (calls === 1) throw Object.assign(new Error('Service Unavailable'), { code: 503 });
        return 'ready';
    }, undefined, [0]);
    assert.strictEqual(result, 'ready');
    assert.strictEqual(calls, 2);
});

test('does not retry a permanent provider error', async () => {
    let calls = 0;
    await assert.rejects(
        retryTransientProviderRequest(async () => {
            calls += 1;
            throw Object.assign(new Error('Invalid request'), { code: 400 });
        }, undefined, [0, 0]),
        /Invalid request/,
    );
    assert.strictEqual(calls, 1);
});

test('serializes concurrent chat stream flushes and queues close after them', async () => {
    let active = 0;
    let maxActive = 0;
    const batches: string[] = [];
    const releases: Array<() => void> = [];
    const redis = {
        pipeline() {
            let packed: string | undefined;
            return {
                xadd(_key: string, _id: string, fields: { e: string }) {
                    packed = fields.e;
                    return this;
                },
                expire() { return this; },
                async exec() {
                    active += 1;
                    maxActive = Math.max(maxActive, active);
                    if (packed !== undefined) batches.push(packed);
                    const call = batches.length;
                    if (packed !== undefined && call <= 2) {
                        await new Promise<void>((resolve) => releases.push(resolve));
                    }
                    active -= 1;
                },
            };
        },
    };
    const writer = new ChatStreamEventWriter('test-stream', redis as never);

    try {
        for (let i = 0; i < 100; i += 1) writer.push(`first-${i}`);
        await new Promise<void>((resolve) => setImmediate(resolve));
        assert.strictEqual(batches.length, 1);

        for (let i = 0; i < 100; i += 1) writer.push(`second-${i}`);
        await new Promise<void>((resolve) => setImmediate(resolve));
        assert.strictEqual(batches.length, 1, 'the second Redis write should wait for the first');

        const close = writer.close();
        releases[0]?.();
        await new Promise<void>((resolve) => setImmediate(resolve));
        assert.strictEqual(batches.length, 2);
        releases[1]?.();
        await close;

        assert.strictEqual(maxActive, 1, 'Redis pipelines for one stream must not overlap');
        assert.match(batches[0] ?? '', /^first-0\x1efirst-1/);
        assert.match(batches[1] ?? '', /^second-0\x1esecond-1/);
    } finally {
        for (const release of releases) release();
        await writer.close();
    }
});

test('closes the Google stream when abort interrupts a pending provider read', async () => {
    const abortController = new AbortController();
    let resolveReadStarted!: () => void;
    const readStarted = new Promise<void>((resolve) => { resolveReadStarted = resolve; });
    let returnCalls = 0;
    const response = {
        [Symbol.asyncIterator]() {
            return {
                next() {
                    resolveReadStarted();
                    return new Promise<never>(() => {});
                },
                return() {
                    returnCalls += 1;
                    return Promise.resolve({ done: true, value: undefined });
                },
            };
        },
    };

    const reader = streamGoogleResponse(response, abortController).getReader();
    const pendingRead = reader.read();
    await readStarted;
    abortController.abort();

    const result = await pendingRead;
    assert.strictEqual(result.done, true);
    assert.ok(returnCalls > 0, 'the upstream iterator should be asked to stop');
});

test('cancelling the Google stream aborts the provider and stops its iterator', async () => {
    const abortController = new AbortController();
    let nextCalls = 0;
    let resolveSecondReadStarted!: () => void;
    const secondReadStarted = new Promise<void>((resolve) => { resolveSecondReadStarted = resolve; });
    let returnCalls = 0;
    const response = {
        [Symbol.asyncIterator]() {
            return {
                next() {
                    nextCalls += 1;
                    if (nextCalls === 1) {
                        return Promise.resolve({
                            done: false,
                            value: { candidates: [{ content: { parts: [{ text: 'hello' }] } }] },
                        });
                    }
                    resolveSecondReadStarted();
                    return new Promise<never>(() => {});
                },
                return() {
                    returnCalls += 1;
                    return Promise.resolve({ done: true, value: undefined });
                },
            };
        },
    };

    const reader = streamGoogleResponse(response, abortController).getReader();
    const first = await reader.read();
    assert.strictEqual(first.done, false);
    assert.match(new TextDecoder().decode(first.value), /hello/);

    const pendingRead = reader.read();
    await secondReadStarted;
    await reader.cancel('consumer stopped');

    assert.strictEqual(abortController.signal.aborted, true);
    assert.ok(returnCalls > 0, 'the upstream iterator should be asked to stop');
    assert.strictEqual((await pendingRead).done, true);
});

test('preserves interleaved reasoning, answer text, and final usage from Google chunks', async () => {
    const abortController = new AbortController();
    const response = {
        async *[Symbol.asyncIterator]() {
            yield {
                candidates: [{ content: { parts: [
                    { text: 'think one', thought: true },
                    { text: 'answer one' },
                ] } }],
                usageMetadata: { promptTokenCount: 12, thoughtsTokenCount: 3 },
            };
            yield {
                candidates: [{ content: { parts: [
                    { text: 'answer two' },
                    { text: 'think two', thought: true },
                ] } }],
                usageMetadata: { candidatesTokenCount: 8, totalTokenCount: 23 },
            };
        },
    };

    const body = await new Response(streamGoogleResponse(response, abortController)).text();

    assert.match(body, /"r":"think one"/);
    assert.match(body, /"c":"answer one"/);
    assert.match(body, /"c":"answer two"/);
    assert.match(body, /"r":"think two"/);
    assert.match(body, /"inputTokens":12,"outputTokens":8,"reasoningTokens":3,"totalTokens":23/);
    assert.ok(body.endsWith('data: [DONE]\n\n'));
});
