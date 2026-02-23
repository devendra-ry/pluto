-- Durable generation handoff jobs (run in Supabase SQL editor)

create table if not exists public.generation_jobs (
  id uuid primary key default gen_random_uuid(),
  thread_id uuid not null references public.threads(id) on delete cascade,
  user_message_id uuid not null references public.messages(id) on delete cascade,
  user_id uuid not null default auth.uid(),
  mode text not null,
  model_id text null,
  use_search boolean not null default false,
  reasoning_effort text null,
  system_prompt text null,
  status text not null default 'pending',
  claimed_at timestamptz null,
  claim_expires_at timestamptz null,
  error text null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint generation_jobs_mode_check check (mode in ('chat', 'image', 'image-edit', 'video', 'search')),
  constraint generation_jobs_reasoning_effort_check check (
    reasoning_effort in ('low', 'medium', 'high') or reasoning_effort is null
  ),
  constraint generation_jobs_status_check check (status in ('pending', 'claimed', 'completed', 'failed'))
);

create unique index if not exists generation_jobs_user_message_key
  on public.generation_jobs (user_message_id);

create index if not exists generation_jobs_thread_status_created_idx
  on public.generation_jobs (thread_id, status, created_at asc);

create index if not exists generation_jobs_user_status_created_idx
  on public.generation_jobs (user_id, status, created_at desc);

alter table public.generation_jobs enable row level security;

drop policy if exists "Users can view own generation jobs" on public.generation_jobs;
create policy "Users can view own generation jobs"
on public.generation_jobs
for select
to authenticated
using (
  user_id = (select auth.uid())
  and exists (
    select 1
    from public.threads t
    where t.id = generation_jobs.thread_id
      and t.user_id = (select auth.uid())
  )
);

drop policy if exists "Users can insert own generation jobs" on public.generation_jobs;
create policy "Users can insert own generation jobs"
on public.generation_jobs
for insert
to authenticated
with check (
  user_id = (select auth.uid())
  and exists (
    select 1
    from public.threads t
    where t.id = generation_jobs.thread_id
      and t.user_id = (select auth.uid())
  )
  and exists (
    select 1
    from public.messages m
    where m.id = generation_jobs.user_message_id
      and m.thread_id = generation_jobs.thread_id
      and m.user_id = (select auth.uid())
      and m.role = 'user'
  )
);

drop policy if exists "Users can update own generation jobs" on public.generation_jobs;
create policy "Users can update own generation jobs"
on public.generation_jobs
for update
to authenticated
using (
  user_id = (select auth.uid())
  and exists (
    select 1
    from public.threads t
    where t.id = generation_jobs.thread_id
      and t.user_id = (select auth.uid())
  )
)
with check (
  user_id = (select auth.uid())
  and exists (
    select 1
    from public.threads t
    where t.id = generation_jobs.thread_id
      and t.user_id = (select auth.uid())
  )
);

create or replace function public.claim_pending_generation_job(
  p_thread_id uuid,
  p_user_message_id uuid default null,
  p_lease_seconds integer default 180
)
returns table (
  id uuid,
  user_message_id uuid,
  mode text,
  model_id text,
  use_search boolean,
  reasoning_effort text,
  system_prompt text
)
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_user_id uuid := auth.uid();
begin
  if v_user_id is null then
    raise exception 'Not authenticated';
  end if;

  return query
  with candidate as (
    select gj.id
    from public.generation_jobs gj
    join public.threads t on t.id = gj.thread_id
    where gj.thread_id = p_thread_id
      and t.user_id = v_user_id
      and gj.user_id = v_user_id
      and (p_user_message_id is null or gj.user_message_id = p_user_message_id)
      and (
        gj.status = 'pending'
        or (gj.status = 'claimed' and gj.claim_expires_at is not null and gj.claim_expires_at < now())
      )
    order by gj.created_at asc
    limit 1
    for update skip locked
  ),
  claimed as (
    update public.generation_jobs gj
    set
      status = 'claimed',
      claimed_at = now(),
      claim_expires_at = now() + make_interval(secs => greatest(30, p_lease_seconds)),
      error = null,
      updated_at = now()
    from candidate c
    where gj.id = c.id
    returning
      gj.id,
      gj.user_message_id,
      gj.mode,
      gj.model_id,
      gj.use_search,
      gj.reasoning_effort,
      gj.system_prompt
  )
  select
    claimed.id,
    claimed.user_message_id,
    claimed.mode,
    claimed.model_id,
    claimed.use_search,
    claimed.reasoning_effort,
    claimed.system_prompt
  from claimed;
end;
$$;

create or replace function public.complete_generation_job(
  p_job_id uuid,
  p_status text,
  p_error text default null
)
returns boolean
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_user_id uuid := auth.uid();
  v_updated integer := 0;
begin
  if v_user_id is null then
    raise exception 'Not authenticated';
  end if;

  if p_status not in ('completed', 'failed') then
    raise exception 'Invalid status for completion: %', p_status;
  end if;

  update public.generation_jobs gj
  set
    status = p_status,
    error = case when p_status = 'failed' then left(coalesce(p_error, 'Generation failed'), 5000) else null end,
    claim_expires_at = null,
    updated_at = now()
  where gj.id = p_job_id
    and gj.user_id = v_user_id
    and gj.status in ('pending', 'claimed');

  get diagnostics v_updated = row_count;
  return v_updated > 0;
end;
$$;

revoke all on function public.claim_pending_generation_job(uuid, uuid, integer) from public;
grant execute on function public.claim_pending_generation_job(uuid, uuid, integer) to authenticated;

revoke all on function public.complete_generation_job(uuid, text, text) from public;
grant execute on function public.complete_generation_job(uuid, text, text) to authenticated;
