import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { Root } from 'hast';
import { MarkdownWorkerQueue, type MarkdownWorkerTransport } from './markdown-worker-queue';
import type { MarkdownParseRequest, MarkdownParseResponse } from './markdown-worker-protocol';

const tree: Root = { type: 'root', children: [{ type: 'text', value: 'parsed' }] };
function transport() {
    const sent: MarkdownParseRequest[] = [];
    let terminated = false;
    const worker: MarkdownWorkerTransport = {
        onmessage: null, onerror: null, onmessageerror: null,
        postMessage: request => { sent.push(request); }, terminate: () => { terminated = true; },
    };
    return { worker, sent, terminated: () => terminated,
        reply: (response: MarkdownParseResponse) => worker.onmessage?.({ data: response } as MessageEvent<MarkdownParseResponse>) };
}

test('cancelled revisions leave only the latest pending parse and never publish stale results', async () => {
    const mock = transport();
    const queue = new MarkdownWorkerQueue(() => mock.worker);
    const first = new AbortController();
    const next = new AbortController();
    const a = queue.parse('first', true, first.signal);
    assert.equal(mock.sent.length, 0);
    mock.reply({ type: 'ready' });
    const b = queue.parse('second', true, next.signal);
    const rejectedA = assert.rejects(a, { name: 'AbortError' });
    const rejectedB = assert.rejects(b, { name: 'AbortError' });
    first.abort(); next.abort();
    const c = queue.parse('latest', false, new AbortController().signal);
    assert.equal(mock.sent.length, 1);
    mock.reply({ id: mock.sent[0]!.id, tree, parseMs: 1 });
    assert.deepEqual(mock.sent.map(request => request.content), ['first', 'latest']);
    mock.reply({ id: mock.sent[0]!.id, tree: { type: 'root', children: [] }, parseMs: 1 });
    mock.reply({ id: mock.sent[1]!.id, tree, parseMs: 1 });
    assert.deepEqual(await c, tree);
    await Promise.all([rejectedA, rejectedB]);
    queue.dispose();
});

test('worker construction failure disables future attempts for the session', async () => {
    let attempts = 0;
    const queue = new MarkdownWorkerQueue(() => { attempts++; throw new Error('CSP'); });
    await assert.rejects(queue.parse('a', false, new AbortController().signal));
    await assert.rejects(queue.parse('b', false, new AbortController().signal));
    assert.equal(attempts, 1);
    queue.dispose();
});

test('cancelling during startup sends only the current revision after the handshake', async () => {
    const mock = transport();
    const queue = new MarkdownWorkerQueue(() => mock.worker);
    const controller = new AbortController();
    const cancelled = assert.rejects(queue.parse('obsolete', true, controller.signal), { name: 'AbortError' });
    const latest = queue.parse('current', false, new AbortController().signal);
    controller.abort();
    mock.reply({ type: 'ready' });
    mock.reply({ type: 'ready' }); // duplicate startup events must not double-post
    assert.deepEqual(mock.sent.map(request => request.content), ['current']);
    mock.reply({ id: mock.sent[0]!.id, tree, parseMs: 1 });
    await cancelled; assert.deepEqual(await latest, tree);
    queue.dispose();
});

test('a stalled worker releases both active and pending promises and terminates', async () => {
    const mock = transport();
    const queue = new MarkdownWorkerQueue(() => mock.worker, 10);
    const a = assert.rejects(queue.parse('active', true, new AbortController().signal));
    mock.reply({ type: 'ready' });
    const b = assert.rejects(queue.parse('pending', false, new AbortController().signal));
    await Promise.all([a, b]);
    assert.equal(mock.terminated(), true);
    assert.equal(mock.sent.length, 1);
    queue.dispose();
});

test('a parse error rejects only its request and the queue continues', async () => {
    const mock = transport();
    const queue = new MarkdownWorkerQueue(() => mock.worker);
    const a = assert.rejects(queue.parse('bad', true, new AbortController().signal), /parse failed/);
    mock.reply({ type: 'ready' });
    const b = queue.parse('good', false, new AbortController().signal);
    mock.reply({ id: mock.sent[0]!.id, error: 'parse failed' });
    mock.reply({ id: mock.sent[1]!.id, tree, parseMs: 1 });
    await a; assert.deepEqual(await b, tree);
    queue.dispose();
});

test('an idle worker terminates and is recreated on the next request', async () => {
    const mocks: ReturnType<typeof transport>[] = [];
    const queue = new MarkdownWorkerQueue(() => { const mock = transport(); mocks.push(mock); return mock.worker; }, 1000, 10);
    const a = queue.parse('one', false, new AbortController().signal);
    mocks[0]!.reply({ type: 'ready' });
    mocks[0]!.reply({ id: mocks[0]!.sent[0]!.id, tree, parseMs: 1 }); await a;
    await new Promise(resolve => setTimeout(resolve, 30));
    assert.equal(mocks[0]!.terminated(), true);
    const b = queue.parse('two', false, new AbortController().signal);
    mocks[1]!.reply({ type: 'ready' });
    assert.equal(mocks.length, 2);
    mocks[1]!.reply({ id: mocks[1]!.sent[0]!.id, tree, parseMs: 1 }); await b;
    queue.dispose();
});
