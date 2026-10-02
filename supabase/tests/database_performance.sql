-- Rollback-only regression for the database hot-path indexes and semantics.
-- Run against a fully migrated local Supabase database with psql and ON_ERROR_STOP.
begin;

create temp table database_performance_context (
  key text primary key,
  user_id uuid not null,
  thread_id uuid,
  message_id uuid,
  path text
) on commit drop;
grant select on database_performance_context to authenticated;

do $$
declare
  v_owner uuid := gen_random_uuid();
  v_other uuid := gen_random_uuid();
  v_active_thread uuid := gen_random_uuid();
  v_grace_thread uuid := gen_random_uuid();
  v_expired_thread uuid := gen_random_uuid();
  v_other_thread uuid := gen_random_uuid();
  v_visible_message uuid := gen_random_uuid();
  v_deleted_message uuid := gen_random_uuid();
  v_recent_restore uuid := gen_random_uuid();
  v_expired_restore uuid := gen_random_uuid();
  v_foreign_reference_message uuid := gen_random_uuid();
  v_grace_message uuid := gen_random_uuid();
  v_expired_reference_message uuid := gen_random_uuid();
  v_active_path text;
  v_deleted_path text;
  v_grace_path text;
  v_expired_path text;
  v_foreign_reference_path text;
  v_other_private_path text;
  v_audit_recent uuid := gen_random_uuid();
  v_audit_expired uuid := gen_random_uuid();
  v_cleanup_owner uuid := gen_random_uuid();
  v_cleanup_job uuid := gen_random_uuid();
  v_count integer;
begin
  insert into auth.users (id, aud, role, email, encrypted_password, email_confirmed_at, created_at, updated_at)
  values
    (v_owner, 'authenticated', 'authenticated', 'db-performance-' || v_owner || '@example.test', '', now(), now(), now()),
    (v_other, 'authenticated', 'authenticated', 'db-performance-' || v_other || '@example.test', '', now(), now(), now()),
    (v_cleanup_owner, 'authenticated', 'authenticated', 'db-performance-' || v_cleanup_owner || '@example.test', '', now(), now(), now());

  insert into public.threads (id, user_id, title)
  values
    (v_active_thread, v_owner, 'Active search thread'),
    (v_grace_thread, v_owner, 'Undo grace thread'),
    (v_expired_thread, v_owner, 'Expired deleted thread'),
    (v_other_thread, v_other, 'Other user private thread');

  v_active_path := v_owner::text || '/' || v_active_thread::text || '/active.txt';
  v_deleted_path := v_owner::text || '/' || v_active_thread::text || '/soft-deleted.txt';
  v_grace_path := v_owner::text || '/' || v_grace_thread::text || '/grace.txt';
  v_expired_path := v_owner::text || '/' || v_expired_thread::text || '/expired.txt';
  v_foreign_reference_path := v_owner::text || '/' || v_active_thread::text || '/foreign-reference.txt';
  v_other_private_path := v_other::text || '/' || v_other_thread::text || '/private.txt';

  insert into public.messages (id, thread_id, user_id, role, content, attachments)
  values (v_visible_message, v_active_thread, v_owner, 'user', 'dense-search-needle visible',
          jsonb_build_array(jsonb_build_object('path', v_active_path, 'width', 640)));

  insert into public.messages (id, thread_id, user_id, role, content, attachments, deleted_at, deleted_by)
  values (v_deleted_message, v_active_thread, v_owner, 'user', 'dense-search-needle deleted',
          jsonb_build_array(jsonb_build_object('path', v_deleted_path, 'metadata', jsonb_build_object('source', 'test'))), now(), v_owner);

  insert into public.messages (id, thread_id, user_id, role, content, attachments, deleted_at, deleted_by)
  values
    (v_recent_restore, v_active_thread, v_owner, 'user', 'recent message to restore', '[]', now() - interval '1 minute', v_owner),
    (v_expired_restore, v_active_thread, v_owner, 'user', 'outside restore window', '[]', now() - interval '2 days', v_owner);

  -- A foreign owner's message points at an owner's path. It must not grant
  -- reference status to that path under the owner-scoped predicate.
  insert into public.messages (id, thread_id, user_id, role, content, attachments)
  values (v_foreign_reference_message, v_other_thread, v_other, 'user', 'foreign path reference',
          jsonb_build_array(jsonb_build_object('path', v_foreign_reference_path, 'source', 'other-user')));

  insert into public.messages (id, thread_id, user_id, role, content, attachments)
  values (v_grace_message, v_grace_thread, v_owner, 'user', 'grace-period reference',
          jsonb_build_array(jsonb_build_object('path', v_grace_path)));

  update public.threads set deleted_at = now() where id = v_grace_thread;
  insert into public.messages (id, thread_id, user_id, role, content, attachments)
  values (v_expired_reference_message, v_expired_thread, v_owner, 'user', 'expired reference',
          jsonb_build_array(jsonb_build_object('path', v_expired_path)));
  update public.threads set deleted_at = now() - interval '31 seconds' where id = v_expired_thread;

  insert into storage.objects (bucket_id, name)
  values
    ('chat-attachments', v_active_path),
    ('chat-attachments', v_deleted_path),
    ('chat-attachments', v_grace_path),
    ('chat-attachments', v_expired_path),
    ('chat-attachments', v_foreign_reference_path),
    ('chat-attachments', v_other_private_path);

  insert into public.message_delete_audit (id, actor_user_id, thread_id, message_ids, reason)
  values
    (v_audit_recent, v_owner, v_active_thread, array[v_recent_restore, v_expired_restore], 'recent-and-expired'),
    (v_audit_expired, v_owner, v_active_thread, array[v_expired_restore], 'expired-only');

  -- A user deletion must not leave durable cleanup jobs orphaned. No thread FK
  -- is added because completed cleanup receipts can outlive deleted threads.
  insert into public.thread_cleanup_jobs (id, thread_id, user_id, status, available_at)
  values (v_cleanup_job, gen_random_uuid(), v_cleanup_owner, 'completed', now());
  delete from auth.users where id = v_cleanup_owner;
  if exists (select 1 from public.thread_cleanup_jobs where id = v_cleanup_job) then
    raise exception 'auth user deletion left an orphan thread cleanup job';
  end if;

  insert into database_performance_context (key, user_id, thread_id, message_id, path)
  values
    ('owner', v_owner, null, null, null),
    ('other', v_other, null, null, null),
    ('active', v_owner, v_active_thread, v_visible_message, v_active_path),
    ('deleted-message', v_owner, v_active_thread, v_deleted_message, v_deleted_path),
    ('grace', v_owner, v_grace_thread, v_grace_message, v_grace_path),
    ('expired-thread', v_owner, v_expired_thread, v_expired_reference_message, v_expired_path),
    ('foreign-reference', v_owner, v_active_thread, v_foreign_reference_message, v_foreign_reference_path),
    ('other-private', v_other, v_other_thread, null, v_other_private_path),
    ('recent-restore', v_owner, v_active_thread, v_recent_restore, null),
    ('expired-restore', v_owner, v_active_thread, v_expired_restore, null),
    ('audit-recent', v_owner, v_active_thread, v_audit_recent, null),
    ('audit-expired', v_owner, v_active_thread, v_audit_expired, null);

  select count(*) into v_count
  from pg_indexes
  where schemaname = 'public'
    and indexname in (
      'messages_visible_content_trgm_idx',
      'messages_attachments_path_gin_idx',
      'threads_active_user_updated_id_desc_idx',
      'message_delete_audit_unrestored_ids_gin_idx',
      'thread_cleanup_jobs_user_id_idx'
    );
  if v_count <> 5 then
    raise exception 'one or more database hot-path indexes are missing';
  end if;
  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.thread_cleanup_jobs'::regclass
      and conname = 'thread_cleanup_jobs_user_id_fkey'
  ) then
    raise exception 'cleanup job user cascade foreign key is missing';
  end if;
end;
$$;

set local role authenticated;
select set_config('request.jwt.claim.sub', (select user_id::text from database_performance_context where key = 'owner'), true);

do $$
declare
  v_owner uuid := (select user_id from database_performance_context where key = 'owner');
  v_thread uuid := (select thread_id from database_performance_context where key = 'active');
  v_active_path text := (select path from database_performance_context where key = 'active');
  v_deleted_path text := (select path from database_performance_context where key = 'deleted-message');
  v_grace_path text := (select path from database_performance_context where key = 'grace');
  v_expired_path text := (select path from database_performance_context where key = 'expired-thread');
  v_foreign_path text := (select path from database_performance_context where key = 'foreign-reference');
  v_other_private_path text := (select path from database_performance_context where key = 'other-private');
  v_count integer;
  v_visible_message uuid := (select message_id from database_performance_context where key = 'active');
  v_edited_message uuid;
begin
  if has_column_privilege('authenticated', 'public.messages', 'content', 'UPDATE')
    or has_column_privilege('authenticated', 'public.messages', 'reasoning', 'UPDATE')
    or has_column_privilege('authenticated', 'public.messages', 'attachments', 'UPDATE') then
    raise exception 'authenticated role retained a direct column UPDATE grant';
  end if;

  select count(*) into v_count
  from public.messages
  where deleted_at is null
    and content ilike '%dense-search-needle%';
  if v_count <> 1 then
    raise exception 'message search RLS did not return only the visible owner message (got %)', v_count;
  end if;

  if public.attachment_path_thread_id(v_active_path, v_owner) <> v_thread then
    raise exception 'canonical attachment path did not resolve to the owner thread UUID';
  end if;
  if public.attachment_path_thread_id(v_owner::text || '/not-a-uuid/file.txt', v_owner) is not null
    or public.attachment_path_thread_id(v_owner::text || '/' || v_thread::text || '/nested/file.txt', v_owner) is not null
    or public.attachment_path_thread_id(v_active_path, (select user_id from database_performance_context where key = 'other')) is not null then
    raise exception 'malformed or foreign attachment path resolved to a thread';
  end if;

  if not public.thread_folder_is_active_for_storage(v_active_path, v_owner) then
    raise exception 'active owner attachment folder was rejected';
  end if;
  if public.thread_folder_is_active_for_storage(v_owner::text || '/' || (select thread_id::text from database_performance_context where key = 'other-private') || '/private.txt', v_owner) then
    raise exception 'another owner thread folder was accepted';
  end if;
  if public.thread_folder_is_active_for_storage(v_expired_path, v_owner) then
    raise exception 'an expired tombstone attachment folder was accepted';
  end if;

  -- JSON containment must match object path values exactly, tolerate metadata,
  -- and keep soft-deleted message references protected for undo.
  if not public.thread_path_is_referenced(v_active_path, v_owner) then
    raise exception 'attachment path with additional object metadata was not found';
  end if;
  if not public.thread_path_is_referenced(v_deleted_path, v_owner) then
    raise exception 'soft-deleted message attachment was no longer protected';
  end if;
  if not public.thread_path_is_referenced(v_grace_path, v_owner) then
    raise exception 'attachment reference inside the thread undo window was not protected';
  end if;
  if public.thread_path_is_referenced(v_expired_path, v_owner) then
    raise exception 'attachment reference beyond the thread undo window remained protected';
  end if;
  if public.thread_path_is_referenced(v_foreign_path, v_owner) then
    raise exception 'another owner message granted an attachment reference';
  end if;
  if public.thread_path_is_referenced(v_active_path || '-suffix', v_owner)
    or public.thread_path_is_referenced('', v_owner)
    or public.thread_path_is_referenced(v_active_path, (select user_id from database_performance_context where key = 'other')) then
    raise exception 'attachment reference containment was not exact and caller-scoped';
  end if;

  -- Storage SELECT still respects owner, undo grace, and reference policy.
  select count(*) into v_count from storage.objects where name = v_active_path;
  if v_count <> 1 then raise exception 'owner could not read an active attachment'; end if;
  select count(*) into v_count from storage.objects where name = v_grace_path;
  if v_count <> 1 then raise exception 'owner could not read an attachment during thread undo'; end if;
  select count(*) into v_count from storage.objects where name = v_expired_path;
  if v_count <> 0 then raise exception 'owner could read an attachment after the undo window'; end if;
  select count(*) into v_count from storage.objects where name = v_other_private_path;
  if v_count <> 0 then raise exception 'owner could read another user attachment'; end if;

  if public.restore_soft_deleted_messages(
    array[
      (select message_id from database_performance_context where key = 'recent-restore'),
      (select message_id from database_performance_context where key = 'expired-restore')
    ], 1440
  ) <> 1 then
    raise exception 'restore did not restore exactly the eligible message';
  end if;
  if (select restored_at is null from public.message_delete_audit where id = (select message_id from database_performance_context where key = 'audit-recent')) then
    raise exception 'audit row containing an actually restored message was not marked restored';
  end if;
  if (select restored_at is not null from public.message_delete_audit where id = (select message_id from database_performance_context where key = 'audit-expired')) then
    raise exception 'audit row was marked restored without any message being restored';
  end if;

  select result.user_message_id into v_edited_message
  from public.edit_user_message(v_thread, v_visible_message, 'edited through RPC', 'test-model', '[]'::jsonb) result;
  if not exists (
    select 1 from public.messages where id = v_edited_message and content = 'edited through RPC' and deleted_at is null
  ) then
    raise exception 'message edit RPC failed after direct column UPDATE was revoked';
  end if;
end;
$$;

reset role;
rollback;
