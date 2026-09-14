-- Remove dormant Search mode and make assistant persistence idempotent.

drop function if exists public.claim_pending_generation_job(uuid, uuid, integer);

alter table public.generation_jobs
  drop constraint if exists generation_jobs_mode_check,
  drop constraint if exists generation_jobs_search_mode_check,
  drop column if exists mode,
  drop column if exists use_search;

alter table public.messages
  add column if not exists reply_to_message_id uuid references public.messages(id) on delete set null;

create unique index if not exists messages_active_reply_link_idx
  on public.messages (reply_to_message_id)
  where reply_to_message_id is not null and deleted_at is null;

create index if not exists messages_thread_reply_link_idx
  on public.messages (thread_id, reply_to_message_id)
  where reply_to_message_id is not null;

create or replace function public.claim_pending_generation_job(
  p_thread_id uuid,
  p_user_message_id uuid default null,
  p_lease_seconds integer default 180
)
returns table (
  id uuid,
  user_message_id uuid,
  model_id text,
  reasoning_effort text,
  system_prompt text
)
language plpgsql
security invoker
set search_path = pg_catalog, public, pg_temp
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
    set status = 'claimed',
        claimed_at = now(),
        claim_expires_at = now() + make_interval(secs => greatest(30, p_lease_seconds)),
        error = null,
        updated_at = now()
    from candidate c
    where gj.id = c.id
    returning gj.id, gj.user_message_id, gj.model_id, gj.reasoning_effort, gj.system_prompt
  )
  select claimed.id, claimed.user_message_id, claimed.model_id,
         claimed.reasoning_effort, claimed.system_prompt
  from claimed;
end;
$$;

revoke all on function public.claim_pending_generation_job(uuid, uuid, integer) from public;
grant execute on function public.claim_pending_generation_job(uuid, uuid, integer) to authenticated;
