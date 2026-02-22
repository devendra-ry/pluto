# Performance Improvement: Optimize Messages RLS

## Objective
Optimize the Row Level Security (RLS) policies for the `messages` table to improve query performance, particularly for read operations.

## The Problem
The previous RLS policy for `messages` relied on a correlated subquery (or join) to the `threads` table to verify ownership:

```sql
create policy "Users can view messages in their threads"
on public.messages
for select
to authenticated
using (
  exists (
    select 1
    from public.threads
    where threads.id = messages.thread_id
      and threads.user_id = (select auth.uid())
  )
);
```

For every row in `messages` being checked, the database might need to look up the corresponding thread. While the Postgres optimizer is efficient, this adds overhead, especially as the number of messages grows. It effectively forces a join structure for every query on `messages`.

## The Solution
We added a `user_id` column directly to the `messages` table. This allows us to simplify the RLS policy to a direct column check:

```sql
create policy "Users can view messages in their threads"
on public.messages
for select
to authenticated
using (user_id = auth.uid());
```

This removes the need for a join/lookup against the `threads` table during permission checks.

## Benchmark & Verification

To verify the improvement, you can run the following `EXPLAIN ANALYZE` commands in the Supabase SQL Editor.

### 1. Setup Data (if needed)
Ensure you have a thread and some messages.

### 2. Test Query
Select all messages for a specific thread (common use case).

```sql
explain analyze
select * from messages
where thread_id = 'your-thread-uuid';
```

### 3. Comparison

#### Before Optimization (Theoretical Plan)
```text
Seq Scan on messages  (cost=0.00..XX.XX rows=... width=...)
  Filter: ((thread_id = '...'::uuid) AND (EXISTS (SELECT 1 FROM threads WHERE ((threads.id = messages.thread_id) AND (threads.user_id = auth.uid())))))
  ...
  ->  Index Scan using threads_pkey on threads  (cost=0.15..8.17 rows=1 width=0)
        Index Cond: (id = messages.thread_id)
        Filter: (user_id = auth.uid())
```
*Note: The planner might optimize this to a semi-join, but the dependency on `threads` remains.*

#### After Optimization (Expected Plan)
```text
Index Scan using messages_thread_created_idx on messages  (cost=0.15..XX.XX rows=... width=...)
  Index Cond: (thread_id = '...'::uuid)
  Filter: (user_id = auth.uid())
```
With the new policy, the query plan only accesses the `messages` table. The `Filter: (user_id = auth.uid())` is applied directly to the rows found by the index on `thread_id` (or `user_id` if used).

If querying *all* messages (e.g., search):
```sql
explain analyze select * from messages where content ilike '%search%';
```
**Before**: Would involve scanning `messages` and for each match, checking `threads`.
**After**: Scans `messages` and checks `user_id` on the row itself. This is significantly faster for large datasets.

## Implementation Details
1.  **Migration**: `db/migration-add-user-id-to-messages.sql` adds the column, backfills data, adds `NOT NULL`, and indexes it.
2.  **Hardening**: `db/supabase-hardening.sql` is updated to reflect the new schema and policies.
3.  **Types**: `src/utils/supabase/database.types.ts` is updated to include `user_id`.
