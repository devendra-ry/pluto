-- Pluto DB hardening (run in Supabase SQL editor)

-- 1) Ensure message writes are allowed only for owners of the parent thread.
drop policy if exists "Users can delete messages in their threads" on public.messages;
create policy "Users can delete messages in their threads"
on public.messages
for delete
to authenticated
using (
  exists (
    select 1
    from public.threads
    where threads.id = messages.thread_id
      and threads.user_id = auth.uid()
  )
);

drop policy if exists "Users can update messages in their threads" on public.messages;
create policy "Users can update messages in their threads"
on public.messages
for update
to authenticated
using (
  exists (
    select 1
    from public.threads
    where threads.id = messages.thread_id
      and threads.user_id = auth.uid()
  )
)
with check (
  exists (
    select 1
    from public.threads
    where threads.id = messages.thread_id
      and threads.user_id = auth.uid()
  )
);

-- 2) Basic data integrity checks.
alter table public.messages
  drop constraint if exists messages_role_check;
alter table public.messages
  add constraint messages_role_check
  check (role in ('user', 'assistant'));

alter table public.messages
  drop constraint if exists messages_nonempty_check;
alter table public.messages
  add constraint messages_nonempty_check
  check (
    coalesce(length(content), 0) > 0
    or coalesce(length(reasoning), 0) > 0
  );

alter table public.threads
  drop constraint if exists threads_reasoning_effort_check;
alter table public.threads
  add constraint threads_reasoning_effort_check
  check (reasoning_effort in ('low', 'medium', 'high') or reasoning_effort is null);

-- 3) Query-performance indexes for common app reads.
create index if not exists messages_thread_created_idx
  on public.messages (thread_id, created_at);

create index if not exists threads_user_updated_idx
  on public.threads (user_id, updated_at desc);

create index if not exists threads_user_pinned_updated_idx
  on public.threads (user_id, is_pinned, updated_at desc);
