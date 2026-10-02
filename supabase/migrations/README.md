# Database migrations

These files are Pluto's ordered, append-only database history. Apply them with the Supabase CLI:

```sh
supabase link --project-ref <project-ref>
supabase db push
```

For a new local database, use `supabase start` followed by `supabase db reset --local`.
The checked-in `supabase/config.toml` uses an isolated local PostgreSQL 17 database.
Use Supabase CLI 2.119.0, as pinned in CI; older CLI versions may reject the local
service configuration.
Run `npm run test:database` with the PostgreSQL client installed. CI also applies
the entire migration history to a fresh local Supabase instance and resets it.

The claim-token regression script at `supabase/tests/generation_job_claim_fencing.sql`
checks stale and current completion tokens, stale and current response persistence,
and a deleted prompt anchor. It runs inside a transaction and rolls back its fixtures;
run it with `psql` against the local database after applying migrations. The
database runner also executes `thread_lifecycle.sql` and a two-session competing
edit regression. SQL fixtures roll back; concurrency fixtures are removed after
the test. The runner rejects database URLs outside loopback hosts.

`202610020005_thread_search_pagination_indexes.sql` adds the per-user tuple
index for conversation cursors and a `pg_trgm` title index for substring search.
It finds the extension's installed schema, including existing installations in
`public`. Apply it alongside the preceding four application migrations before
deploying this batch.

`202610020006_atomic_branch_and_thread_cleanup.sql` adds transactional branching,
30-second Undo, durable fenced cleanup jobs, and shared attachment policies.
Apply all six new migrations together with the application update. Direct thread
deletes are revoked, so older clients must refresh. Cleanup resumes while an
authenticated browser session is active; see `docs/thread-lifecycle.md` for its
offline behavior and verification limits.

`202610020007_database_hot_path_indexes.sql` indexes visible message search,
attachment containment, active thread cursors, and unrestored audit IDs. It
preserves shared-file retention and locking rules, revokes legacy column-level
message UPDATE grants, and adds account cleanup for durable jobs. Run the
rollback-only `database_performance.sql` regression with the other database tests.
`npm run benchmark:database` prints query plans from temporary cloned tables and
20,000 synthetic messages without changing public data or statistics.

`202610020008_linear_branch_reply_mapping.sql` replaces per-reply UUID-array
scans with a thin materialized mapping and relational joins. It retains the
complete anchored prefix, deterministic ordering, settings, locking, and atomic
copy behavior. `branch_mapping.sql` checks a dense, tied-timestamp prefix.

On October 2, 2026, the configured `dev.chat` project was verified and all twelve
missing migrations (four September prerequisites and eight October migrations)
were applied through `202610020008`. No migrations remained pending. Actual
Supabase rollback regressions and native query plans were checked; see
`docs/database-performance.md` for deployment evidence and remaining CI checks.

`npm run db:types` generates types from the configured project's schema, validates
the result and nullable RPC contracts, then replaces the types file atomically.
CLI failure leaves the existing types intact; local project linking is not needed
for this command.

The `202607000000000_bootstrap_core.sql` migration makes the repository
self-contained for fresh databases. If an existing project was created from
the old external baseline, inspect `supabase migration list` and reconcile the
baseline with `supabase migration repair` before running `supabase db push`.

Do not edit a migration after it has been applied to a shared environment. Add a timestamped migration for each schema, policy, index, or database-function change. Deployments that previously ran the old `db/*.sql` scripts should reconcile their history before the first push; use `supabase migration list` and `supabase migration repair --help`.
