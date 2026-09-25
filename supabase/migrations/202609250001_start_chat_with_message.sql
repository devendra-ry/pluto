-- Create a new chat's thread, first user message, and generation job atomically.
-- This replaces three client-side Supabase requests during first send.
create or replace function public.start_chat_with_message(
  p_content text,
  p_model text,
  p_reasoning_effort text,
  p_system_prompt text,
  p_attachments jsonb,
  p_thread_id uuid default null
)
returns table (
  thread_id uuid,
  user_message_id uuid
)
language plpgsql
security invoker
set search_path = pg_catalog, public, pg_temp
as $$
declare
  v_user_id uuid := auth.uid();
  v_thread_id uuid;
  v_user_message_id uuid;
begin
  if v_user_id is null then
    raise exception 'Not authenticated' using errcode = '28000';
  end if;

  if p_model is null or length(p_model) not between 1 and 256 then
    raise exception 'Invalid model' using errcode = '22023';
  end if;

  if p_reasoning_effort is not null
    and p_reasoning_effort not in ('low', 'medium', 'high') then
    raise exception 'Invalid reasoning effort' using errcode = '22023';
  end if;

  if p_content is null or length(p_content) > 100000 then
    raise exception 'Message content is too long' using errcode = '22023';
  end if;

  if p_system_prompt is not null and length(p_system_prompt) > 50000 then
    raise exception 'System prompt is too long' using errcode = '22023';
  end if;

  if p_attachments is null or jsonb_typeof(p_attachments) <> 'array' then
    raise exception 'Invalid attachments' using errcode = '22023';
  end if;

  if jsonb_array_length(p_attachments) > 6
    or octet_length(p_attachments::text) > 131072 then
    raise exception 'Attachments exceed the allowed limit' using errcode = '22023';
  end if;

  if length(btrim(p_content)) = 0 and jsonb_array_length(p_attachments) = 0 then
    raise exception 'A message or attachment is required' using errcode = '22023';
  end if;

  if p_thread_id is null then
    insert into public.threads (
      user_id,
      title,
      model,
      reasoning_effort,
      system_prompt
    ) values (
      v_user_id,
      'New Chat',
      p_model,
      p_reasoning_effort,
      nullif(btrim(p_system_prompt), '')
    )
    returning id into v_thread_id;
  else
    update public.threads as t
    set
      model = p_model,
      reasoning_effort = p_reasoning_effort,
      system_prompt = nullif(btrim(p_system_prompt), '')
    where t.id = p_thread_id
      and t.user_id = v_user_id
    returning t.id into v_thread_id;

    if v_thread_id is null then
      raise exception 'Chat not found' using errcode = 'P0002';
    end if;
  end if;

  insert into public.messages (
    thread_id,
    user_id,
    role,
    content,
    model_id,
    attachments
  ) values (
    v_thread_id,
    v_user_id,
    'user',
    p_content,
    p_model,
    p_attachments
  )
  returning id into v_user_message_id;

  insert into public.generation_jobs (
    thread_id,
    user_message_id,
    user_id,
    model_id,
    reasoning_effort,
    system_prompt,
    status
  ) values (
    v_thread_id,
    v_user_message_id,
    v_user_id,
    p_model,
    p_reasoning_effort,
    nullif(btrim(p_system_prompt), ''),
    'pending'
  );

  return query select v_thread_id, v_user_message_id;
end;
$$;

revoke all on function public.start_chat_with_message(text, text, text, text, jsonb, uuid)
  from public, anon;
grant execute on function public.start_chat_with_message(text, text, text, text, jsonb, uuid)
  to authenticated;
