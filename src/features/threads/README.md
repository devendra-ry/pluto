# Threads Feature

This feature owns thread lifecycle state and operations.

Current modules:

- `hooks/use-threads.ts` for thread CRUD, pinning, refresh, and realtime sync.

Guideline:

- Thread-specific logic should live here instead of route files or generic hook folders.
