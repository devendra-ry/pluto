# Branching, deletion, and file cleanup

Branches are created by `branch_thread` in one PostgreSQL transaction. The database reads the complete visible prefix through the selected message, preserves its `(created_at, id)` order using new monotonic timestamps, remaps reply links, and copies conversation settings. A failed copy leaves no partial branch.

Branches share stored objects. A surviving conversation reference keeps the object readable even after its parent conversation is removed. Storage policies prevent replacing objects or removing an object referenced by an active conversation, including soft-deleted messages that can still be restored.

Deleting a conversation hides it immediately and queues cleanup atomically. The database grants a 30-second Undo window. References in another conversation's Undo window also protect shared files. After that window, an authenticated cleanup request claims bounded jobs with expiring tokens, removes unused objects, and completes the database deletion only after storage succeeds. Partial failures retry with backoff; stale tokens cannot finish a newer claim.

Cleanup runs on sign-in, reconnect, visibility changes, and every 30 seconds while a signed-in page is visible. Jobs remain durable while the user is offline and resume on the next active session. This is not an independently scheduled background service. The queue and storage policies do not require a service-role key in the application.

Apply migration `202610020006_atomic_branch_and_thread_cleanup.sql` together with the application changes. Earlier clients that issue direct thread deletes must refresh because those privileges are revoked. The default bucket is `chat-attachments`; any separately configured bucket needs corresponding policies.

## Database verification

With Supabase CLI 2.119.0, Docker, and the PostgreSQL client installed:

```sh
supabase start
supabase db reset --local
npm run test:database
```

The database runner only accepts a PostgreSQL URL with a loopback host and no connection query parameters. Override its default port with `PLUTO_TEST_DATABASE_URL` for an isolated local instance. SQL regressions roll back fixtures; the concurrency tests create committed fixtures for two independent sessions and remove them in `finally`. They cover competing edits, edits against response persistence, and branching against message deletion.

CI starts fresh local Supabase, applies and resets all migrations, then runs generation fencing, branching/Undo/storage ownership policies, database performance/permission regressions, long-prefix reply mapping, and competing-edit regressions. On October 2, 2026, all pending migrations and all four SQL regression suites also passed in rollback transactions against the configured Supabase project. Twelve missing migrations were applied and confirmed through `202610020008`; no migration remains pending in that project. Fresh embedded PostgreSQL checks passed too. Docker and `psql` remain unavailable on the development machine, so the two-session concurrency test still requires CI or a local Supabase installation. See `database-performance.md` for the native query-plan evidence.
