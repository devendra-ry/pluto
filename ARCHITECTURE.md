# Architecture

This repo uses a layered structure with explicit dependency direction:

1. `src/app`
2. `src/features`
3. `src/shared`
4. `src/server` (server-only)

`src/components/ui` contains reusable UI primitives only.

## Layer Rules

- `src/app` composes screens/routes and may import from `features`, `shared`, and `server` (route handlers).
- `src/features` contains domain logic (chat, threads, messages, attachments, uploads, shell).
- `src/shared` contains domain-agnostic primitives (`core`, `config`, hooks, providers, validation).
- `src/server` contains server-only provider/security infrastructure.

## Import Rules

- Outside a feature, import feature modules via `@/features/<feature>` only.
- Do not import `@/server/*` from client/shared/feature code.
- Keep cross-feature internals private unless intentionally exported from that feature's `index.ts`.

## Public Entry Points

- Features expose public APIs through `src/features/*/index.ts`.
- Server infra is organized under `src/server/providers` and `src/server/security`.
- Shared primitives are under `src/shared/core` and `src/shared/config`.
