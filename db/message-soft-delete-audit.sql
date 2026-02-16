-- Message soft-delete + audit trail (run in Supabase SQL editor)

alter table public.messages
  add column if not exists deleted_at timestamptz null,
  add column if not exists deleted_by uuid null;

create index if not exists messages_thread_visible_created_id_desc_idx
  on public.messages (thread_id, created_at desc, id desc)
  where deleted_at is null;

create table if not exists public.message_delete_audit (
  id uuid primary key default gen_random_uuid(),
  actor_user_id uuid not null,
  thread_id uuid not null references public.threads(id) on delete cascade,
  message_ids uuid[] not null,
  reason text not null default 'manual',
  anchor_message_id uuid null,
  created_at timestamptz not null default now(),
  restored_at timestamptz null
);

create index if not exists message_delete_audit_thread_created_idx
  on public.message_delete_audit (thread_id, created_at desc);

create index if not exists message_delete_audit_actor_created_idx
  on public.message_delete_audit (actor_user_id, created_at desc);

alter table public.message_delete_audit enable row level security;

drop policy if exists "Users can view own message delete audit" on public.message_delete_audit;
create policy "Users can view own message delete audit"
on public.message_delete_audit
for select
to authenticated
using (
  exists (
    select 1
    from public.threads t
    where t.id = message_delete_audit.thread_id
      and t.user_id = (select auth.uid())
  )
);

drop policy if exists "Users can insert own message delete audit" on public.message_delete_audit;
create policy "Users can insert own message delete audit"
on public.message_delete_audit
for insert
to authenticated
with check (
  actor_user_id = (select auth.uid())
  and exists (
    select 1
    from public.threads t
    where t.id = message_delete_audit.thread_id
      and t.user_id = (select auth.uid())
  )
);

drop policy if exists "Users can update own message delete audit" on public.message_delete_audit;
create policy "Users can update own message delete audit"
on public.message_delete_audit
for update
to authenticated
using (
  actor_user_id = (select auth.uid())
  and exists (
    select 1
    from public.threads t
    where t.id = message_delete_audit.thread_id
      and t.user_id = (select auth.uid())
  )
)
with check (
  actor_user_id = (select auth.uid())
  and exists (
    select 1
    from public.threads t
    where t.id = message_delete_audit.thread_id
      and t.user_id = (select auth.uid())
  )
);

create or replace function public.soft_delete_messages(
  p_message_ids uuid[],
  p_reason text default 'manual',
  p_anchor_message_id uuid default null
)
returns integer
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_user_id uuid := auth.uid();
  v_count integer := 0;
begin
  if v_user_id is null then
    raise exception 'Not authenticated';
  end if;

  with target as (
    select m.id, m.thread_id
    from public.messages m
    join public.threads t on t.id = m.thread_id
    where m.id = any(p_message_ids)
      and m.deleted_at is null
      and t.user_id = v_user_id
  ),
  updated as (
    update public.messages m
    set deleted_at = now(),
        deleted_by = v_user_id
    from target
    where m.id = target.id
    returning m.id, m.thread_id
  ),
  counted as (
    select count(*)::integer as deleted_count
    from updated
  ),
  grouped as (
    select thread_id, array_agg(id)::uuid[] as ids
    from updated
    group by thread_id
  ),
  inserted as (
    insert into public.message_delete_audit (
      actor_user_id,
      thread_id,
      message_ids,
      reason,
      anchor_message_id
    )
    select
      v_user_id,
      g.thread_id,
      g.ids,
      coalesce(nullif(trim(p_reason), ''), 'manual'),
      p_anchor_message_id
    from grouped g
    returning 1
  )
  select coalesce((select deleted_count from counted), 0)
  into v_count;

  return v_count;
end;
$$;

create or replace function public.restore_soft_deleted_messages(
  p_message_ids uuid[],
  p_restore_window_minutes integer default 1440
)
returns integer
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_user_id uuid := auth.uid();
  v_count integer := 0;
begin
  if v_user_id is null then
    raise exception 'Not authenticated';
  end if;

  with target as (
    select m.id
    from public.messages m
    join public.threads t on t.id = m.thread_id
    where m.id = any(p_message_ids)
      and m.deleted_by = v_user_id
      and m.deleted_at is not null
      and m.deleted_at >= now() - make_interval(mins => greatest(1, p_restore_window_minutes))
      and t.user_id = v_user_id
  ),
  restored as (
    update public.messages m
    set deleted_at = null,
        deleted_by = null
    from target
    where m.id = target.id
    returning m.id
  )
  select count(*)::integer into v_count
  from restored;

  update public.message_delete_audit a
  set restored_at = now()
  where a.actor_user_id = v_user_id
    and a.restored_at is null
    and exists (
      select 1
      from unnest(a.message_ids) as mid
      where mid = any(p_message_ids)
    );

  return v_count;
end;
$$;

revoke all on function public.soft_delete_messages(uuid[], text, uuid) from public;
grant execute on function public.soft_delete_messages(uuid[], text, uuid) to authenticated;

revoke all on function public.restore_soft_deleted_messages(uuid[], integer) from public;
grant execute on function public.restore_soft_deleted_messages(uuid[], integer) to authenticated;
