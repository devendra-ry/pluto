# Shared Layer

Use this layer for domain-agnostic building blocks reused across features.

Current modules:

- `core/constants.ts`
- `core/types.ts`
- `core/utils.ts`
- `core/models.json`
- `config/public.ts`
- `config/server.ts`
- `components/error-boundary.tsx`
- `hooks/use-debounce.ts`
- `providers/query-provider.tsx`
- `lib/animation-frame.ts`
- `lib/query-client.ts`
- `validation/request-validation.ts`

Guideline:

- If a module depends on a specific feature domain (chat, threads, messages), keep it under `src/features/*`.
