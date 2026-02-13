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

-- 3) Storage bucket + RLS for user-scoped attachments.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'chat-attachments',
  'chat-attachments',
  false,
  20971520,
  array['image/png', 'image/jpeg', 'image/webp', 'image/gif', 'application/pdf']
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

-- 4) Query-performance indexes for common app reads.
create index if not exists messages_thread_created_idx
  on public.messages (thread_id, created_at);

create index if not exists threads_user_updated_idx
  on public.threads (user_id, updated_at desc);

create index if not exists threads_user_pinned_updated_idx
  on public.threads (user_id, is_pinned, updated_at desc);
