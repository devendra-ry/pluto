# Database migrations

These files are Pluto's ordered, append-only database history. Apply them with the Supabase CLI:

```sh
supabase link --project-ref <project-ref>
supabase db push
```

For a new local database, use `supabase start` followed by `supabase db reset`.

The `202607000000000_bootstrap_core.sql` migration makes the repository
self-contained for fresh databases. If an existing project was created from
the old external baseline, inspect `supabase migration list` and reconcile the
baseline with `supabase migration repair` before running `supabase db push`.

Do not edit a migration after it has been applied to a shared environment. Add a timestamped migration for each schema, policy, index, or database-function change. Deployments that previously ran the old `db/*.sql` scripts should reconcile their history before the first push; use `supabase migration list` and `supabase migration repair --help`.
