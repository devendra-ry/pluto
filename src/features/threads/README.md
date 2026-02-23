# Threads Feature

This feature owns thread lifecycle state and operations.

Current modules:

- `hooks/use-threads.ts` for thread CRUD, pinning, refresh, and realtime sync.
- `server/thread-ownership.ts` for API-side thread access checks.
- `lib/date-utils.ts` for thread date grouping/format utilities.

Guideline:

- Thread-specific logic should live here instead of route files or generic hook folders.
