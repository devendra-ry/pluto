-- Pluto DB hardening (run in Supabase SQL editor)

-- 1) RLS policies with initplan-friendly auth checks.
-- Threads
drop policy if exists "Users can view their own threads" on public.threads;
create policy "Users can view their own threads"
on public.threads
for select
to authenticated
using (user_id = (select auth.uid()));

drop policy if exists "Users can create their own threads" on public.threads;
create policy "Users can create their own threads"
on public.threads
for insert
to authenticated
with check (user_id = (select auth.uid()));

drop policy if exists "Users can update their own threads" on public.threads;
create policy "Users can update their own threads"
on public.threads
for update
to authenticated
using (user_id = (select auth.uid()))
with check (user_id = (select auth.uid()));

drop policy if exists "Users can delete their own threads" on public.threads;
create policy "Users can delete their own threads"
on public.threads
for delete
to authenticated
using (user_id = (select auth.uid()));

-- Messages
drop policy if exists "Users can view messages in their threads" on public.messages;
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

drop policy if exists "Users can insert messages in their threads" on public.messages;
create policy "Users can insert messages in their threads"
on public.messages
for insert
to authenticated
with check (
  exists (
    select 1
    from public.threads
    where threads.id = messages.thread_id
      and threads.user_id = (select auth.uid())
  )
);

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
      and threads.user_id = (select auth.uid())
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
      and threads.user_id = (select auth.uid())
  )
)
with check (
  exists (
    select 1
    from public.threads
    where threads.id = messages.thread_id
      and threads.user_id = (select auth.uid())
  )
);

-- 2) Basic data integrity checks.
alter table public.messages
  drop constraint if exists messages_role_check;
alter table public.messages
  add constraint messages_role_check
  check (role in ('user', 'assistant'));

alter table public.messages
  add column if not exists attachments jsonb not null default '[]'::jsonb;

alter table public.messages
  drop constraint if exists messages_attachments_array_check;
alter table public.messages
  add constraint messages_attachments_array_check
  check (jsonb_typeof(attachments) = 'array');

alter table public.messages
  drop constraint if exists messages_nonempty_check;
alter table public.messages
  add constraint messages_nonempty_check
  check (
    coalesce(length(content), 0) > 0
    or coalesce(length(reasoning), 0) > 0
    or coalesce(jsonb_array_length(attachments), 0) > 0
  );

alter table public.threads
  drop constraint if exists threads_reasoning_effort_check;
alter table public.threads
  add constraint threads_reasoning_effort_check
  check (reasoning_effort in ('low', 'medium', 'high') or reasoning_effort is null);

alter table public.threads
  add column if not exists system_prompt text;

alter table public.threads
  drop constraint if exists threads_system_prompt_length_check;
alter table public.threads
  add constraint threads_system_prompt_length_check
  check (system_prompt is null or length(system_prompt) <= 12000);

-- 3) Storage bucket + RLS for user-scoped attachments.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'chat-attachments',
  'chat-attachments',
  false,
  104857600,
  array['image/png', 'image/jpeg', 'image/webp', 'image/gif', 'video/mp4', 'application/pdf', 'text/plain']
)
on conflict (id) do update
set
  public = excluded.public,
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists "Users can read own attachments" on storage.objects;
create policy "Users can read own attachments"
on storage.objects
for select
to authenticated
using (
  bucket_id = 'chat-attachments'
  and (storage.foldername(name))[1] = auth.uid()::text
);

drop policy if exists "Users can insert own attachments" on storage.objects;
create policy "Users can insert own attachments"
on storage.objects
for insert
to authenticated
with check (
  bucket_id = 'chat-attachments'
  and (storage.foldername(name))[1] = auth.uid()::text
);

drop policy if exists "Users can update own attachments" on storage.objects;
create policy "Users can update own attachments"
on storage.objects
for update
to authenticated
using (
  bucket_id = 'chat-attachments'
  and (storage.foldername(name))[1] = auth.uid()::text
)
with check (
  bucket_id = 'chat-attachments'
  and (storage.foldername(name))[1] = auth.uid()::text
);

drop policy if exists "Users can delete own attachments" on storage.objects;
create policy "Users can delete own attachments"
on storage.objects
for delete
to authenticated
using (
  bucket_id = 'chat-attachments'
  and (storage.foldername(name))[1] = auth.uid()::text
);

-- 4) Single-query cleanup helper to avoid client-side N+1 deletes.
create or replace function public.cleanup_empty_new_chat_threads(exclude_thread_id uuid default null)
returns integer
language sql
security invoker
set search_path = public
as $$
  with deleted as (
    delete from public.threads t
    where t.title = 'New Chat'
      and t.user_id = auth.uid()
      and (exclude_thread_id is null or t.id <> exclude_thread_id)
      and not exists (
        select 1
        from public.messages m
        where m.thread_id = t.id
      )
    returning 1
  )
  select count(*)::integer from deleted;
$$;

revoke all on function public.cleanup_empty_new_chat_threads(uuid) from public;
grant execute on function public.cleanup_empty_new_chat_threads(uuid) to authenticated;

-- 5) Query-performance indexes for common app reads.
create index if not exists messages_thread_created_idx
  on public.messages (thread_id, created_at);

create index if not exists messages_thread_created_id_desc_idx
  on public.messages (thread_id, created_at desc, id desc);

create index if not exists messages_created_id_desc_idx
  on public.messages (created_at desc, id desc);

create index if not exists threads_user_updated_idx
  on public.threads (user_id, updated_at desc);

create index if not exists threads_user_pinned_updated_idx
  on public.threads (user_id, is_pinned, updated_at desc);

-- 6) Refresh planner statistics after index changes.
analyze public.messages;
