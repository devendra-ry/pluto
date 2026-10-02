-- Give each generation-job claim its own fencing token. A process from an
-- expired lease may still be running; its old token must not complete a job
-- that another browser has since reclaimed.
alter table public.generation_jobs
  add column if not exists claim_token uuid;

drop function if exists public.claim_pending_generation_job(uuid, uuid, integer);
create function public.claim_pending_generation_job(
  p_thread_id uuid,
  p_user_message_id uuid default null,
  p_lease_seconds integer default 180
)
returns table (
  id uuid,
  user_message_id uuid,
  model_id text,
  reasoning_effort text,
  system_prompt text,
  claim_token uuid
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
      claim_token = gen_random_uuid(),
      error = null
    from candidate c
    where gj.id = c.id
    returning
      gj.id,
      gj.user_message_id,
      gj.model_id,
      gj.reasoning_effort,
      gj.system_prompt,
      gj.claim_token
  )
  select
    claimed.id,
    claimed.user_message_id,
    claimed.model_id,
    claimed.reasoning_effort,
    claimed.system_prompt,
    claimed.claim_token
  from claimed;
end;
$$;

-- Retain the old RPC signature during rolling deployments, but make old
-- clients unable to change job state without presenting their claim token.
drop function if exists public.complete_generation_job(uuid, text, text);
create function public.complete_generation_job(
  p_job_id uuid,
  p_status text,
  p_error text default null
)
returns boolean
language plpgsql
security definer
set search_path = pg_catalog, public, pg_temp
as $$
begin
  if auth.uid() is null then
    raise exception 'Not authenticated' using errcode = '28000';
  end if;
  return false;
end;
$$;

create function public.complete_generation_job(
  p_job_id uuid,
  p_claim_token uuid,
  p_status text,
  p_error text default null
)
returns boolean
language plpgsql
security definer
set search_path = pg_catalog, public, pg_temp
as $$
declare
  v_user_id uuid := auth.uid();
  v_updated integer := 0;
begin
  if v_user_id is null then
    raise exception 'Not authenticated' using errcode = '28000';
  end if;

  if p_claim_token is null then
    return false;
  end if;

  if p_status is null or p_status not in ('completed', 'failed') then
    raise exception 'Invalid status for completion: %', p_status using errcode = '22023';
  end if;

  update public.generation_jobs gj
  set
    status = p_status,
    error = case
      when p_status = 'failed' then left(coalesce(p_error, 'Generation failed'), 5000)
      else null
    end,
    claim_expires_at = null,
    claim_token = null
  where gj.id = p_job_id
    and gj.user_id = v_user_id
    and gj.claim_token = p_claim_token
    and gj.status = 'claimed'
    and exists (
      select 1
      from public.threads t
      where t.id = gj.thread_id
        and t.user_id = v_user_id
    );

  get diagnostics v_updated = row_count;
  return v_updated > 0;
end;
$$;

revoke all on function public.claim_pending_generation_job(uuid, uuid, integer)
  from public, anon, authenticated;
grant execute on function public.claim_pending_generation_job(uuid, uuid, integer)
  to authenticated, service_role;

revoke all on function public.complete_generation_job(uuid, text, text)
  from public, anon, authenticated;
grant execute on function public.complete_generation_job(uuid, text, text)
  to authenticated, service_role;

revoke all on function public.complete_generation_job(uuid, uuid, text, text)
  from public, anon, authenticated;
grant execute on function public.complete_generation_job(uuid, uuid, text, text)
  to authenticated, service_role;
