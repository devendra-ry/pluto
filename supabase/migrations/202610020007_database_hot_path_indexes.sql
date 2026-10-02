-- Index the current database hot paths without changing message visibility or
-- attachment retention semantics.

-- Message search is a substring ILIKE query. Resolve pg_trgm's actual schema
-- because older Supabase projects may have installed it in public.
do $$
declare
  pg_trgm_schema text;
begin
  select ns.nspname
    into pg_trgm_schema
    from pg_extension ext
    join pg_namespace ns on ns.oid = ext.extnamespace
   where ext.extname = 'pg_trgm';

  if pg_trgm_schema is null then
    raise exception 'pg_trgm extension is not installed';
  end if;

  execute format(
    'create index if not exists messages_visible_content_trgm_idx on public.messages using gin (content %I.gin_trgm_ops) where deleted_at is null and content is not null',
    pg_trgm_schema
  );
end;
$$;

-- Support the exact JSON containment lookups used by storage-reference checks
-- and upload authorization. Soft-deleted messages stay indexed because they
-- continue protecting files during undo and shared-branch retention windows.
create index if not exists messages_attachments_path_gin_idx
  on public.messages using gin (attachments jsonb_path_ops);

-- These names deliberately differ from the historical non-partial indexes.
-- Migration 006 used IF NOT EXISTS with an old index name, so that statement
-- does not replace the existing non-partial index on upgraded databases.
create index if not exists threads_active_user_updated_id_desc_idx
  on public.threads (user_id, updated_at desc, id desc)
  where deleted_at is null;

create index if not exists message_delete_audit_unrestored_ids_gin_idx
  on public.message_delete_audit using gin (message_ids)
  where restored_at is null;

-- The cleanup queue deliberately has no thread_id foreign key because its
-- completed receipt can outlive the deleted thread. User deletion should still
-- remove every associated job, including completed rows.
do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.thread_cleanup_jobs'::regclass
      and conname = 'thread_cleanup_jobs_user_id_fkey'
  ) then
    alter table public.thread_cleanup_jobs
      add constraint thread_cleanup_jobs_user_id_fkey
      foreign key (user_id) references auth.users(id) on delete cascade;
  end if;
end;
$$;

create index if not exists thread_cleanup_jobs_user_id_idx
  on public.thread_cleanup_jobs (user_id);

-- Old column grants survive a table-level UPDATE revoke. Keep all message
-- edits on the parent-locking RPC path so cleanup/edit locking cannot be
-- bypassed through the Supabase table API.
revoke update (content, reasoning, attachments) on table public.messages from authenticated;

-- Parse the owner/thread folders once into UUID values, so thread ownership
-- checks use the threads primary-key index rather than casting every id to
-- text. Reject malformed and non-canonical UUID folders before casting.
create or replace function public.attachment_path_thread_id(p_path text, p_user_id uuid)
returns uuid
language plpgsql immutable
set search_path = pg_catalog, storage
as $$
declare
  v_folders text[];
begin
  if p_path is null or p_user_id is null then
    return null;
  end if;

  v_folders := storage.foldername(p_path);
  if coalesce(cardinality(v_folders), 0) <> 2
    or v_folders[2] is null
    or v_folders[1] <> p_user_id::text
    or v_folders[2] !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then
    return null;
  end if;

  return v_folders[2]::uuid;
end;
$$;

revoke all on function public.attachment_path_thread_id(text, uuid) from public, anon;
grant execute on function public.attachment_path_thread_id(text, uuid) to authenticated, service_role;

-- Match the previous attachment_paths() expansion exactly: only non-empty
-- path values on object elements of an array count, regardless of message
-- soft-delete status. The containment operator can use the JSON GIN index.
create or replace function public.thread_path_is_referenced(p_path text, p_user_id uuid)
returns boolean
language sql stable security definer
set search_path = pg_catalog, public, pg_temp
as $$
  select p_user_id = auth.uid()
    and p_path is not null
    and p_path <> ''
    and exists (
      select 1
      from public.messages m
      join public.threads t on t.id = m.thread_id
      where t.user_id = p_user_id
        and (t.deleted_at is null or t.deleted_at + interval '30 seconds' > clock_timestamp())
        and m.attachments <> '[]'::jsonb
        and m.attachments @> jsonb_build_array(jsonb_build_object('path', p_path))
    )
$$;

create or replace function public.thread_folder_is_active_for_storage(p_path text, p_user_id uuid)
returns boolean
language plpgsql security definer
set search_path = pg_catalog, public, pg_temp
as $$
declare
  v_thread_id uuid;
begin
  if p_user_id is distinct from auth.uid() then
    return false;
  end if;

  v_thread_id := public.attachment_path_thread_id(p_path, p_user_id);
  if v_thread_id is null then
    return false;
  end if;

  perform 1
    from public.threads t
   where t.id = v_thread_id
     and t.user_id = p_user_id
     and t.deleted_at is null
   for share;
  return found;
end;
$$;

revoke all on function public.thread_path_is_referenced(text, uuid) from public, anon;
revoke all on function public.thread_folder_is_active_for_storage(text, uuid) from public, anon;
grant execute on function public.thread_path_is_referenced(text, uuid) to authenticated, service_role;
grant execute on function public.thread_folder_is_active_for_storage(text, uuid) to authenticated, service_role;

-- Preserve the existing grace-period, shared-reference, and active-lease
-- branches while replacing the text-cast UUID lookup with a primary-key lookup.
drop policy if exists "Users can read own attachments" on storage.objects;
create policy "Users can read own attachments" on storage.objects for select to authenticated
using (bucket_id = 'chat-attachments'
  and cardinality(storage.foldername(name)) = 2
  and (storage.foldername(name))[1] = (select auth.uid())::text
  and (
    exists (
      select 1
      from public.threads t
      where t.id = public.attachment_path_thread_id(name, (select auth.uid()))
        and t.user_id = (select auth.uid())
        and (t.deleted_at is null or t.deleted_at + interval '30 seconds' > clock_timestamp())
    )
    or public.thread_path_is_referenced(name, (select auth.uid()))
    or public.thread_cleanup_path_is_claimed(name, (select auth.uid()))
  ));

-- Mark an audit record restored only when this call actually restored at least
-- one of its message IDs. Array overlap is backed by the partial GIN index.
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
  v_user_id uuid := auth.uid(); v_thread_id uuid; v_count integer := 0;
  v_restore_window integer := least(10080, greatest(1, coalesce(p_restore_window_minutes, 1440)));
begin
  if v_user_id is null then raise exception 'Not authenticated' using errcode = '28000'; end if;
  if p_message_ids is null or cardinality(p_message_ids) = 0 then return 0; end if;
  if cardinality(p_message_ids) > 1000 then raise exception 'At most 1000 messages can be restored at once' using errcode = '22023'; end if;
  if array_position(p_message_ids, null) is not null then raise exception 'Message IDs cannot contain null' using errcode = '22023'; end if;

  -- Preserve the established parent-first lock order used by edit, branch, and
  -- thread cleanup operations.
  for v_thread_id in
    select distinct m.thread_id
    from public.messages m
    join public.threads t on t.id = m.thread_id
    where m.id = any(p_message_ids)
      and m.user_id = v_user_id
      and m.deleted_by = v_user_id
      and m.deleted_at is not null
      and m.deleted_at >= now() - make_interval(mins => v_restore_window)
      and t.user_id = v_user_id
      and t.deleted_at is null
    order by m.thread_id
  loop
    perform 1 from public.threads t
    where t.id = v_thread_id and t.user_id = v_user_id and t.deleted_at is null
    for update;
  end loop;

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
      and t.deleted_at is null
  ),
  restored as (
    update public.messages m
    set deleted_at = null,
        deleted_by = null
    from target
    where m.id = target.id
    returning m.id
  ),
  restored_ids as (
    select coalesce(array_agg(id), array[]::uuid[]) as ids
    from restored
  ),
  audited as (
    update public.message_delete_audit a
    set restored_at = now()
    where a.actor_user_id = v_user_id
      and a.restored_at is null
      and a.message_ids && (select ids from restored_ids)
    returning 1
  )
  select count(*)::integer into v_count
  from restored;

  return v_count;
end;
$$;

revoke all on function public.restore_soft_deleted_messages(uuid[], integer) from public, anon, authenticated;
grant execute on function public.restore_soft_deleted_messages(uuid[], integer) to authenticated;
