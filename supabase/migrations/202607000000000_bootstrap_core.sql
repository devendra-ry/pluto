-- Core schema bootstrap for fresh Supabase databases.
-- This migration is intentionally idempotent so it can also be reconciled with
-- installations that were created from the original external schema.

create table if not exists public.threads (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null,
  title text not null default 'New Chat',
  model text,
  reasoning_effort text,
  system_prompt text,
  is_pinned boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.messages (
  id uuid primary key default gen_random_uuid(),
  thread_id uuid not null references public.threads(id) on delete cascade,
  user_id uuid not null default auth.uid(),
  role text not null,
  content text,
  reasoning text,
  model_id text,
  attachments jsonb not null default '[]'::jsonb,
  reply_stats jsonb,
  deleted_at timestamptz,
  deleted_by uuid,
  created_at timestamptz not null default now()
);

create index if not exists threads_user_updated_idx
  on public.threads (user_id, updated_at desc);
create index if not exists messages_thread_created_idx
  on public.messages (thread_id, created_at);

alter table public.threads enable row level security;
alter table public.messages enable row level security;

drop policy if exists "Users can view their own threads" on public.threads;
create policy "Users can view their own threads"
  on public.threads for select to authenticated
  using (user_id = (select auth.uid()));

drop policy if exists "Users can create their own threads" on public.threads;
create policy "Users can create their own threads"
  on public.threads for insert to authenticated
  with check (user_id = (select auth.uid()));

drop policy if exists "Users can update their own threads" on public.threads;
create policy "Users can update their own threads"
  on public.threads for update to authenticated
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));

drop policy if exists "Users can delete their own threads" on public.threads;
create policy "Users can delete their own threads"
  on public.threads for delete to authenticated
  using (user_id = (select auth.uid()));

drop policy if exists "Users can view messages in their threads" on public.messages;
create policy "Users can view messages in their threads"
  on public.messages for select to authenticated
  using (user_id = (select auth.uid()));

drop policy if exists "Users can insert messages in their threads" on public.messages;
create policy "Users can insert messages in their threads"
  on public.messages for insert to authenticated
  with check (
    user_id = (select auth.uid())
    and exists (
      select 1 from public.threads t
      where t.id = messages.thread_id and t.user_id = (select auth.uid())
    )
  );

drop policy if exists "Users can delete messages in their threads" on public.messages;
create policy "Users can delete messages in their threads"
  on public.messages for delete to authenticated
  using (user_id = (select auth.uid()));

drop policy if exists "Users can update messages in their threads" on public.messages;
create policy "Users can update messages in their threads"
  on public.messages for update to authenticated
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));
