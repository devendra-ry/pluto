import assert from 'node:assert/strict';
import test from 'node:test';
import { startUploadFileForThread } from './uploads';

class FakeXhr {
    static DONE = 4;
    static instances: FakeXhr[] = [];
    readyState = 1;
    responseType = '';
    timeout = 0;
    status = 200;
    response: unknown;
    onload: (() => void) | null = null;
    onerror: (() => void) | null = null;
    onabort: (() => void) | null = null;
    ontimeout: (() => void) | null = null;
    upload = { onprogress: null as unknown };
    aborted = false;
    constructor() { FakeXhr.instances.push(this); }
    open() {}
    setRequestHeader() {}
    send() {}
    abort() { this.aborted = true; }
}

function installXhr(t: test.TestContext) {
    const original = globalThis.XMLHttpRequest;
    FakeXhr.instances = [];
    globalThis.XMLHttpRequest = FakeXhr as unknown as typeof XMLHttpRequest;
    t.after(() => { globalThis.XMLHttpRequest = original; });
}

test('cancel settles an upload even without an XHR abort callback', async t => {
    installXhr(t);
    const task = startUploadFileForThread('thread', new File(['hello'], 'hello.txt'));
    task.cancel();
    task.cancel();
    await assert.rejects(task.promise, /canceled/);
    const xhr = FakeXhr.instances[0];
    assert.ok(xhr);
    assert.equal(xhr.aborted, true);
    assert.equal(xhr.onload, null);
    assert.equal(xhr.upload.onprogress, null);
});

test('a stalled upload rejects on timeout and releases its handlers', async t => {
    installXhr(t);
    const task = startUploadFileForThread('thread', new File(['hello'], 'hello.txt'));
    const xhr = FakeXhr.instances[0];
    assert.ok(xhr);
    assert.ok(xhr.timeout > 0);
    xhr.ontimeout?.();
    await assert.rejects(task.promise, /timed out/);
    assert.equal(xhr.onload, null);
    assert.equal(xhr.ontimeout, null);
});

test('a broken progress callback cannot leave a completed upload pending', async t => {
    installXhr(t);
    const originalWarn = console.warn;
    console.warn = () => {};
    t.after(() => { console.warn = originalWarn; });
    const task = startUploadFileForThread('thread', new File(['hello'], 'hello.txt'), () => { throw new Error('callback'); });
    const xhr = FakeXhr.instances[0];
    assert.ok(xhr);
    const attachment = { id: 'a', name: 'hello.txt', mimeType: 'text/plain', size: 5, path: 'thread/a', url: '/api/uploads?a' };
    xhr.response = { attachment };
    xhr.readyState = FakeXhr.DONE;
    xhr.onload?.();
    assert.deepEqual(await task.promise, attachment);
    assert.equal(xhr.onload, null);
});
