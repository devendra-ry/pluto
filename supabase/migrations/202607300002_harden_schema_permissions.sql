-- Harden Pluto's public schema, RPCs, and attachment storage.

-- Keep ownership columns referentially consistent when an auth user is removed.
alter table public.threads
  drop constraint if exists threads_user_id_fkey;
alter table public.threads
  add constraint threads_user_id_fkey
  foreign key (user_id) references auth.users(id) on delete cascade;

alter table public.messages
  drop constraint if exists messages_user_id_fkey;
alter table public.messages
  add constraint messages_user_id_fkey
  foreign key (user_id) references auth.users(id) on delete cascade;

alter table public.generation_jobs
  drop constraint if exists generation_jobs_user_id_fkey;
alter table public.generation_jobs
  add constraint generation_jobs_user_id_fkey
  foreign key (user_id) references auth.users(id) on delete cascade;

alter table public.message_delete_audit
  drop constraint if exists message_delete_audit_actor_user_id_fkey;
alter table public.message_delete_audit
  add constraint message_delete_audit_actor_user_id_fkey
  foreign key (actor_user_id) references auth.users(id) on delete cascade;

-- Normalize nullable legacy defaults before enforcing application limits.
update public.threads set title = 'New Chat' where title is null;
update public.threads set is_pinned = false where is_pinned is null;

alter table public.threads
  alter column title set default 'New Chat',
  alter column title set not null,
  alter column is_pinned set default false,
  alter column is_pinned set not null;

alter table public.threads
  drop constraint if exists threads_title_length_check,
  add constraint threads_title_length_check
    check (length(title) between 1 and 200),
  drop constraint if exists threads_model_length_check,
  add constraint threads_model_length_check
    check (model is null or length(model) between 1 and 256);

alter table public.messages
  drop constraint if exists messages_content_length_check,
  add constraint messages_content_length_check
    check (content is null or length(content) <= 100000),
  drop constraint if exists messages_reasoning_length_check,
  add constraint messages_reasoning_length_check
    check (reasoning is null or length(reasoning) <= 100000),
  drop constraint if exists messages_model_id_length_check,
  add constraint messages_model_id_length_check
    check (model_id is null or length(model_id) between 1 and 256),
  drop constraint if exists messages_attachments_count_check,
  add constraint messages_attachments_count_check
    check (jsonb_array_length(attachments) <= 6),
  drop constraint if exists messages_attachments_size_check,
  add constraint messages_attachments_size_check
    check (octet_length(attachments::text) <= 131072),
  drop constraint if exists messages_reply_stats_size_check,
  add constraint messages_reply_stats_size_check
    check (reply_stats is null or octet_length(reply_stats::text) <= 16384);

alter table public.generation_jobs
  drop constraint if exists generation_jobs_model_id_length_check,
  add constraint generation_jobs_model_id_length_check
    check (model_id is null or length(model_id) between 1 and 256),
  drop constraint if exists generation_jobs_system_prompt_length_check,
  add constraint generation_jobs_system_prompt_length_check
    check (system_prompt is null or length(system_prompt) <= 50000),
  drop constraint if exists generation_jobs_error_length_check,
  add constraint generation_jobs_error_length_check
    check (error is null or length(error) <= 5000),
  drop constraint if exists generation_jobs_search_mode_check,
  add constraint generation_jobs_search_mode_check
    check (use_search = (mode = 'search'));

alter table public.message_delete_audit
  drop constraint if exists message_delete_audit_message_ids_check,
  add constraint message_delete_audit_message_ids_check
    check (cardinality(message_ids) between 1 and 1000),
  drop constraint if exists message_delete_audit_reason_length_check,
  add constraint message_delete_audit_reason_length_check
    check (length(reason) between 1 and 200);

-- Server-maintained timestamps prevent stale ordering data.
create or replace function public.set_updated_at()
returns trigger
language plpgsql
security invoker
set search_path = pg_catalog, public, pg_temp
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

drop trigger if exists set_threads_updated_at on public.threads;
create trigger set_threads_updated_at
before update on public.threads
for each row execute function public.set_updated_at();

drop trigger if exists set_generation_jobs_updated_at on public.generation_jobs;
create trigger set_generation_jobs_updated_at
before update on public.generation_jobs
for each row execute function public.set_updated_at();

-- RPCs that write protected columns validate auth and ownership explicitly.
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
security definer
set search_path = pg_catalog, public, pg_temp
as $$
declare
  v_user_id uuid := auth.uid();
  v_lease_seconds integer := least(600, greatest(30, coalesce(p_lease_seconds, 180)));
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
security definer
set search_path = pg_catalog, public, pg_temp
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
    error = case
      when p_status = 'failed' then left(coalesce(p_error, 'Generation failed'), 5000)
      else null
    end,
    claim_expires_at = null
  where gj.id = p_job_id
    and gj.user_id = v_user_id
    and gj.status in ('pending', 'claimed')
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

create or replace function public.soft_delete_messages(
  p_message_ids uuid[],
  p_reason text default 'manual',
  p_anchor_message_id uuid default null
)
returns integer
language plpgsql
security definer
set search_path = pg_catalog, public, pg_temp
as $$
declare
  v_user_id uuid := auth.uid();
  v_count integer := 0;
  v_reason text := left(coalesce(nullif(btrim(p_reason), ''), 'manual'), 200);
begin
  if v_user_id is null then
    raise exception 'Not authenticated';
  end if;

  if p_message_ids is null or cardinality(p_message_ids) = 0 then
    return 0;
  end if;

  if cardinality(p_message_ids) > 1000 then
    raise exception 'At most 1000 messages can be deleted at once';
  end if;

  if array_position(p_message_ids, null) is not null then
    raise exception 'Message IDs cannot contain null';
  end if;

  if p_anchor_message_id is not null and not exists (
    select 1
    from public.messages m
    join public.threads t on t.id = m.thread_id
    where m.id = p_anchor_message_id
      and m.user_id = v_user_id
      and t.user_id = v_user_id
  ) then
    raise exception 'Anchor message is unavailable';
  end if;

  with target as (
    select m.id, m.thread_id
    from public.messages m
    join public.threads t on t.id = m.thread_id
    where m.id = any(p_message_ids)
      and m.deleted_at is null
      and m.user_id = v_user_id
      and t.user_id = v_user_id
  ),
  updated as (
    update public.messages m
    set
      deleted_at = now(),
      deleted_by = v_user_id
    from target
    where m.id = target.id
    returning m.id, m.thread_id
  ),
  grouped as (
    select thread_id, array_agg(id order by id)::uuid[] as ids
    from updated
    group by thread_id
  ),
  inserted as (
    insert into public.message_delete_audit (
      actor_user_id,
      thread_id,
      message_ids,
      reason,
      anchor_message_id
    )
    select
      v_user_id,
      g.thread_id,
      g.ids,
      v_reason,
      p_anchor_message_id
    from grouped g
    returning 1
  )
  select count(*)::integer
  into v_count
  from updated;

  return v_count;
end;
$$;

create or replace function public.restore_soft_deleted_messages(
  p_message_ids uuid[],
  p_restore_window_minutes integer default 1440
)
returns integer
language plpgsql
security definer
set search_path = pg_catalog, public, pg_temp
as $$
declare
  v_user_id uuid := auth.uid();
  v_count integer := 0;
  v_restore_window integer :=
    least(10080, greatest(1, coalesce(p_restore_window_minutes, 1440)));
begin
  if v_user_id is null then
    raise exception 'Not authenticated';
  end if;

  if p_message_ids is null or cardinality(p_message_ids) = 0 then
    return 0;
  end if;

  if cardinality(p_message_ids) > 1000 then
    raise exception 'At most 1000 messages can be restored at once';
  end if;

  if array_position(p_message_ids, null) is not null then
    raise exception 'Message IDs cannot contain null';
  end if;

  with target as (
    select m.id
    from public.messages m
    join public.threads t on t.id = m.thread_id
    where m.id = any(p_message_ids)
      and m.user_id = v_user_id
      and m.deleted_by = v_user_id
      and m.deleted_at is not null
      and m.deleted_at >= now() - make_interval(mins => v_restore_window)
      and t.user_id = v_user_id
  ),
  restored as (
    update public.messages m
    set
      deleted_at = null,
      deleted_by = null
    from target
    where m.id = target.id
    returning m.id
  ),
  audited as (
    update public.message_delete_audit a
    set restored_at = now()
    where a.actor_user_id = v_user_id
      and a.restored_at is null
      and exists (
        select 1
        from unnest(a.message_ids) as mid
        join restored r on r.id = mid
      )
    returning 1
  )
  select count(*)::integer
  into v_count
  from restored;

  return v_count;
end;
$$;

create or replace function public.cleanup_empty_new_chat_threads(exclude_thread_id uuid default null)
returns integer
language sql
security invoker
set search_path = pg_catalog, public, pg_temp
as $$
  with deleted as (
    delete from public.threads t
    where t.title = 'New Chat'
      and t.user_id = auth.uid()
      and (exclude_thread_id is null or t.id <> exclude_thread_id)
      and not exists (
        select 1
        from public.messages m
        where m.thread_id = t.id
      )
    returning 1
  )
  select count(*)::integer from deleted;
$$;

-- Direct clients get only the operations and columns the application uses.
revoke all privileges on table public.threads from public, anon, authenticated;
revoke all privileges on table public.messages from public, anon, authenticated;
revoke all privileges on table public.generation_jobs from public, anon, authenticated;
revoke all privileges on table public.message_delete_audit from public, anon, authenticated;

grant select on table public.threads to authenticated;
grant insert (title, model, reasoning_effort, system_prompt, user_id)
  on table public.threads to authenticated;
grant update (title, model, reasoning_effort, is_pinned, updated_at, system_prompt)
  on table public.threads to authenticated;
grant delete on table public.threads to authenticated;

grant select on table public.messages to authenticated;
grant insert (
  thread_id,
  role,
  content,
  reasoning,
  model_id,
  attachments,
  reply_stats,
  user_id,
  created_at
) on table public.messages to authenticated;
grant update (content, reasoning, attachments)
  on table public.messages to authenticated;

grant select on table public.generation_jobs to authenticated;
grant insert (
  thread_id,
  user_message_id,
  user_id,
  mode,
  model_id,
  use_search,
  reasoning_effort,
  system_prompt,
  status
) on table public.generation_jobs to authenticated;

grant select on table public.message_delete_audit to authenticated;

grant all privileges on table public.threads to service_role;
grant all privileges on table public.messages to service_role;
grant all privileges on table public.generation_jobs to service_role;
grant all privileges on table public.message_delete_audit to service_role;

-- The client may enqueue only a fresh pending job.
drop policy if exists "Users can update own generation jobs" on public.generation_jobs;
drop policy if exists "Users can insert own generation jobs" on public.generation_jobs;
create policy "Users can insert own generation jobs"
on public.generation_jobs
for insert
to authenticated
with check (
  user_id = (select auth.uid())
  and status = 'pending'
  and claimed_at is null
  and claim_expires_at is null
  and error is null
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
      and m.deleted_at is null
  )
);

drop policy if exists "Users can delete messages in their threads" on public.messages;
drop policy if exists "Users can insert own message delete audit" on public.message_delete_audit;
drop policy if exists "Users can update own message delete audit" on public.message_delete_audit;

revoke all on function public.claim_pending_generation_job(uuid, uuid, integer)
  from public, anon, authenticated;
revoke all on function public.complete_generation_job(uuid, text, text)
  from public, anon, authenticated;
revoke all on function public.soft_delete_messages(uuid[], text, uuid)
  from public, anon, authenticated;
revoke all on function public.restore_soft_deleted_messages(uuid[], integer)
  from public, anon, authenticated;
revoke all on function public.cleanup_empty_new_chat_threads(uuid)
  from public, anon, authenticated;
revoke all on function public.set_updated_at()
  from public, anon, authenticated;

grant execute on function public.claim_pending_generation_job(uuid, uuid, integer)
  to authenticated, service_role;
grant execute on function public.complete_generation_job(uuid, text, text)
  to authenticated, service_role;
grant execute on function public.soft_delete_messages(uuid[], text, uuid)
  to authenticated, service_role;
grant execute on function public.restore_soft_deleted_messages(uuid[], integer)
  to authenticated, service_role;
grant execute on function public.cleanup_empty_new_chat_threads(uuid)
  to authenticated, service_role;

revoke usage on schema public from public, anon;
grant usage on schema public to authenticated, service_role;

alter default privileges in schema public
  revoke all privileges on tables from public, anon, authenticated;
alter default privileges in schema public
  revoke execute on functions from public, anon;

-- Attachment paths are user/thread/file; direct Storage API calls must own both.
update storage.buckets
set
  public = false,
  file_size_limit = 104857600,
  allowed_mime_types = array[
    'image/png',
    'image/jpeg',
    'image/webp',
    'image/gif',
    'application/pdf',
    'text/plain'
  ]
where id = 'chat-attachments';

drop policy if exists "Users can read own attachments" on storage.objects;
create policy "Users can read own attachments"
on storage.objects
for select
to authenticated
using (
  bucket_id = 'chat-attachments'
  and cardinality(storage.foldername(name)) = 2
  and (storage.foldername(name))[1] = (select auth.uid())::text
  and exists (
    select 1
    from public.threads t
    where t.id::text = (storage.foldername(name))[2]
      and t.user_id = (select auth.uid())
  )
);

drop policy if exists "Users can insert own attachments" on storage.objects;
create policy "Users can insert own attachments"
on storage.objects
for insert
to authenticated
with check (
  bucket_id = 'chat-attachments'
  and cardinality(storage.foldername(name)) = 2
  and (storage.foldername(name))[1] = (select auth.uid())::text
  and exists (
    select 1
    from public.threads t
    where t.id::text = (storage.foldername(name))[2]
      and t.user_id = (select auth.uid())
  )
);

drop policy if exists "Users can update own attachments" on storage.objects;
create policy "Users can update own attachments"
on storage.objects
for update
to authenticated
using (
  bucket_id = 'chat-attachments'
  and cardinality(storage.foldername(name)) = 2
  and (storage.foldername(name))[1] = (select auth.uid())::text
  and exists (
    select 1
    from public.threads t
    where t.id::text = (storage.foldername(name))[2]
      and t.user_id = (select auth.uid())
  )
)
with check (
  bucket_id = 'chat-attachments'
  and cardinality(storage.foldername(name)) = 2
  and (storage.foldername(name))[1] = (select auth.uid())::text
  and exists (
    select 1
    from public.threads t
    where t.id::text = (storage.foldername(name))[2]
      and t.user_id = (select auth.uid())
  )
);

drop policy if exists "Users can delete own attachments" on storage.objects;
create policy "Users can delete own attachments"
on storage.objects
for delete
to authenticated
using (
  bucket_id = 'chat-attachments'
  and cardinality(storage.foldername(name)) = 2
  and (storage.foldername(name))[1] = (select auth.uid())::text
  and exists (
    select 1
    from public.threads t
    where t.id::text = (storage.foldername(name))[2]
      and t.user_id = (select auth.uid())
  )
);

-- Superseded by messages_thread_created_id_desc_idx; no app query uses the global index.
drop index if exists public.messages_thread_created_idx;
drop index if exists public.messages_created_id_desc_idx;

analyze public.threads;
analyze public.messages;
analyze public.generation_jobs;
analyze public.message_delete_audit;
