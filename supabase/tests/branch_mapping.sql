-- Rollback-only regression for large, tied-timestamp branch prefixes and
-- reply remapping. The existing thread_lifecycle test covers failure rollback.
begin;

do $$
declare
  v_user_id uuid := gen_random_uuid();
  v_thread_id uuid := gen_random_uuid();
  v_anchor_id uuid := '00000000-0000-4000-8000-000000000512';
  v_branch public.threads%rowtype;
  v_count integer;
begin
  insert into auth.users (id, aud, role, email, encrypted_password, email_confirmed_at, created_at, updated_at)
  values (v_user_id, 'authenticated', 'authenticated', 'branch-map-' || v_user_id || '@example.test', '', now(), now(), now());
  perform set_config('request.jwt.claim.sub', v_user_id::text, true);
  perform set_config('request.jwt.claim.role', 'authenticated', true);

  insert into public.threads (id, user_id, title, model, reasoning_effort, system_prompt)
  values (v_thread_id, v_user_id, 'Linear mapping test', 'test-model', 'high', 'preserve');

  -- Give all rows the same timestamp so the tuple ID order controls the entire
  -- copied prefix. The later row 599 is a valid reply target that must become
  -- NULL when its referencing message row 10 is copied only through anchor 512.
  insert into public.messages (id, thread_id, user_id, role, content, created_at, attachments)
  select
    ('00000000-0000-4000-8000-' || lpad(n::text, 12, '0'))::uuid,
    v_thread_id,
    v_user_id,
    case when n % 2 = 1 then 'user' else 'assistant' end,
    'row-' || n::text,
    '2026-01-01 00:00:00+00'::timestamptz,
    '[]'::jsonb
  from generate_series(1, 600) as n;

  update public.messages m
  set reply_to_message_id = (
    '00000000-0000-4000-8000-' || lpad((split_part(m.content, '-', 2)::integer - 1)::text, 12, '0')
  )::uuid
  where m.thread_id = v_thread_id
    and m.role = 'assistant'
    and m.content <> 'row-10'
    and m.content <> 'row-600';

  update public.messages
  set reply_to_message_id = '00000000-0000-4000-8000-000000000599'::uuid
  where thread_id = v_thread_id and id = '00000000-0000-4000-8000-000000000010'::uuid;
  -- Leave row 599 linked only from outside the copied prefix; this also keeps
  -- the active reply-link unique index valid.
  update public.messages
  set reply_to_message_id = null
  where thread_id = v_thread_id and id = '00000000-0000-4000-8000-000000000600'::uuid;

  v_branch := public.branch_thread(v_thread_id, v_anchor_id);

  select count(*) into v_count from public.messages where thread_id = v_branch.id;
  if v_count <> 512 then
    raise exception 'branch copied % rows instead of the anchored 512-row prefix', v_count;
  end if;

  select count(*) into v_count
  from (
    select content, row_number() over (order by created_at, id) as ordinal
    from public.messages
    where thread_id = v_branch.id
  ) ordered
  where ordered.content <> 'row-' || ordered.ordinal::text;
  if v_count <> 0 then
    raise exception 'tied source timestamps did not map to deterministic monotonic branch order';
  end if;

  if exists (
    select 1
    from public.messages b
    where b.thread_id = v_branch.id
      and b.content = 'row-10'
      and b.reply_to_message_id is not null
  ) then
    raise exception 'reply to a source message outside the copied prefix was not cleared';
  end if;

  select count(*) into v_count
  from public.messages b
  where b.thread_id = v_branch.id
    and b.role = 'assistant'
    and b.content <> 'row-10'
    and not exists (
      select 1
      from public.messages mapped
      where mapped.thread_id = v_branch.id
        and mapped.id = b.reply_to_message_id
        and mapped.content = 'row-' || (split_part(b.content, '-', 2)::integer - 1)::text
    );
  if v_count <> 0 then
    raise exception '% in-prefix reply links did not map to their corresponding copied user message', v_count;
  end if;
end;
$$;

rollback;
