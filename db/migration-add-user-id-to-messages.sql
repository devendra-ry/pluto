-- Migration: Add user_id to messages and optimize RLS
-- Run this in the Supabase SQL Editor

-- 1. Add user_id column (nullable first, with default auth.uid() for new inserts)
alter table public.messages
add column if not exists user_id uuid default auth.uid();

-- 2. Backfill user_id from threads for existing messages
-- Using a join to update user_id based on the thread ownership
update public.messages m
set user_id = t.user_id
from public.threads t
where m.thread_id = t.id
  and m.user_id is null;

-- 3. Enforce Not Null constraint
-- This ensures all future messages must have a user_id
alter table public.messages
alter column user_id set not null;

-- 4. Create Index on user_id for performance
create index if not exists messages_user_id_idx
on public.messages(user_id);

-- 5. Update RLS Policies to use the new column
-- Drop old policies
drop policy if exists "Users can view messages in their threads" on public.messages;
drop policy if exists "Users can insert messages in their threads" on public.messages;
drop policy if exists "Users can delete messages in their threads" on public.messages;
drop policy if exists "Users can update messages in their threads" on public.messages;

-- Create new optimized policies
create policy "Users can view messages in their threads"
on public.messages
for select
to authenticated
using (user_id = auth.uid());

create policy "Users can insert messages in their threads"
on public.messages
for insert
to authenticated
with check (
  user_id = auth.uid()
  and exists (
    select 1
    from public.threads
    where threads.id = messages.thread_id
      and threads.user_id = auth.uid()
  )
);

create policy "Users can delete messages in their threads"
on public.messages
for delete
to authenticated
using (user_id = auth.uid());

create policy "Users can update messages in their threads"
on public.messages
for update
to authenticated
using (user_id = auth.uid())
with check (
  user_id = auth.uid()
  and exists (
    select 1
    from public.threads
    where threads.id = messages.thread_id
      and threads.user_id = auth.uid()
  )
);

-- 6. Refresh planner statistics
analyze public.messages;
