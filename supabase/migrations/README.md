# Database migrations

These files are Pluto's ordered, append-only database history. Apply them with the Supabase CLI:

```sh
supabase link --project-ref <project-ref>
supabase db push
```

For a new local database, use `supabase start` followed by `supabase db reset`.

Do not edit a migration after it has been applied to a shared environment. Add a timestamped migration for each schema, policy, index, or database-function change. Deployments that previously ran the old `db/*.sql` scripts should reconcile their history before the first push; use `supabase migration list` and `supabase migration repair --help`.
