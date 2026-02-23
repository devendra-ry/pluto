# Threads Feature

This feature owns thread lifecycle state and operations.

Current modules:

- `hooks/use-threads.ts` for thread CRUD, pinning, refresh, and realtime sync.
- `components/sidebar.tsx` for thread navigation and thread-level actions.
- `server/thread-ownership.ts` for API-side thread access checks.
- `lib/date-utils.ts` for thread date grouping/format utilities.
- `lib/sanitize-thread-title.ts` for consistent thread-title sanitization.

Guideline:

- Thread-specific logic should live here instead of route files or generic hook folders.
