# Architecture

This repo uses a layered structure with explicit dependency direction:

1. `src/app` — composition and thin route entry points
2. `src/features` — browser-facing screens and domain modules
3. `src/shared` — contracts, utilities, and browser-safe adapters
4. `src/server` — server-only handlers, providers, security, Redis, and persistence orchestration

`src/components/ui` contains reusable UI primitives only.

## Layer Rules

- `src/app` composes screens and exposes thin route files. API and auth routes re-export handlers from `src/server`.
- `src/features` contains browser-facing screens and domain logic (auth, home, chat, threads, messages, attachments, uploads, shell).
- `src/shared` contains domain-agnostic primitives (`core`, `config`, hooks, providers, validation) and the browser Supabase client.
- `src/server` contains server-only auth, attachment, provider, security, and Supabase infrastructure.

## Import Rules

- Outside a feature, import feature modules via `@/features/<feature>` only.
- Do not import `@/server/*` from client/shared/feature code.
- Keep cross-feature internals private unless intentionally exported from that feature's `index.ts`.

## Public Entry Points

- Features expose public APIs through `src/features/*/index.ts`.
- Server infra is organized under `src/server/attachments`, `auth`, `chat`, `http`, `providers`, `redis`, `security`, `supabase`, `threads`, and `uploads`.
- Shared primitives and cross-layer data shapes are under `src/shared/core`, `contracts`, `streaming`, and `validation`.

ESLint enforces the important dependency edges: client/shared modules cannot import `src/server`, and code outside a feature cannot reach through that feature's private folders. Server-rendered app route entries may import server modules. Feature internals use relative imports; cross-feature imports go through each feature's public entry point.
