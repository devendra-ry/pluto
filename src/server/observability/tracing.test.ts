import { describe, test } from 'node:test';
import assert from 'node:assert';
import { SpanStatusCode, type Span } from '@opentelemetry/api';

import { recordSpanError, responseWithRequestId, withResultSpan, withSpan } from './tracing';

describe('server tracing helpers', () => {
    test('runs work when no exporter or SDK has been registered', async () => {
        const value = await withSpan('test.operation', { 'test.kind': 'unit' }, async () => 'complete');
        assert.strictEqual(value, 'complete');
    });

    test('preserves fulfilled database error results for caller handling', async () => {
        const result = await withResultSpan('test.database', {}, async () => ({ error: new Error('private details') }));
        assert.ok(result.error instanceof Error);
        assert.strictEqual(result.error.message, 'private details');
    });

    test('rethrows operation failures after recording them on the span', async () => {
        await assert.rejects(
            withSpan('test.failure', {}, async () => { throw new Error('expected failure'); }),
            /expected failure/,
        );
    });

    test('records only a redacted exception and error status', () => {
        let exception: Record<string, unknown> | undefined;
        let status: { code: number } | undefined;
        const span = {
            recordException(value: Record<string, unknown>) { exception = value; },
            setStatus(value: { code: number }) { status = value; },
        } as unknown as Span;

        recordSpanError(span, new Error('private prompt, object path, or credential'));

        assert.deepStrictEqual(exception, { name: 'Error', message: 'Operation failed' });
        assert.deepStrictEqual(status, { code: SpanStatusCode.ERROR });
    });

    test('adds request correlation without losing response status or headers', async () => {
        const response = responseWithRequestId(new Response('stream', {
            status: 409,
            headers: { 'Content-Type': 'text/plain' },
        }), 'request-123');

        assert.strictEqual(response.status, 409);
        assert.strictEqual(response.headers.get('content-type'), 'text/plain');
        assert.strictEqual(response.headers.get('x-request-id'), 'request-123');
        assert.strictEqual(await response.text(), 'stream');
    });
});
