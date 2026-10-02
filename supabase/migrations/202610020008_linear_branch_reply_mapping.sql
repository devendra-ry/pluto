-- Branching used parallel UUID arrays and array_position() for each copied
-- reply, which made remapping quadratic as the copied prefix grew. Materialize
-- each source row, ordinal, and new UUID once, then map replies with a hashable
-- join against that same prefix.
create or replace function public.branch_thread(p_parent_thread_id uuid, p_anchor_message_id uuid)
returns public.threads
language plpgsql security definer
set search_path = pg_catalog, public, pg_temp
as $$
declare
  v_user_id uuid := auth.uid();
  v_parent public.threads%rowtype;
  v_new public.threads%rowtype;
  v_anchor_created_at timestamptz;
  v_base timestamptz := clock_timestamp();
  v_title text;
  v_copied_count integer;
begin
  if v_user_id is null then
    raise exception 'Not authenticated' using errcode = '28000';
  end if;

  -- Preserve parent-before-anchor lock order shared with message mutations.
  select t.* into v_parent
  from public.threads t
  where t.id = p_parent_thread_id
    and t.user_id = v_user_id
    and t.deleted_at is null
  for update;
  if not found then
    raise exception 'Chat not found' using errcode = 'P0002';
  end if;

  select m.created_at into v_anchor_created_at
  from public.messages m
  where m.id = p_anchor_message_id
    and m.thread_id = p_parent_thread_id
    and m.user_id = v_user_id
    and m.deleted_at is null
  for update;
  if not found then
    raise exception 'Branch anchor not found' using errcode = 'P0002';
  end if;

  v_title := regexp_replace(regexp_replace('Branch of ' || coalesce(v_parent.title, 'New Chat'), '[[:cntrl:]<>]', ' ', 'g'), '\s+', ' ', 'g');
  v_title := btrim(v_title);
  if length(v_title) > 47 then
    v_title := left(v_title, 47) || '...';
  end if;

  insert into public.threads(user_id, title, model, reasoning_effort, system_prompt)
  values (
    v_user_id,
    case when v_parent.title = 'New Chat' then 'New Chat' else coalesce(nullif(v_title, ''), 'New Chat') end,
    v_parent.model,
    v_parent.reasoning_effort,
    v_parent.system_prompt
  )
  returning * into v_new;

  -- Materialize only IDs, ordinals, and new UUIDs so large TOASTed message
  -- bodies are not copied into a temporary tuplestore. The self-join remaps
  -- in-prefix replies in linear expected time; an outside target yields NULL.
  -- A single INSERT preserves immediate self-reply FK checking and atomicity.
  with mapping as materialized (
    select
      m.id as old_id,
      row_number() over (order by m.created_at, m.id)::integer as ordinal,
      gen_random_uuid() as new_id
    from public.messages m
    where m.thread_id = p_parent_thread_id
      and m.deleted_at is null
      and (m.created_at, m.id) <= (v_anchor_created_at, p_anchor_message_id)
  )
  insert into public.messages(
    id, thread_id, user_id, role, content, reasoning, model_id, attachments,
    reply_stats, reply_to_message_id, created_at
  )
  select
    mapping.new_id,
    v_new.id,
    v_user_id,
    source.role,
    source.content,
    source.reasoning,
    source.model_id,
    source.attachments,
    source.reply_stats,
    mapped.new_id,
    v_base + ((mapping.ordinal - 1) * interval '1 microsecond')
  from mapping
  join public.messages source on source.id = mapping.old_id
  left join mapping as mapped on mapped.old_id = source.reply_to_message_id
  order by mapping.ordinal;

  get diagnostics v_copied_count = row_count;
  if v_copied_count = 0 then
    raise exception 'Branch anchor not found' using errcode = 'P0002';
  end if;

  return v_new;
end;
$$;

revoke all on function public.branch_thread(uuid, uuid) from public, anon;
grant execute on function public.branch_thread(uuid, uuid) to authenticated;
