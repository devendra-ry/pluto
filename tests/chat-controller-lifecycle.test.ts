import { test } from 'node:test';
import assert from 'node:assert';

import { persistThenEmitTerminal } from '../src/server/chat/chat-stream-lifecycle';

test('terminal chat event waits for persistence to finish', async () => {
    let resolvePersistence!: () => void;
    let terminalVisible = false;
    const completion = persistThenEmitTerminal(
        () => new Promise<void>((resolve) => { resolvePersistence = resolve; }),
        () => { terminalVisible = true; },
    );

    await Promise.resolve();
    assert.strictEqual(terminalVisible, false);
    resolvePersistence();
    await completion;
    assert.strictEqual(terminalVisible, true);
});

test('failed persistence leaves the chat stream incomplete', async () => {
    let terminalVisible = false;
    await assert.rejects(
        persistThenEmitTerminal(
            async () => { throw new Error('database write failed'); },
            () => { terminalVisible = true; },
        ),
        /database write failed/,
    );
    assert.strictEqual(terminalVisible, false);
});

test('an already aborted request closes its stream and releases its reserved lock', async () => {
    process.env.GEMINI_API_KEY = 'dummy';
    process.env.NEXT_PUBLIC_SUPABASE_URL = 'https://example.supabase.co';
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = 'dummy';
    process.env.UPSTASH_REDIS_REST_URL = 'https://redis.example.test';
    process.env.UPSTASH_REDIS_REST_TOKEN = 'dummy';
    const { handleChatRequest } = await import('../src/server/chat/chat-controller');

    const commands: string[][] = [];
    const originalFetch = globalThis.fetch;
    globalThis.fetch = (async (_input: RequestInfo | URL, init?: RequestInit) => {
        const parsed = JSON.parse(String(init?.body)) as string[] | string[][];
        const isBatch = Array.isArray(parsed[0]);
        const command = isBatch ? parsed[0] as string[] : parsed as string[];
        commands.push(command);
        let result: unknown;
        if (command[0]?.toLowerCase() === 'get') result = null;
        else if (command[0]?.toLowerCase() === 'xrange') result = [];
        else if (command[0]?.toLowerCase() === 'set') result = 'OK';
        else if (command[0]?.toLowerCase() === 'eval') result = 1;
        else throw new Error(`Unexpected Redis command: ${command[0]}`);
        return Response.json(isBatch ? [{ result }] : { result });
    }) as typeof fetch;

    try {
        const abortController = new AbortController();
        abortController.abort();
        const request = new Request('https://example.test/api/chat', {
            method: 'POST',
            headers: {
                'content-type': 'application/json',
                'x-idempotency-key': 'early-abort-test',
            },
            body: '{}',
            signal: abortController.signal,
        });
        const response = await handleChatRequest(request, {
            user: { id: 'user-1' } as never,
            supabase: {} as never,
        });

        const result = await response.body!.getReader().read();
        assert.strictEqual(result.done, true);
        assert.ok(commands.some(([name, key]) => name === 'set' && key?.includes('chat-stream-lock')));
        assert.ok(commands.some((command) => command[0] === 'eval'
            && command.flat(Infinity).some((part) => typeof part === 'string' && part.includes('chat-stream-lock'))));
    } finally {
        globalThis.fetch = originalFetch;
    }
});

test('cancelling the response body aborts an in-flight provider stream', async () => {
    process.env.GEMINI_API_KEY = 'dummy';
    process.env.NEXT_PUBLIC_SUPABASE_URL = 'https://example.supabase.co';
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = 'dummy';
    process.env.UPSTASH_REDIS_REST_URL = 'https://redis.example.test';
    process.env.UPSTASH_REDIS_REST_TOKEN = 'dummy';
    const { handleChatRequest } = await import('../src/server/chat/chat-controller');

    let providerSignal: AbortSignal | undefined;
    let providerBodyController: ReadableStreamDefaultController<Uint8Array> | undefined;
    let resolveProviderRead!: () => void;
    const providerReadStarted = new Promise<void>((resolve) => { resolveProviderRead = resolve; });
    let providerPullCount = 0;
    const readyProviderFrames = 64;
    let resolveJobLookup!: () => void;
    const jobLookupStarted = new Promise<void>((resolve) => { resolveJobLookup = resolve; });
    let resolveLockRelease!: () => void;
    const lockReleaseCompleted = new Promise<void>((resolve) => { resolveLockRelease = resolve; });
    const redisCommandLog: string[] = [];
    const originalFetch = globalThis.fetch;
    globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = String(input);
        if (url.startsWith('https://redis.example.test')) {
            const parsed = JSON.parse(String(init?.body)) as string[] | string[][];
            const isBatch = Array.isArray(parsed[0]);
            const commands = isBatch ? parsed as string[][] : [parsed as string[]];
            const results = commands.map((command) => {
                const name = command[0]?.toLowerCase();
                redisCommandLog.push(name ?? '<empty>');
                if (name === 'get') return { result: null };
                if (name === 'set') return { result: 'OK' };
                if (name === 'eval') {
                    resolveLockRelease();
                    return { result: 1 };
                }
                if (name === 'xrange') return { result: [] };
                if (name === 'xadd') return { result: '1-0' };
                if (name === 'expire') return { result: 1 };
                throw new Error(`Unexpected Redis command: ${name}`);
            });
            return Response.json(isBatch ? results : results[0]);
        }
        if (url.includes('streamGenerateContent')) {
            providerSignal = init?.signal as AbortSignal | undefined;
            let resolveProviderPull: (() => void) | undefined;
            const body = new ReadableStream<Uint8Array>({
                start(controller) {
                    providerBodyController = controller;
                    providerSignal?.addEventListener('abort', () => {
                        try { controller.error(new DOMException('Aborted', 'AbortError')); } catch { /* already closed */ }
                        resolveProviderPull?.();
                    }, { once: true });
                },
                pull() {
                    providerPullCount += 1;
                    if (providerPullCount <= readyProviderFrames) {
                        if (providerPullCount === 1) resolveProviderRead();
                        providerBodyController?.enqueue(new TextEncoder().encode(
                            `data: ${JSON.stringify({ candidates: [{ content: { parts: [{ text: `token-${providerPullCount}` }] } }] })}\n\n`,
                        ));
                        return;
                    }
                    return new Promise<void>((resolve) => { resolveProviderPull = resolve; });
                },
            });
            return new Response(body, { headers: { 'content-type': 'text/event-stream' } });
        }
        if (url.includes('/v1beta/models/')) {
            return Response.json({ inputTokenLimit: 64000, outputTokenLimit: 8192 });
        }
        throw new Error(`Unexpected provider request: ${url}`);
    }) as typeof fetch;

    const messageRow = {
        id: 'user-message',
        thread_id: 'thread-1',
        role: 'user',
        content: 'hello',
        attachments: [],
        reasoning: null,
        model_id: null,
        reply_stats: null,
        created_at: new Date().toISOString(),
        deleted_at: null,
    };
    const supabase = {
        from(table: string) {
            const result = table === 'messages'
                ? { data: [messageRow], error: null }
                : { data: [], error: null };
            const query: Record<string, any> = {
                select() { return query; },
                eq() { return query; },
                in() { return query; },
                is() { return query; },
                order() { return query; },
                limit() { return query; },
                update() { return query; },
                insert() { return query; },
                maybeSingle() { return Promise.resolve({ data: null, error: null }); },
                single() { return Promise.resolve({ data: { id: 'assistant-message' }, error: null }); },
                then(resolve: (value: unknown) => unknown, reject: (reason: unknown) => unknown) {
                    if (table === 'generation_jobs') resolveJobLookup();
                    return Promise.resolve(result).then(resolve, reject);
                },
            };
            return query;
        },
        rpc() { return Promise.resolve({ error: null }); },
    };

    try {
        const request = new Request('https://example.test/api/chat', {
            method: 'POST',
            headers: { 'content-type': 'application/json', 'x-idempotency-key': 'cancel-while-paused' },
            body: JSON.stringify({
                threadId: 'thread-1',
                userMessageId: 'user-message',
                model: 'gemini-3.8-flash',
                messages: [{ role: 'user', content: 'hello' }],
            }),
        });
        const response = await handleChatRequest(request, {
            user: { id: 'user-1' } as never,
            supabase: supabase as never,
        });
        await providerReadStarted;
        await new Promise<void>((resolve) => setTimeout(resolve, 30));
        assert.ok(
            providerPullCount <= 4,
            `provider reads should stay within a small buffer while the response is unread; observed ${providerPullCount} pulls`,
        );

        await response.body!.cancel('client disconnected');
        await jobLookupStarted;
        const lockReleased = await Promise.race([
            lockReleaseCompleted.then(() => true),
            new Promise<false>((resolve) => setTimeout(() => resolve(false), 1000)),
        ]);
        assert.ok(lockReleased, `expected cancelled stream lock release; Redis commands: ${redisCommandLog.join(', ')}`);
        assert.strictEqual(providerSignal?.aborted, true);
        assert.ok(providerBodyController, 'the provider response body should be active');
        assert.ok(providerPullCount < readyProviderFrames, 'cancellation should not drain buffered provider frames');
    } finally {
        globalThis.fetch = originalFetch;
    }
});

test('the controller withholds its terminal SSE event until the reply is persisted', async () => {
    process.env.GEMINI_API_KEY = 'dummy';
    process.env.NEXT_PUBLIC_SUPABASE_URL = 'https://example.supabase.co';
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = 'dummy';
    const { handleChatRequest } = await import('../src/server/chat/chat-controller');

    let resolvePersistence!: (value: { data: { id: string }; error: null }) => void;
    let resolveInsertStarted!: () => void;
    const persistence = new Promise<{ data: { id: string }; error: null }>((resolve) => { resolvePersistence = resolve; });
    const insertStarted = new Promise<void>((resolve) => { resolveInsertStarted = resolve; });
    const originalFetch = globalThis.fetch;
    let reader: ReadableStreamDefaultReader<Uint8Array> | null = null;
    globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = String(input);
        if (url.startsWith('https://redis.example.test')) {
            const parsed = JSON.parse(String(init?.body)) as string[] | string[][];
            const isBatch = Array.isArray(parsed[0]);
            const command = isBatch ? parsed[0] as string[] : parsed as string[];
            const name = command[0]?.toLowerCase();
            const result = name === 'get' ? null
                : name === 'set' ? 'OK'
                    : name === 'eval' ? 1
                        : name === 'xrange' ? []
                            : (() => { throw new Error(`Unexpected Redis command: ${command[0]}`); })();
            return Response.json(isBatch ? [{ result }] : { result });
        }
        if (url.includes('streamGenerateContent')) {
            const body = new ReadableStream<Uint8Array>({
                start(controller) {
                    const providerFrame = new TextEncoder().encode(
                        `data: ${JSON.stringify({ candidates: [{ content: { parts: [{ text: 'persisted answer 😀' }] } }] })}\n\n`,
                    );
                    // Split a multibyte character between transport chunks to
                    // cover the provider decoder's incremental UTF-8 handling.
                    controller.enqueue(providerFrame.slice(0, -4));
                    controller.enqueue(providerFrame.slice(-4, -2));
                    controller.enqueue(providerFrame.slice(-2));
                    controller.close();
                },
            });
            return new Response(body, { headers: { 'content-type': 'text/event-stream' } });
        }
        if (url.includes('/v1beta/models/')) {
            return Response.json({ inputTokenLimit: 64000, outputTokenLimit: 8192 });
        }
        throw new Error(`Unexpected provider request: ${url}`);
    }) as typeof fetch;

    const userRow = {
        id: 'user-message',
        thread_id: 'thread-1',
        role: 'user',
        content: 'hello',
        attachments: [],
        reasoning: null,
        model_id: null,
        reply_stats: null,
        created_at: new Date().toISOString(),
        deleted_at: null,
    };
    const supabase = {
        from(table: string) {
            let inserting = false;
            const query: Record<string, any> = {
                select() { return query; },
                eq() { return query; },
                is() { return query; },
                order() { return query; },
                limit() { return query; },
                in() { return query; },
                update() { return query; },
                insert() { inserting = true; resolveInsertStarted(); return query; },
                maybeSingle() { return Promise.resolve({ data: null, error: null }); },
                single() { return inserting ? persistence : Promise.resolve({ data: { id: 'assistant-message' }, error: null }); },
                then(resolve: (value: unknown) => unknown, reject: (reason: unknown) => unknown) {
                    const result = table === 'messages'
                        ? { data: [userRow], error: null }
                        : { data: [], error: null };
                    return Promise.resolve(result).then(resolve, reject);
                },
            };
            return query;
        },
        rpc() { return Promise.resolve({ error: null }); },
    };

    try {
        const request = new Request('https://example.test/api/chat', {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({
                threadId: 'thread-1',
                userMessageId: 'user-message',
                model: 'gemini-3.8-flash',
                messages: [{ role: 'user', content: 'hello' }],
            }),
        });
        const response = await handleChatRequest(request, {
            user: { id: 'user-1' } as never,
            supabase: supabase as never,
        });
        reader = response.body!.getReader();
        const first = await reader.read();
        assert.strictEqual(first.done, false);
        assert.match(new TextDecoder().decode(first.value), /persisted answer 😀/);
        await insertStarted;

        let pendingReadSettled = false;
        const pendingRead = reader.read().then((value) => {
            pendingReadSettled = true;
            return value;
        });
        await new Promise<void>((resolve) => setImmediate(resolve));
        assert.strictEqual(pendingReadSettled, false);

        resolvePersistence({ data: { id: 'assistant-message' }, error: null });
        const terminal = await pendingRead;
        assert.strictEqual(terminal.done, false);
        assert.match(new TextDecoder().decode(terminal.value), /data: \[DONE\]/);
        assert.strictEqual((await reader.read()).done, true);
    } finally {
        resolvePersistence({ data: { id: 'assistant-message' }, error: null });
        try { await reader?.cancel('test cleanup'); } catch { /* already closed */ }
        globalThis.fetch = originalFetch;
    }
});
