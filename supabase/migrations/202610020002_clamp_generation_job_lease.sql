-- Keep expired-claim recovery bounded. The 2026-09-14 replacement dropped the
-- 30-to-600 second clamp, allowing authenticated callers to hold their own
-- generation jobs for arbitrarily long periods.
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
security definer
set search_path = pg_catalog, public, pg_temp
as $$
declare
  v_user_id uuid := auth.uid();
  v_lease_seconds integer :=
    least(600, greatest(30, coalesce(p_lease_seconds, 180)));
begin
  if v_user_id is null then
    raise exception 'Not authenticated' using errcode = '28000';
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
        or (
          gj.status = 'claimed'
          and gj.claim_expires_at is not null
          and gj.claim_expires_at < now()
        )
      )
    order by gj.created_at asc
    limit 1
    for update of gj skip locked
  ),
  claimed as (
    update public.generation_jobs gj
    set
      status = 'claimed',
      claimed_at = now(),
      claim_expires_at = now() + make_interval(secs => v_lease_seconds),
      error = null
    from candidate c
    where gj.id = c.id
    returning
      gj.id,
      gj.user_message_id,
      gj.model_id,
      gj.reasoning_effort,
      gj.system_prompt
  )
  select
    claimed.id,
    claimed.user_message_id,
    claimed.model_id,
    claimed.reasoning_effort,
    claimed.system_prompt
  from claimed;
end;
$$;

revoke all on function public.claim_pending_generation_job(uuid, uuid, integer)
  from public, anon;
grant execute on function public.claim_pending_generation_job(uuid, uuid, integer)
  to authenticated, service_role;
