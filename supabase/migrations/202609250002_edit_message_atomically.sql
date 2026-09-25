-- Replace an edited user message and its later history in one audited transaction.
create or replace function public.edit_user_message(
  p_thread_id uuid,
  p_message_id uuid,
  p_content text,
  p_model_id text,
  p_attachments jsonb
)
returns table (
  user_message_id uuid,
  deleted_message_ids uuid[]
)
language plpgsql
security definer
set search_path = pg_catalog, public, pg_temp
as $$
declare
  v_user_id uuid := auth.uid();
  v_target_created_at timestamptz;
  v_new_message_id uuid;
  v_deleted_ids uuid[];
  v_reason text := 'edit';
begin
  if v_user_id is null then
    raise exception 'Not authenticated' using errcode = '28000';
  end if;

  if p_content is null or length(p_content) > 100000 then
    raise exception 'Message content is too long' using errcode = '22023';
  end if;

  if p_model_id is null or length(p_model_id) not between 1 and 256 then
    raise exception 'Invalid model' using errcode = '22023';
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

  perform 1
  from public.threads t
  where t.id = p_thread_id
    and t.user_id = v_user_id
  for update;

  if not found then
    raise exception 'Chat not found' using errcode = 'P0002';
  end if;

  select m.created_at
  into v_target_created_at
  from public.messages m
  where m.id = p_message_id
    and m.thread_id = p_thread_id
    and m.user_id = v_user_id
    and m.role = 'user'
    and m.deleted_at is null
  for update;

  if not found then
    raise exception 'Message not found or cannot be edited' using errcode = 'P0002';
  end if;

  select array_agg(m.id order by m.id)
  into v_deleted_ids
  from public.messages m
  where m.thread_id = p_thread_id
    and m.deleted_at is null
    and (m.created_at, m.id) >= (v_target_created_at, p_message_id);

  if coalesce(cardinality(v_deleted_ids), 0) > 1000 then
    raise exception 'At most 1000 messages can be edited at once' using errcode = '22023';
  end if;

  if coalesce(cardinality(v_deleted_ids), 0) > 0 then
    update public.messages m
    set deleted_at = now(), deleted_by = v_user_id
    where m.id = any(v_deleted_ids)
      and m.thread_id = p_thread_id
      and m.deleted_at is null;

    insert into public.message_delete_audit (
      actor_user_id,
      thread_id,
      message_ids,
      reason,
      anchor_message_id
    ) values (
      v_user_id,
      p_thread_id,
      v_deleted_ids,
      v_reason,
      (select m.id from public.messages m where m.thread_id = p_thread_id and m.id <> p_message_id and m.deleted_at is null and (m.created_at, m.id) < (v_target_created_at, p_message_id) order by m.created_at desc, m.id desc limit 1)
    );
  end if;

  insert into public.messages (
    thread_id,
    user_id,
    role,
    content,
    model_id,
    attachments
  ) values (
    p_thread_id,
    v_user_id,
    'user',
    p_content,
    p_model_id,
    p_attachments
  )
  returning id into v_new_message_id;

  return query select v_new_message_id, coalesce(v_deleted_ids, array[]::uuid[]);
end;
$$;

revoke all on function public.edit_user_message(uuid, uuid, text, text, jsonb)
  from public, anon;
grant execute on function public.edit_user_message(uuid, uuid, text, text, jsonb)
  to authenticated;
