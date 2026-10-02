# Database performance and rollout

On October 2, 2026, the configured Supabase project `dev.chat`
(`qaumkvcchwufibtnlsxz`) was brought up to the repository migration history
through `202610020008_linear_branch_reply_mapping.sql`. Twelve missing migrations
were applied, including four September prerequisites and eight October migrations.
Each migration and its history entry were committed together, with lock and
statement timeouts. The CLI's login-role provisioning failed on an existing role
permission, so deployment used the authenticated Supabase Management API. No
managed login-role permissions were changed. A final history check reported no
pending migrations.

Before deployment, the complete pending sequence and the SQL regression
suites passed on the actual Supabase PostgreSQL database in a transaction that
was rolled back. All four suites passed against the final migration definitions;
post-deployment verification also passed. Fresh embedded
PostgreSQL checks also passed. No test chats,
messages, generation jobs, or storage objects remained after verification.

## Changes

- Visible message bodies have a schema-aware `pg_trgm` GIN index for substring
  search. Very short or common searches can still favor the conversation index.
- Attachment references use exact JSON containment and a `jsonb_path_ops` GIN
  index. The full index also supports the upload proxy's existing containment
  query; deleted messages remain indexed to preserve attachment Undo lifetimes.
- Storage ownership checks parse a canonical thread UUID and use its primary
  key instead of casting every indexed thread ID to text. Existing ownership,
  shared-branch, cleanup-lease, and Undo checks remain in force.
- The active thread cursor index has a distinct name and a tombstone predicate.
  The old name in migration 006 did not replace its existing non-partial index.
- Message restore uses indexed audit-array overlap against only the IDs actually
  restored, retaining validation and the established parent-first lock order.
- Branching materializes a thin UUID mapping once and joins reply targets to it,
  replacing a per-message array scan that became quadratic on long histories.
  Large message bodies are fetched separately. A 600-message tied-timestamp
  regression checks the complete anchored prefix and in/out-of-prefix replies.
- Cleanup jobs have an indexed account foreign key with cascading removal.
  They intentionally have no thread foreign key because completed receipts can
  outlive a deleted thread.
- Old column-level message UPDATE grants are revoked explicitly, keeping edits
  on the supported locking/auditing RPC path.
- A matching server-prefetched conversation no longer causes a duplicate SELECT
  on hydration. Mismatched prefetch data and late responses cannot show another
  conversation's settings during navigation.
- Live schema types include the new tables, relationships and helper functions.
  `npm run db:types` uses the configured project and writes atomically after
  validating generation and refining SQL-defined nullable RPC contracts. A
  failed generator preserves the existing types file.

## Query-plan evidence

The opt-in benchmark clones the current tables and indexes into temporary tables
and generates 20,000 messages across 201 conversations and 20 users. It rolls
back, leaving public data and planner statistics unchanged. It exercises a
15,000-message conversation with a rare search term and sparse attachments.

A native Supabase PostgreSQL run compared these cloned indexes with the same
temporary dataset after removing the temporary message GIN indexes:

| Query | Baseline | Indexed | Local buffers, baseline → indexed |
| --- | ---: | ---: | ---: |
| Rare conversation substring search | 37.30 ms | 5.91 ms | 515 → 270 |
| Active-conversation attachment lookup | 4.66 ms | 1.24 ms | 484 → 72 |
| Recent message cursor, 51 rows | 0.05 ms | 0.09 ms | 5 → 5 |

Search and attachment lookup selected the new GIN indexes. Cursor reads already
used the partial conversation B-tree. These are individual synthetic runs with
bulk-insert GIN pending lists and cache effects, not production percentiles or
an end-to-end application speedup. The live application tables were empty, so
production latency comparisons are not available. Embedded PostgreSQL confirmed
the JSON index path but did not select the trigram index; native plans establish
that the deployed PostgreSQL engine can use it.

To reproduce the plans in an isolated local Supabase instance:

```sh
supabase start
supabase db reset --local
npm run test:database
npm run benchmark:database
```

The test and benchmark runners accept only loopback PostgreSQL URLs without
connection query parameters. Set `PLUTO_TEST_DATABASE_URL` to change the local
port. The benchmark requires `psql` and runs only when explicitly requested.
Multi-session concurrency checks still require the local Docker/`psql` setup or
the configured CI job; the Management API rollback checks do not replace them.

## Advisor review

The deployed project's performance advisor returned no warnings or errors.
Its unused-index informational findings are expected on empty tables; indexes
were retained rather than dropped based on an empty workload. The cleanup queue
has RLS enabled without client policies intentionally: clients use checked RPCs.

Security advisories flag the intentionally authenticated SECURITY DEFINER RPCs.
Their entry points check the caller, ownership, and state; fixed search paths and
cross-user regression tests are maintained. Supabase also reports disabled
leaked-password protection, an existing Auth service setting outside this
database migration. That setting was not changed by the migration rollout.

Use real workload plans and `pg_stat_statements` before changing planner settings,
adding more indexes, dropping older indexes, or introducing retention policies.
Completed generation jobs remain available for idempotent retries.
