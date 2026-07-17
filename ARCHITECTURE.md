# Architecture

This repo uses a layered structure with explicit dependency direction:

1. `src/app` — composition and thin route entry points
2. `src/features` — browser-facing domain modules
3. `src/shared` — environment-neutral contracts and utilities
4. `src/server` — server-only handlers, providers, security, Redis, and persistence orchestration

`src/components/ui` contains reusable UI primitives only.

## Layer Rules

- `src/app` composes screens and exposes thin route files. API routes re-export handlers from `src/server`.
- `src/features` contains domain logic (chat, threads, messages, attachments, uploads, shell).
- `src/shared` contains domain-agnostic primitives (`core`, `config`, hooks, providers, validation).
- `src/server` contains server-only provider/security infrastructure.

## Import Rules

- Outside a feature, import feature modules via `@/features/<feature>` only.
- Do not import `@/server/*` from client/shared/feature code.
- Keep cross-feature internals private unless intentionally exported from that feature's `index.ts`.

## Public Entry Points

- Features expose public APIs through `src/features/*/index.ts`.
- Server infra is organized under `src/server/chat`, `generation`, `http`, `providers`, `security`, `threads`, and `uploads`.
- Shared primitives and cross-layer data shapes are under `src/shared/core`, `contracts`, `streaming`, and `validation`.

ESLint enforces the important dependency edges: client/shared modules cannot import `src/server`, and app/server/shared code cannot reach through a feature's private folders.
