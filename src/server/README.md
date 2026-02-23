# Server Layer

Use this layer for server-only infrastructure and integrations.

Current modules:

- `providers/*` for provider orchestration and model limits.
- `providers/chutes.ts` for Chutes-specific server config helpers.
- `redis/client.ts` for Upstash Redis client access and key namespacing.
- `redis/idempotency.ts`, `redis/locks.ts`, and `redis/chat-stream-cache.ts` for dedupe, concurrency, and chat replay buffering.
- `security/abuse-protection.ts` for temporary abuse throttling signals.
- `security/ssrf-guard.ts` and related tests.

Guideline:

- Keep server-only code here and out of `src/features/*` and client bundles.
- Feature-specific server entrypoints should live at `src/features/<feature>/server.ts`.
