import 'server-only';

import { trace, SpanStatusCode, type Attributes, type Span } from '@opentelemetry/api';

const tracer = trace.getTracer('pluto.server');

/**
 * Runs work inside a named span. With no registered SDK this remains a cheap
 * no-op, which keeps tests and local runs independent from exporter setup.
 */
export function withSpan<T>(
    name: string,
    attributes: Attributes,
    operation: (span: Span) => T | Promise<T>,
): Promise<T> {
    return tracer.startActiveSpan(name, { attributes }, async (span) => {
        try {
            return await operation(span);
        } catch (error) {
            recordSpanError(span, error);
            throw error;
        } finally {
            span.end();
        }
    });
}

export function recordSpanError(span: Span, error: unknown) {
    // Provider and database errors can embed prompts, attachment paths, SQL, or
    // credentials. Record only the exception class and a fixed message.
    span.recordException({
        name: error instanceof Error ? error.name : 'UnknownError',
        message: 'Operation failed',
    });
    span.setStatus({ code: SpanStatusCode.ERROR });
}

/** Marks fulfilled Supabase-style `{ error }` results as failed spans. */
export function withResultSpan<T extends { error?: unknown }>(
    name: string,
    attributes: Attributes,
    operation: () => T | PromiseLike<T>,
): Promise<T> {
    return withSpan(name, attributes, async (span) => {
        const result = await operation();
        if (result.error) recordSpanError(span, result.error);
        return result;
    });
}

export function responseWithRequestId(response: Response, requestId: string): Response {
    const headers = new Headers(response.headers);
    headers.set('X-Request-ID', requestId);
    return new Response(response.body, {
        status: response.status,
        statusText: response.statusText,
        headers,
    });
}
