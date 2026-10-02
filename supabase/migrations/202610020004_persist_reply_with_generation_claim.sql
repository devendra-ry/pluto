-- Persist the assistant reply and complete its job in one fenced transaction.
-- A stale provider stream can neither create a reply nor complete a reclaimed
-- job after its claim token has changed.
create or replace function public.persist_generation_response(
  p_job_id uuid,
  p_claim_token uuid,
  p_model_id text,
  p_content text,
  p_reasoning text,
  p_reply_stats jsonb default null
)
returns uuid
language plpgsql
security definer
set search_path = pg_catalog, public, pg_temp
as $$
declare
  v_user_id uuid := auth.uid();
  v_thread_id uuid;
  v_user_message_id uuid;
  v_reply_id uuid;
begin
  if v_user_id is null then
    raise exception 'Not authenticated' using errcode = '28000';
  end if;

  if p_claim_token is null then
    raise exception 'Generation claim is no longer current' using errcode = '40001';
  end if;

  if p_model_id is null or length(p_model_id) not between 1 and 256 then
    raise exception 'Invalid model' using errcode = '22023';
  end if;

  if p_content is null or length(p_content) > 100000
    or (p_reasoning is not null and length(p_reasoning) > 100000) then
    raise exception 'Generated response is too long' using errcode = '22023';
  end if;

  if p_reply_stats is not null
    and (jsonb_typeof(p_reply_stats) <> 'object'
      or octet_length(p_reply_stats::text) > 16384) then
    raise exception 'Invalid reply statistics' using errcode = '22023';
  end if;

  select gj.thread_id, gj.user_message_id
  into v_thread_id, v_user_message_id
  from public.generation_jobs gj
  join public.threads t
    on t.id = gj.thread_id
   and t.user_id = v_user_id
  join public.messages um
    on um.id = gj.user_message_id
   and um.thread_id = gj.thread_id
   and um.user_id = v_user_id
   and um.role = 'user'
   and um.deleted_at is null
  where gj.id = p_job_id
    and gj.user_id = v_user_id
    and gj.status = 'claimed'
    and gj.claim_token = p_claim_token
  for update of gj, um;

  if not found then
    raise exception 'Generation claim is no longer current' using errcode = '40001';
  end if;

  select m.id
  into v_reply_id
  from public.messages m
  where m.thread_id = v_thread_id
    and m.reply_to_message_id = v_user_message_id
    and m.role = 'assistant'
    and m.deleted_at is null;

  if v_reply_id is null then
    insert into public.messages (
      thread_id,
      user_id,
      role,
      content,
      reasoning,
      model_id,
      attachments,
      reply_to_message_id,
      reply_stats
    ) values (
      v_thread_id,
      v_user_id,
      'assistant',
      p_content,
      nullif(p_reasoning, ''),
      p_model_id,
      '[]'::jsonb,
      v_user_message_id,
      p_reply_stats
    ) returning id into v_reply_id;
  end if;

  update public.generation_jobs
  set
    status = 'completed',
    error = null,
    claim_expires_at = null,
    claim_token = null
  where id = p_job_id;

  return v_reply_id;
end;
$$;

revoke all on function public.persist_generation_response(uuid, uuid, text, text, text, jsonb)
  from public, anon, authenticated;
grant execute on function public.persist_generation_response(uuid, uuid, text, text, text, jsonb)
  to authenticated, service_role;
