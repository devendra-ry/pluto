# Server observability

Pluto records manual OpenTelemetry spans for chat generation, attachment preparation, storage, and thread cleanup. Chat, upload, and cleanup responses include `X-Request-ID`; chat performance logs and request spans use that same identifier. Application-owned span attributes contain timings, counts, model identifiers, and operation names. They exclude message text, system prompts, attachment contents, storage paths, and provider error messages. Next.js can also emit its standard framework request metadata.

OTLP export is opt-in. Set `OTEL_EXPORTER_OTLP_TRACES_ENDPOINT` to the full trace endpoint (for example, `https://collector.example/v1/traces`), or set `OTEL_EXPORTER_OTLP_ENDPOINT` to the base endpoint; Pluto appends `/v1/traces` to the base value. Optional authentication headers use the standard `OTEL_EXPORTER_OTLP_TRACES_HEADERS` or `OTEL_EXPORTER_OTLP_HEADERS` variables. `OTEL_SERVICE_NAME` sets the service name and defaults to `pluto`.

Without an explicit endpoint, Pluto does not register an OTLP exporter or send OTLP traces. Fetch auto-instrumentation is disabled so provider credentials and storage URLs are excluded from fetch spans; the application spans provide the request, provider, database, and storage timing boundaries directly.
