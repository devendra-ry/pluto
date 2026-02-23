# Server Layer

Use this layer for server-only infrastructure and integrations.

Current modules:

- `providers/*` for provider orchestration and model limits.
- `providers/chutes.ts` for Chutes-specific server config helpers.
- `security/ssrf-guard.ts` and related tests.

Guideline:

- Keep server-only code here and out of `src/features/*` and client bundles.
- Feature-specific server entrypoints should live at `src/features/<feature>/server.ts`.
