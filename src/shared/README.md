# Shared Layer

Use this layer for domain-agnostic building blocks reused across features.

Current modules:

- `components/error-boundary.tsx`
- `hooks/use-debounce.ts`

Guideline:

- If a module depends on a specific feature domain (chat, threads, messages), keep it under `src/features/*`.
