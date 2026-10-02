-- Atomic branching and undoable thread deletion with storage-safe cleanup.
alter table public.threads add column if not exists deleted_at timestamptz;

create table if not exists public.thread_cleanup_jobs (
  id uuid primary key default gen_random_uuid(),
  thread_id uuid not null,
  user_id uuid not null,
  status text not null default 'pending',
  available_at timestamptz not null,
  claim_token uuid,
  claim_expires_at timestamptz,
  paths text[] not null default array[]::text[],
  attempts integer not null default 0,
  last_error text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint thread_cleanup_jobs_status_check check (status in ('pending', 'claimed', 'completed'))
);
create unique index if not exists thread_cleanup_jobs_open_thread_idx
  on public.thread_cleanup_jobs (thread_id) where status <> 'completed';
create index if not exists thread_cleanup_jobs_ready_idx
  on public.thread_cleanup_jobs (user_id, available_at, created_at) where status <> 'completed';
alter table public.thread_cleanup_jobs enable row level security;
revoke all on public.thread_cleanup_jobs from public, anon, authenticated;
grant all on public.thread_cleanup_jobs to service_role;

create or replace function public.attachment_paths(p_attachments jsonb)
returns setof text
language sql immutable parallel safe
set search_path = pg_catalog
as $$
  select distinct nullif(item.value ->> 'path', '')
  from jsonb_array_elements(case when jsonb_typeof(p_attachments) = 'array' then p_attachments else '[]'::jsonb end) item(value)
  where jsonb_typeof(item.value) = 'object'
    and nullif(item.value ->> 'path', '') is not null
$$;

-- SECURITY DEFINER helpers avoid storage.objects -> public RLS recursion.
create or replace function public.thread_path_is_referenced(p_path text, p_user_id uuid)
returns boolean
language sql stable security definer
set search_path = pg_catalog, public, pg_temp
as $$
  select p_user_id = auth.uid() and exists (
    select 1
    from public.messages m
    join public.threads t on t.id = m.thread_id
    where t.user_id = p_user_id
      and (t.deleted_at is null or t.deleted_at + interval '30 seconds' > clock_timestamp())
      and exists (select 1 from public.attachment_paths(m.attachments) ap(path) where ap.path = p_path)
  )
$$;

create or replace function public.thread_cleanup_path_is_claimed(p_path text, p_user_id uuid)
returns boolean
language sql stable security definer
set search_path = pg_catalog, public, pg_temp
as $$
  select p_user_id = auth.uid() and exists (
    select 1 from public.thread_cleanup_jobs j
    where j.user_id = p_user_id and j.status = 'claimed'
      and j.claim_expires_at > now() and p_path = any(j.paths)
  )
$$;

create or replace function public.thread_folder_is_active_for_storage(p_path text, p_user_id uuid)
returns boolean
language plpgsql security definer
set search_path = pg_catalog, public, pg_temp
as $$
begin
  if p_user_id is distinct from auth.uid() or cardinality(storage.foldername(p_path)) <> 2
    or (storage.foldername(p_path))[1] <> p_user_id::text then return false; end if;
  perform 1 from public.threads t
  where t.id::text = (storage.foldername(p_path))[2] and t.user_id = p_user_id and t.deleted_at is null
  for share;
  return found;
end;
$$;

revoke all on function public.attachment_paths(jsonb) from public, anon;
revoke all on function public.thread_path_is_referenced(text, uuid) from public, anon;
revoke all on function public.thread_cleanup_path_is_claimed(text, uuid) from public, anon;
revoke all on function public.thread_folder_is_active_for_storage(text, uuid) from public, anon;
grant execute on function public.attachment_paths(jsonb) to authenticated, service_role;
grant execute on function public.thread_path_is_referenced(text, uuid) to authenticated, service_role;
grant execute on function public.thread_cleanup_path_is_claimed(text, uuid) to authenticated, service_role;
grant execute on function public.thread_folder_is_active_for_storage(text, uuid) to authenticated, service_role;

create or replace function public.require_active_message_thread()
returns trigger
language plpgsql security definer
set search_path = pg_catalog, public, pg_temp
as $$
begin
  perform 1 from public.threads t where t.id = new.thread_id and t.deleted_at is null for share;
  if not found then
    raise exception 'Chat not found' using errcode = 'P0002';
  end if;
  return new;
end;
$$;
create or replace function public.require_active_job_thread()
returns trigger
language plpgsql security definer
set search_path = pg_catalog, public, pg_temp
as $$
begin
  perform 1 from public.threads t where t.id = new.thread_id and t.user_id = new.user_id and t.deleted_at is null for share;
  if not found then
    raise exception 'Chat not found' using errcode = 'P0002';
  end if;
  return new;
end;
$$;
revoke all on function public.require_active_message_thread() from public, anon, authenticated;
revoke all on function public.require_active_job_thread() from public, anon, authenticated;
create trigger messages_require_active_thread before insert or update on public.messages
for each row execute function public.require_active_message_thread();
create trigger generation_jobs_require_active_thread before insert or update on public.generation_jobs
for each row execute function public.require_active_job_thread();

-- Hide tombstones at the source and reject direct mutations against them.
drop policy if exists "Users can view their own threads" on public.threads;
create policy "Users can view their own threads" on public.threads for select to authenticated
using (user_id = (select auth.uid()) and deleted_at is null);
drop policy if exists "Users can update their own threads" on public.threads;
create policy "Users can update their own threads" on public.threads for update to authenticated
using (user_id = (select auth.uid()) and deleted_at is null)
with check (user_id = (select auth.uid()) and deleted_at is null);
drop policy if exists "Users can delete their own threads" on public.threads;
revoke delete on public.threads from authenticated;

drop policy if exists "Users can view messages in their threads" on public.messages;
create policy "Users can view messages in their threads" on public.messages for select to authenticated
using (user_id = (select auth.uid()) and exists (
  select 1 from public.threads t where t.id = messages.thread_id and t.user_id = (select auth.uid()) and t.deleted_at is null
));
drop policy if exists "Users can insert messages in their threads" on public.messages;
create policy "Users can insert messages in their threads" on public.messages for insert to authenticated
with check (user_id = (select auth.uid()) and exists (
  select 1 from public.threads t where t.id = messages.thread_id and t.user_id = (select auth.uid()) and t.deleted_at is null
));
drop policy if exists "Users can update messages in their threads" on public.messages;
create policy "Users can update messages in their threads" on public.messages for update to authenticated
using (user_id = (select auth.uid()) and exists (
  select 1 from public.threads t where t.id = messages.thread_id and t.user_id = (select auth.uid()) and t.deleted_at is null
))
with check (user_id = (select auth.uid()) and exists (
  select 1 from public.threads t where t.id = messages.thread_id and t.user_id = (select auth.uid()) and t.deleted_at is null
));
-- All supported message mutations go through parent-first SECURITY DEFINER RPCs.
revoke update on public.messages from authenticated;

drop policy if exists "Users can view own generation jobs" on public.generation_jobs;
create policy "Users can view own generation jobs" on public.generation_jobs for select to authenticated
using (user_id = (select auth.uid()) and exists (
  select 1 from public.threads t where t.id = generation_jobs.thread_id and t.user_id = (select auth.uid()) and t.deleted_at is null
));
drop policy if exists "Users can insert own generation jobs" on public.generation_jobs;
create policy "Users can insert own generation jobs" on public.generation_jobs for insert to authenticated
with check (user_id = (select auth.uid()) and exists (
  select 1 from public.threads t where t.id = generation_jobs.thread_id and t.user_id = (select auth.uid()) and t.deleted_at is null
) and exists (
  select 1 from public.messages m where m.id = generation_jobs.user_message_id and m.thread_id = generation_jobs.thread_id
    and m.user_id = (select auth.uid()) and m.role = 'user' and m.deleted_at is null
));

-- Keep all SECURITY DEFINER mutation paths from writing to tombstoned chats.
create or replace function public.edit_user_message(
  p_thread_id uuid, p_message_id uuid, p_content text, p_model_id text, p_attachments jsonb
)
returns table(user_message_id uuid, deleted_message_ids uuid[])
language plpgsql security definer
set search_path = pg_catalog, public, pg_temp
as $$
declare
  v_user_id uuid := auth.uid(); v_target_created_at timestamptz; v_new_message_id uuid; v_deleted_ids uuid[];
begin
  if v_user_id is null then raise exception 'Not authenticated' using errcode = '28000'; end if;
  if p_content is null or length(p_content) > 100000 then raise exception 'Message content is too long' using errcode = '22023'; end if;
  if p_model_id is null or length(p_model_id) not between 1 and 256 then raise exception 'Invalid model' using errcode = '22023'; end if;
  if p_attachments is null or jsonb_typeof(p_attachments) <> 'array' or jsonb_array_length(p_attachments) > 6 or octet_length(p_attachments::text) > 131072 then
    raise exception 'Invalid attachments' using errcode = '22023';
  end if;
  if length(btrim(p_content)) = 0 and jsonb_array_length(p_attachments) = 0 then raise exception 'A message or attachment is required' using errcode = '22023'; end if;
  perform 1 from public.threads t where t.id = p_thread_id and t.user_id = v_user_id and t.deleted_at is null for update;
  if not found then raise exception 'Chat not found' using errcode = 'P0002'; end if;
  select m.created_at into v_target_created_at from public.messages m
    where m.id = p_message_id and m.thread_id = p_thread_id and m.user_id = v_user_id and m.role = 'user' and m.deleted_at is null for update;
  if not found then raise exception 'Message not found or cannot be edited' using errcode = 'P0002'; end if;
  select array_agg(m.id order by m.created_at, m.id) into v_deleted_ids from public.messages m
    where m.thread_id = p_thread_id and m.deleted_at is null and (m.created_at, m.id) >= (v_target_created_at, p_message_id);
  if coalesce(cardinality(v_deleted_ids), 0) > 1000 then raise exception 'At most 1000 messages can be edited at once' using errcode = '22023'; end if;
  if coalesce(cardinality(v_deleted_ids), 0) > 0 then
    update public.messages m set deleted_at = now(), deleted_by = v_user_id where m.id = any(v_deleted_ids) and m.thread_id = p_thread_id and m.deleted_at is null;
    insert into public.message_delete_audit(actor_user_id, thread_id, message_ids, reason, anchor_message_id)
      values (v_user_id, p_thread_id, v_deleted_ids, 'edit', (
        select m.id from public.messages m where m.thread_id = p_thread_id and m.id <> p_message_id and m.deleted_at is null
          and (m.created_at, m.id) < (v_target_created_at, p_message_id) order by m.created_at desc, m.id desc limit 1));
  end if;
  insert into public.messages(thread_id, user_id, role, content, model_id, attachments)
    values (p_thread_id, v_user_id, 'user', p_content, p_model_id, p_attachments) returning id into v_new_message_id;
  return query select v_new_message_id, coalesce(v_deleted_ids, array[]::uuid[]);
end;
$$;
revoke all on function public.edit_user_message(uuid, uuid, text, text, jsonb) from public, anon, authenticated;
grant execute on function public.edit_user_message(uuid, uuid, text, text, jsonb) to authenticated;

-- Bulk message mutation RPCs lock every affected parent first, in UUID order.
create or replace function public.soft_delete_messages(
  p_message_ids uuid[], p_reason text default 'manual', p_anchor_message_id uuid default null
)
returns integer
language plpgsql security definer
set search_path = pg_catalog, public, pg_temp
as $$
declare
  v_user_id uuid := auth.uid(); v_thread_id uuid; v_count integer := 0;
  v_reason text := left(coalesce(nullif(btrim(p_reason), ''), 'manual'), 200);
begin
  if v_user_id is null then raise exception 'Not authenticated' using errcode = '28000'; end if;
  if p_message_ids is null or cardinality(p_message_ids) = 0 then return 0; end if;
  if cardinality(p_message_ids) > 1000 then raise exception 'At most 1000 messages can be deleted at once' using errcode = '22023'; end if;
  if array_position(p_message_ids, null) is not null then raise exception 'Message IDs cannot contain null' using errcode = '22023'; end if;

  for v_thread_id in
    select candidates.thread_id from (
      select distinct m.thread_id from public.messages m
      join public.threads t on t.id = m.thread_id
      where m.id = any(p_message_ids) and m.user_id = v_user_id and t.user_id = v_user_id and t.deleted_at is null
      union
      select m.thread_id from public.messages m join public.threads t on t.id = m.thread_id
      where m.id = p_anchor_message_id and m.user_id = v_user_id and m.deleted_at is null
        and t.user_id = v_user_id and t.deleted_at is null
    ) candidates order by candidates.thread_id
  loop
    perform 1 from public.threads t where t.id = v_thread_id and t.user_id = v_user_id and t.deleted_at is null for update;
  end loop;

  if p_anchor_message_id is not null and not exists (
    select 1 from public.messages m join public.threads t on t.id = m.thread_id
    where m.id = p_anchor_message_id and m.user_id = v_user_id and m.deleted_at is null
      and t.user_id = v_user_id and t.deleted_at is null
  ) then raise exception 'Anchor message is unavailable' using errcode = 'P0002'; end if;

  with target as (
    select m.id, m.thread_id from public.messages m join public.threads t on t.id = m.thread_id
    where m.id = any(p_message_ids) and m.deleted_at is null and m.user_id = v_user_id
      and t.user_id = v_user_id and t.deleted_at is null
  ), updated as (
    update public.messages m set deleted_at = now(), deleted_by = v_user_id from target
    where m.id = target.id returning m.id, m.thread_id
  ), grouped as (
    select thread_id, array_agg(id order by id)::uuid[] as ids from updated group by thread_id
  ), inserted as (
    insert into public.message_delete_audit(actor_user_id, thread_id, message_ids, reason, anchor_message_id)
    select v_user_id, g.thread_id, g.ids, v_reason, p_anchor_message_id from grouped g returning 1
  ) select count(*)::integer into v_count from updated;
  return v_count;
end;
$$;

create or replace function public.restore_soft_deleted_messages(
  p_message_ids uuid[], p_restore_window_minutes integer default 1440
)
returns integer
language plpgsql security definer
set search_path = pg_catalog, public, pg_temp
as $$
declare
  v_user_id uuid := auth.uid(); v_thread_id uuid; v_count integer := 0;
  v_restore_window integer := least(10080, greatest(1, coalesce(p_restore_window_minutes, 1440)));
begin
  if v_user_id is null then raise exception 'Not authenticated' using errcode = '28000'; end if;
  if p_message_ids is null or cardinality(p_message_ids) = 0 then return 0; end if;
  if cardinality(p_message_ids) > 1000 then raise exception 'At most 1000 messages can be restored at once' using errcode = '22023'; end if;
  if array_position(p_message_ids, null) is not null then raise exception 'Message IDs cannot contain null' using errcode = '22023'; end if;

  for v_thread_id in
    select distinct m.thread_id from public.messages m join public.threads t on t.id = m.thread_id
    where m.id = any(p_message_ids) and m.user_id = v_user_id and m.deleted_by = v_user_id
      and m.deleted_at is not null and m.deleted_at >= now() - make_interval(mins => v_restore_window)
      and t.user_id = v_user_id and t.deleted_at is null
    order by m.thread_id
  loop
    perform 1 from public.threads t where t.id = v_thread_id and t.user_id = v_user_id and t.deleted_at is null for update;
  end loop;

  with target as (
    select m.id from public.messages m join public.threads t on t.id = m.thread_id
    where m.id = any(p_message_ids) and m.user_id = v_user_id and m.deleted_by = v_user_id
      and m.deleted_at is not null and m.deleted_at >= now() - make_interval(mins => v_restore_window)
      and t.user_id = v_user_id and t.deleted_at is null
  ), restored as (
    update public.messages m set deleted_at = null, deleted_by = null from target
    where m.id = target.id returning m.id
  ), audited as (
    update public.message_delete_audit a set restored_at = now()
    where a.actor_user_id = v_user_id and a.restored_at is null
      and exists (select 1 from unnest(a.message_ids) mid join restored r on r.id = mid)
    returning 1
  ) select count(*)::integer into v_count from restored;
  return v_count;
end;
$$;
revoke all on function public.soft_delete_messages(uuid[], text, uuid) from public, anon, authenticated;
revoke all on function public.restore_soft_deleted_messages(uuid[], integer) from public, anon, authenticated;
grant execute on function public.soft_delete_messages(uuid[], text, uuid) to authenticated;
grant execute on function public.restore_soft_deleted_messages(uuid[], integer) to authenticated;

create or replace function public.claim_pending_generation_job(
  p_thread_id uuid, p_user_message_id uuid default null, p_lease_seconds integer default 180
)
returns table(id uuid, user_message_id uuid, model_id text, reasoning_effort text, system_prompt text, claim_token uuid)
language plpgsql security definer
set search_path = pg_catalog, public, pg_temp
as $$
declare
  v_user_id uuid := auth.uid(); v_job_id uuid; v_token uuid;
  v_lease_seconds integer := least(600, greatest(30, coalesce(p_lease_seconds, 180)));
begin
  if v_user_id is null then raise exception 'Not authenticated' using errcode = '28000'; end if;
  -- Lock the parent before any job row; all message edits use this order too.
  perform 1 from public.threads t where t.id = p_thread_id and t.user_id = v_user_id and t.deleted_at is null for update;
  if not found then return; end if;
  select gj.id into v_job_id from public.generation_jobs gj
  where gj.thread_id = p_thread_id and gj.user_id = v_user_id
    and (p_user_message_id is null or gj.user_message_id = p_user_message_id)
    and (gj.status = 'pending' or (gj.status = 'claimed' and gj.claim_expires_at is not null and gj.claim_expires_at < now()))
  order by gj.created_at asc limit 1 for update skip locked;
  if not found then return; end if;
  v_token := gen_random_uuid();
  return query update public.generation_jobs gj set status = 'claimed', claimed_at = now(),
    claim_expires_at = now() + make_interval(secs => v_lease_seconds), claim_token = v_token, error = null
    where gj.id = v_job_id returning gj.id, gj.user_message_id, gj.model_id, gj.reasoning_effort, gj.system_prompt, gj.claim_token;
end;
$$;

create or replace function public.complete_generation_job(
  p_job_id uuid, p_claim_token uuid, p_status text, p_error text default null
)
returns boolean
language plpgsql security definer
set search_path = pg_catalog, public, pg_temp
as $$
declare v_user_id uuid := auth.uid(); v_thread_id uuid; v_updated integer := 0;
begin
  if v_user_id is null then raise exception 'Not authenticated' using errcode = '28000'; end if;
  if p_claim_token is null then return false; end if;
  if p_status is null or p_status not in ('completed', 'failed') then raise exception 'Invalid status for completion: %', p_status using errcode = '22023'; end if;
  select gj.thread_id into v_thread_id from public.generation_jobs gj
  where gj.id = p_job_id and gj.user_id = v_user_id and gj.claim_token = p_claim_token and gj.status = 'claimed';
  if not found then return false; end if;
  perform 1 from public.threads t where t.id = v_thread_id and t.user_id = v_user_id and t.deleted_at is null for update;
  if not found then return false; end if;
  update public.generation_jobs gj set status = p_status,
    error = case when p_status = 'failed' then left(coalesce(p_error, 'Generation failed'), 5000) else null end,
    claim_expires_at = null, claim_token = null
  where gj.id = p_job_id and gj.user_id = v_user_id and gj.claim_token = p_claim_token and gj.status = 'claimed';
  get diagnostics v_updated = row_count;
  return v_updated > 0;
end;
$$;
revoke all on function public.claim_pending_generation_job(uuid, uuid, integer) from public, anon, authenticated;
grant execute on function public.claim_pending_generation_job(uuid, uuid, integer) to authenticated, service_role;
revoke all on function public.complete_generation_job(uuid, uuid, text, text) from public, anon, authenticated;
grant execute on function public.complete_generation_job(uuid, uuid, text, text) to authenticated, service_role;

create or replace function public.persist_generation_response(
  p_job_id uuid, p_claim_token uuid, p_model_id text, p_content text, p_reasoning text, p_reply_stats jsonb default null
)
returns uuid
language plpgsql security definer
set search_path = pg_catalog, public, pg_temp
as $$
declare v_user_id uuid := auth.uid(); v_thread_id uuid; v_user_message_id uuid; v_reply_id uuid;
begin
  if v_user_id is null then raise exception 'Not authenticated' using errcode = '28000'; end if;
  if p_claim_token is null then raise exception 'Generation claim is no longer current' using errcode = '40001'; end if;
  if p_model_id is null or length(p_model_id) not between 1 and 256 then raise exception 'Invalid model' using errcode = '22023'; end if;
  if p_content is null or length(p_content) > 100000 or (p_reasoning is not null and length(p_reasoning) > 100000) then
    raise exception 'Generated response is too long' using errcode = '22023'; end if;
  if p_reply_stats is not null and (jsonb_typeof(p_reply_stats) <> 'object' or octet_length(p_reply_stats::text) > 16384) then
    raise exception 'Invalid reply statistics' using errcode = '22023'; end if;
  select gj.thread_id into v_thread_id from public.generation_jobs gj
  where gj.id = p_job_id and gj.user_id = v_user_id and gj.status = 'claimed' and gj.claim_token = p_claim_token;
  if not found then raise exception 'Generation claim is no longer current' using errcode = '40001'; end if;
  perform 1 from public.threads t where t.id = v_thread_id and t.user_id = v_user_id and t.deleted_at is null for update;
  if not found then raise exception 'Generation claim is no longer current' using errcode = '40001'; end if;
  select gj.user_message_id into v_user_message_id from public.generation_jobs gj
  join public.messages um on um.id = gj.user_message_id and um.thread_id = gj.thread_id and um.user_id = v_user_id
    and um.role = 'user' and um.deleted_at is null
  where gj.id = p_job_id and gj.thread_id = v_thread_id and gj.user_id = v_user_id
    and gj.status = 'claimed' and gj.claim_token = p_claim_token
  for update of gj, um;
  if not found then raise exception 'Generation claim is no longer current' using errcode = '40001'; end if;
  select m.id into v_reply_id from public.messages m where m.thread_id = v_thread_id
    and m.reply_to_message_id = v_user_message_id and m.role = 'assistant' and m.deleted_at is null;
  if v_reply_id is null then
    insert into public.messages(thread_id, user_id, role, content, reasoning, model_id, attachments, reply_to_message_id, reply_stats)
    values(v_thread_id, v_user_id, 'assistant', p_content, nullif(p_reasoning, ''), p_model_id, '[]'::jsonb, v_user_message_id, p_reply_stats)
    returning id into v_reply_id;
  end if;
  update public.generation_jobs set status = 'completed', error = null, claim_expires_at = null, claim_token = null where id = p_job_id;
  return v_reply_id;
end;
$$;
revoke all on function public.persist_generation_response(uuid, uuid, text, text, text, jsonb) from public, anon, authenticated;
grant execute on function public.persist_generation_response(uuid, uuid, text, text, text, jsonb) to authenticated, service_role;

create or replace function public.branch_thread(p_parent_thread_id uuid, p_anchor_message_id uuid)
returns public.threads
language plpgsql security definer
set search_path = pg_catalog, public, pg_temp
as $$
declare
  v_user_id uuid := auth.uid(); v_parent public.threads%rowtype; v_new public.threads%rowtype;
  v_old_ids uuid[]; v_new_ids uuid[]; v_base timestamptz := clock_timestamp(); v_title text;
begin
  if v_user_id is null then raise exception 'Not authenticated' using errcode = '28000'; end if;
  select t.* into v_parent from public.threads t where t.id = p_parent_thread_id and t.user_id = v_user_id and t.deleted_at is null for update;
  if not found then raise exception 'Chat not found' using errcode = 'P0002'; end if;
  perform 1 from public.messages m where m.id = p_anchor_message_id and m.thread_id = p_parent_thread_id and m.user_id = v_user_id and m.deleted_at is null for update;
  if not found then raise exception 'Branch anchor not found' using errcode = 'P0002'; end if;
  v_title := regexp_replace(regexp_replace('Branch of ' || coalesce(v_parent.title, 'New Chat'), '[[:cntrl:]<>]', ' ', 'g'), '\s+', ' ', 'g');
  v_title := btrim(v_title);
  if length(v_title) > 47 then v_title := left(v_title, 47) || '...'; end if;
  select array_agg(s.id order by s.created_at, s.id), array_agg(gen_random_uuid() order by s.created_at, s.id)
    into v_old_ids, v_new_ids
    from public.messages s
    where s.thread_id = p_parent_thread_id and s.deleted_at is null
      and (s.created_at, s.id) <= (select a.created_at, a.id from public.messages a where a.id = p_anchor_message_id);
  if coalesce(cardinality(v_old_ids), 0) = 0 then raise exception 'Branch anchor not found' using errcode = 'P0002'; end if;
  insert into public.threads(user_id, title, model, reasoning_effort, system_prompt)
  values (v_user_id,
    case when v_parent.title = 'New Chat' then 'New Chat' else coalesce(nullif(v_title, ''), 'New Chat') end,
    v_parent.model, v_parent.reasoning_effort, v_parent.system_prompt)
  returning * into v_new;
  -- One statement lets immediate self-reply FKs validate after all copied rows
  -- exist, even when deterministic UUID tie ordering places a reply first.
  insert into public.messages(id, thread_id, user_id, role, content, reasoning, model_id, attachments, reply_stats, reply_to_message_id, created_at)
  select
    v_new_ids[source.ordinal], v_new.id, v_user_id, source.role, source.content, source.reasoning,
    source.model_id, source.attachments, source.reply_stats,
    case when source.reply_to_message_id = any(v_old_ids)
      then v_new_ids[array_position(v_old_ids, source.reply_to_message_id)] else null end,
    v_base + ((source.ordinal - 1) * interval '1 microsecond')
  from (
    select m.*, row_number() over (order by m.created_at, m.id)::integer as ordinal
    from public.messages m where m.id = any(v_old_ids)
  ) source
  order by source.ordinal;
  return v_new;
end;
$$;
revoke all on function public.branch_thread(uuid, uuid) from public, anon;
grant execute on function public.branch_thread(uuid, uuid) to authenticated;

create or replace function public.delete_thread(p_thread_id uuid)
returns table(thread_id uuid, deleted_at timestamptz, undo_until timestamptz)
language plpgsql security definer
set search_path = pg_catalog, public, pg_temp
as $$
declare v_user_id uuid := auth.uid(); v_deleted_at timestamptz;
begin
  if v_user_id is null then raise exception 'Not authenticated' using errcode = '28000'; end if;
  perform 1 from public.threads t where t.id = p_thread_id and t.user_id = v_user_id and t.deleted_at is null for update;
  if not found then raise exception 'Chat not found' using errcode = 'P0002'; end if;
  v_deleted_at := clock_timestamp();
  update public.threads t set deleted_at = v_deleted_at, updated_at = v_deleted_at where t.id = p_thread_id returning t.deleted_at into v_deleted_at;
  update public.thread_cleanup_jobs j set status = 'pending', available_at = v_deleted_at + interval '30 seconds',
    claim_token = null, claim_expires_at = null, paths = array[]::text[], last_error = null, updated_at = now()
  where j.thread_id = p_thread_id and j.status <> 'completed';
  if not found then
    insert into public.thread_cleanup_jobs(thread_id, user_id, available_at)
      values (p_thread_id, v_user_id, v_deleted_at + interval '30 seconds');
  end if;
  return query select p_thread_id, v_deleted_at, v_deleted_at + interval '30 seconds';
end;
$$;

create or replace function public.restore_thread(p_thread_id uuid)
returns public.threads
language plpgsql security definer
set search_path = pg_catalog, public, pg_temp
as $$
declare v_user_id uuid := auth.uid(); v_thread public.threads%rowtype; v_status text;
begin
  if v_user_id is null then raise exception 'Not authenticated' using errcode = '28000'; end if;
  select t.* into v_thread from public.threads t where t.id = p_thread_id and t.user_id = v_user_id and t.deleted_at is not null for update;
  if not found then raise exception 'Deleted chat not found' using errcode = 'P0002'; end if;
  if v_thread.deleted_at + interval '30 seconds' <= clock_timestamp() then
    raise exception 'The undo window has expired' using errcode = '40001';
  end if;
  select j.status into v_status from public.thread_cleanup_jobs j where j.thread_id = p_thread_id and j.status <> 'completed' for update;
  if v_status = 'claimed' then raise exception 'Chat cleanup has already started' using errcode = '40001'; end if;
  update public.threads t set deleted_at = null, updated_at = now() where t.id = p_thread_id returning t.* into v_thread;
  update public.thread_cleanup_jobs j set status = 'completed', claim_token = null, claim_expires_at = null,
    paths = array[]::text[], updated_at = now() where j.thread_id = p_thread_id and j.status = 'pending';
  return v_thread;
end;
$$;

create or replace function public.claim_thread_cleanup_jobs(p_limit integer default 5, p_lease_seconds integer default 180)
returns table(job_id uuid, thread_id uuid, claim_token uuid, paths text[])
language plpgsql security definer
set search_path = pg_catalog, public, pg_temp
as $$
declare v_user_id uuid := auth.uid(); v_candidate record; v_job public.thread_cleanup_jobs%rowtype; v_thread_deleted_at timestamptz; v_token uuid;
begin
  if v_user_id is null then raise exception 'Not authenticated' using errcode = '28000'; end if;
  if p_limit is null or p_limit < 1 or p_limit > 20 then raise exception 'Invalid cleanup batch size' using errcode = '22023'; end if;
  for v_candidate in
    select j.id, j.thread_id from public.thread_cleanup_jobs j
    where j.user_id = v_user_id and j.status in ('pending', 'claimed')
      and (j.status = 'pending' and j.available_at <= now() or j.status = 'claimed' and j.claim_expires_at <= now())
    order by j.available_at, j.created_at limit p_limit * 4
  loop
    exit when p_limit <= 0;
    -- Always acquire the thread lock before the job lock, matching restore_thread.
    select t.deleted_at into v_thread_deleted_at from public.threads t
      where t.id = v_candidate.thread_id and t.user_id = v_user_id for update skip locked;
    if not found or v_thread_deleted_at is null or v_thread_deleted_at + interval '30 seconds' > now() then continue; end if;
    select j.* into v_job from public.thread_cleanup_jobs j where j.id = v_candidate.id and j.user_id = v_user_id
      and (j.status = 'pending' and j.available_at <= now() or j.status = 'claimed' and j.claim_expires_at <= now())
      for update skip locked;
    if not found then continue; end if;
    v_token := gen_random_uuid();
    update public.thread_cleanup_jobs j set status = 'claimed', claim_token = v_token,
      claim_expires_at = now() + make_interval(secs => least(600, greatest(30, coalesce(p_lease_seconds, 180)))),
      attempts = j.attempts + 1, paths = (
        select coalesce(array_agg(distinct candidate.path), array[]::text[])
        from (
          select ap.path from public.messages m cross join lateral public.attachment_paths(m.attachments) ap(path)
            join storage.objects o on o.bucket_id = 'chat-attachments' and o.name = ap.path
            where m.thread_id = v_candidate.thread_id
          union
          select o.name from storage.objects o
            where o.bucket_id = 'chat-attachments'
              and cardinality(storage.foldername(o.name)) = 2
              and (storage.foldername(o.name))[1] = v_user_id::text
              and (storage.foldername(o.name))[2] = v_candidate.thread_id::text
        ) candidate
        where candidate.path ~ ('^' || v_user_id::text || '/[0-9a-fA-F-]{36}/[^/]+$')
          and not public.thread_path_is_referenced(candidate.path, v_user_id)
      ), last_error = null, updated_at = now()
      where j.id = v_candidate.id returning j.* into v_job;
    job_id := v_job.id; thread_id := v_job.thread_id; claim_token := v_token; paths := v_job.paths;
    return next;
    p_limit := p_limit - 1;
  end loop;
end;
$$;

create or replace function public.finish_thread_cleanup_job(p_job_id uuid, p_claim_token uuid)
returns boolean
language plpgsql security definer
set search_path = pg_catalog, public, pg_temp
as $$
declare v_user_id uuid := auth.uid(); v_thread_id uuid; v_deleted_at timestamptz;
begin
  if v_user_id is null then raise exception 'Not authenticated' using errcode = '28000'; end if;
  select j.thread_id into v_thread_id from public.thread_cleanup_jobs j where j.id = p_job_id and j.user_id = v_user_id;
  if not found then return false; end if;
  select t.deleted_at into v_deleted_at from public.threads t where t.id = v_thread_id and t.user_id = v_user_id for update;
  if not found or v_deleted_at is null or v_deleted_at + interval '30 seconds' > now() then return false; end if;
  perform 1 from public.thread_cleanup_jobs j where j.id = p_job_id and j.user_id = v_user_id
    and j.status = 'claimed' and j.claim_token = p_claim_token and j.claim_expires_at > now() for update;
  if not found then return false; end if;
  if exists (
    select 1 from storage.objects o
    where o.bucket_id = 'chat-attachments'
      and (
        exists (select 1 from public.thread_cleanup_jobs j cross join lateral unnest(j.paths) requested(path)
          where j.id = p_job_id and requested.path = o.name)
        or (cardinality(storage.foldername(o.name)) = 2
          and (storage.foldername(o.name))[1] = v_user_id::text
          and (storage.foldername(o.name))[2] = v_thread_id::text)
      )
      and not public.thread_path_is_referenced(o.name, v_user_id)
  ) then return false; end if;
  delete from public.threads t where t.id = v_thread_id and t.user_id = v_user_id and t.deleted_at is not null;
  update public.thread_cleanup_jobs j set status = 'completed', claim_token = null, claim_expires_at = null, updated_at = now()
    where j.id = p_job_id;
  return true;
end;
$$;

create or replace function public.fail_thread_cleanup_job(p_job_id uuid, p_claim_token uuid, p_error text)
returns boolean
language plpgsql security definer
set search_path = pg_catalog, public, pg_temp
as $$
declare v_user_id uuid := auth.uid(); v_attempts integer; v_updated integer;
begin
  if v_user_id is null then raise exception 'Not authenticated' using errcode = '28000'; end if;
  update public.thread_cleanup_jobs j set status = 'pending', claim_token = null, claim_expires_at = null,
    available_at = now() + make_interval(secs => least(3600, 15 * power(2, least(j.attempts, 8))::integer)),
    last_error = left(coalesce(p_error, 'Storage cleanup failed'), 1000), updated_at = now()
  where j.id = p_job_id and j.user_id = v_user_id and j.status = 'claimed' and j.claim_token = p_claim_token and j.claim_expires_at > now();
  get diagnostics v_updated = row_count;
  return v_updated > 0;
end;
$$;

create or replace function public.cleanup_empty_new_chat_threads(exclude_thread_id uuid default null)
returns integer
language plpgsql security definer
set search_path = pg_catalog, public, pg_temp
as $$
declare v_user_id uuid := auth.uid(); v_count integer := 0; v_thread record;
begin
  if v_user_id is null then raise exception 'Not authenticated' using errcode = '28000'; end if;
  for v_thread in select t.id from public.threads t where t.user_id = v_user_id and t.deleted_at is null and t.title = 'New Chat'
    and (exclude_thread_id is null or t.id <> exclude_thread_id)
    and not exists(select 1 from public.messages m where m.thread_id = t.id)
    order by t.created_at for update skip locked
  loop
    perform public.delete_thread(v_thread.id); v_count := v_count + 1;
  end loop;
  return v_count;
end;
$$;

-- Storage read remains available through active branch references. Deletes are
-- allowed only for a currently leased cleanup path that no active chat uses.
drop policy if exists "Users can read own attachments" on storage.objects;
create policy "Users can read own attachments" on storage.objects for select to authenticated
using (bucket_id = 'chat-attachments' and cardinality(storage.foldername(name)) = 2
  and (storage.foldername(name))[1] = (select auth.uid())::text
  and (exists(select 1 from public.threads t where t.id::text = (storage.foldername(name))[2] and t.user_id = (select auth.uid())
        and (t.deleted_at is null or t.deleted_at + interval '30 seconds' > clock_timestamp()))
    or public.thread_path_is_referenced(name, (select auth.uid()))
    or public.thread_cleanup_path_is_claimed(name, (select auth.uid()))));
drop policy if exists "Users can insert own attachments" on storage.objects;
create policy "Users can insert own attachments" on storage.objects for insert to authenticated
with check (bucket_id = 'chat-attachments' and cardinality(storage.foldername(name)) = 2
  and (storage.foldername(name))[1] = (select auth.uid())::text
  and public.thread_folder_is_active_for_storage(name, (select auth.uid())));
drop policy if exists "Users can update own attachments" on storage.objects;
-- 202610020001 intentionally removed object replacement/update.
drop policy if exists "Users can delete own attachments" on storage.objects;
create policy "Users can delete own attachments" on storage.objects for delete to authenticated
using (bucket_id = 'chat-attachments' and cardinality(storage.foldername(name)) = 2
  and (storage.foldername(name))[1] = (select auth.uid())::text
  and (public.thread_cleanup_path_is_claimed(name, (select auth.uid()))
    or public.thread_folder_is_active_for_storage(name, (select auth.uid())))
  and not public.thread_path_is_referenced(name, (select auth.uid())));

revoke all on function public.delete_thread(uuid) from public, anon;
revoke all on function public.restore_thread(uuid) from public, anon;
revoke all on function public.claim_thread_cleanup_jobs(integer, integer) from public, anon;
revoke all on function public.finish_thread_cleanup_job(uuid, uuid) from public, anon;
revoke all on function public.fail_thread_cleanup_job(uuid, uuid, text) from public, anon;
revoke all on function public.cleanup_empty_new_chat_threads(uuid) from public, anon;
grant execute on function public.delete_thread(uuid) to authenticated;
grant execute on function public.restore_thread(uuid) to authenticated;
grant execute on function public.claim_thread_cleanup_jobs(integer, integer) to authenticated;
grant execute on function public.finish_thread_cleanup_job(uuid, uuid) to authenticated;
grant execute on function public.fail_thread_cleanup_job(uuid, uuid, text) to authenticated;
grant execute on function public.cleanup_empty_new_chat_threads(uuid) to authenticated;

create index if not exists threads_user_updated_id_desc_idx
  on public.threads (user_id, updated_at desc, id desc) where deleted_at is null;
