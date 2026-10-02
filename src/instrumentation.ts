/**
 * Initialize tracing only on the Node runtime used by API handlers. An OTLP
 * exporter is created only when an explicit endpoint is configured; otherwise
 * manual spans remain no-op and no exporter can make network requests.
 */
export async function register() {
    if (process.env.NEXT_RUNTIME !== 'nodejs') return;

    const tracesEndpoint = process.env.OTEL_EXPORTER_OTLP_TRACES_ENDPOINT?.trim();
    const baseEndpoint = process.env.OTEL_EXPORTER_OTLP_ENDPOINT?.trim();
    const endpoint = tracesEndpoint || (baseEndpoint
        ? `${baseEndpoint.replace(/\/$/, '')}/v1/traces`
        : undefined);
    if (!endpoint) return;

    // Next.js has its own fetch instrumentation switch in addition to the
    // instrumentation list passed to @vercel/otel. Disable both: manual spans
    // avoid recording provider URLs, credentials, and storage object paths.
    process.env.NEXT_OTEL_FETCH_DISABLED = '1';

    const parseHeaders = (value: string | undefined) => Object.fromEntries(
        (value ?? '').split(',').flatMap((pair) => {
            const separator = pair.indexOf('=');
            if (separator < 1) return [];
            const key = pair.slice(0, separator).trim();
            const headerValue = pair.slice(separator + 1).trim();
            if (!key) return [];
            try {
                return [[decodeURIComponent(key), decodeURIComponent(headerValue)]];
            } catch {
                return [[key, headerValue]];
            }
        }),
    );
    const headers = {
        ...parseHeaders(process.env.OTEL_EXPORTER_OTLP_HEADERS),
        ...parseHeaders(process.env.OTEL_EXPORTER_OTLP_TRACES_HEADERS),
    };

    const { registerOTel, OTLPHttpJsonTraceExporter } = await import('@vercel/otel');
    registerOTel({
        serviceName: process.env.OTEL_SERVICE_NAME?.trim() || 'pluto',
        // Manual application spans avoid capturing provider URLs or headers.
        instrumentations: [],
        spanProcessors: [],
        traceExporter: new OTLPHttpJsonTraceExporter({ url: endpoint, headers }),
    });
}
