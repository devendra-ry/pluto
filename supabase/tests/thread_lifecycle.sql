-- Transactional regression for branching, undo, and cleanup fencing.
-- Run against a migrated local Supabase database with psql and ON_ERROR_STOP.
begin;

-- These rollback-only fixtures contain metadata, never real stored bytes.
-- Emulate the Storage API's transaction flag so its direct-delete guard does
-- not mask the authenticated RLS policies that this regression exercises.
set local storage.allow_delete_query = 'true';

create temp table thread_lifecycle_context (
  key text primary key, user_id uuid not null, thread_id uuid, path text, job_id uuid, claim_token uuid
) on commit drop;
grant select on thread_lifecycle_context to authenticated;

do $$
declare
  v_user_id uuid := gen_random_uuid();
  v_thread_id uuid := gen_random_uuid();
  v_branch public.threads%rowtype;
  v_receipt record;
  v_claim record;
  v_reply uuid := '00000000-0000-4000-8000-000000000001';
  v_oldest uuid := '00000000-0000-4000-8000-000000000002';
  v_anchor uuid := '00000000-0000-4000-8000-000000000003';
  v_equal_time timestamptz := '2026-01-01 00:00:00+00';
  v_count integer; v_other_user_id uuid := gen_random_uuid(); v_thread_count integer;
begin
  insert into auth.users (id, aud, role, email, encrypted_password, email_confirmed_at, created_at, updated_at)
  values (v_user_id, 'authenticated', 'authenticated', 'thread-life-' || v_user_id || '@example.test', '', now(), now(), now());
  perform set_config('request.jwt.claim.sub', v_user_id::text, true);
  perform set_config('request.jwt.claim.role', 'authenticated', true);

  insert into public.threads (id, user_id, title, model, reasoning_effort, system_prompt)
  values (v_thread_id, v_user_id, 'Lifecycle test', 'test-model', 'high', 'preserve settings');
  insert into public.messages (id, thread_id, user_id, role, content, attachments, reply_stats, reply_to_message_id, created_at)
  values
    (v_reply, v_thread_id, v_user_id, 'assistant', 'reply', '[]'::jsonb, '{"tokens":3}'::jsonb, v_oldest, v_equal_time),
    (v_oldest, v_thread_id, v_user_id, 'user', 'first', ('[{"path":"' || v_user_id || '/' || v_thread_id || '/one.txt"}]')::jsonb, null, null, v_equal_time),
    (v_anchor, v_thread_id, v_user_id, 'user', 'anchor', '[]', null, null, v_equal_time);

  v_branch := public.branch_thread(v_thread_id, v_anchor);
  if v_branch.user_id <> v_user_id or v_branch.model <> 'test-model' or v_branch.reasoning_effort <> 'high' or v_branch.system_prompt <> 'preserve settings' then
    raise exception 'branch did not preserve thread settings';
  end if;
  if (select count(*) from public.messages where thread_id = v_branch.id) <> 3 then
    raise exception 'branch did not copy the complete persisted prefix';
  end if;
  if (select string_agg(content, ',' order by created_at, id) from public.messages where thread_id = v_branch.id) <> 'reply,first,anchor' then
    raise exception 'branch did not retain deterministic source order for tied timestamps';
  end if;
  if not exists (
    select 1 from public.messages copied_reply
    join public.messages copied_user on copied_user.thread_id = copied_reply.thread_id and copied_user.id = copied_reply.reply_to_message_id
    where copied_reply.thread_id = v_branch.id and copied_reply.content = 'reply' and copied_user.content = 'first'
  ) then raise exception 'branch reply link was not remapped'; end if;
  if not exists (
    select 1 from public.messages where thread_id = v_branch.id and content = 'reply' and reply_stats = '{"tokens":3}'::jsonb
  ) then raise exception 'branch reply statistics were not copied'; end if;
  if not exists (select 1 from public.messages a join public.messages b on a.thread_id = b.thread_id
    where a.thread_id = v_branch.id and a.content = 'reply' and b.content = 'first' and a.created_at < b.created_at) then
    raise exception 'branch timestamps do not preserve deterministic tied-row order';
  end if;

  insert into auth.users (id, aud, role, email, encrypted_password, email_confirmed_at, created_at, updated_at)
  values (v_other_user_id, 'authenticated', 'authenticated', 'thread-owner-' || v_other_user_id || '@example.test', '', now(), now(), now());
  select count(*) into v_thread_count from public.threads;
  perform set_config('request.jwt.claim.sub', v_other_user_id::text, true);
  begin
    perform public.branch_thread(v_thread_id, v_anchor);
    raise exception 'another user branched a private chat';
  exception when sqlstate 'P0002' then null;
  end;
  begin
    perform public.delete_thread(v_thread_id);
    raise exception 'another user deleted a private chat';
  exception when sqlstate 'P0002' then null;
  end;
  perform set_config('request.jwt.claim.sub', v_user_id::text, true);
  if (select count(*) from public.threads where id = v_thread_id and deleted_at is null) <> 1 then
    raise exception 'unauthorized lifecycle calls changed the parent';
  end if;
  if (select count(*) from public.threads) <> v_thread_count then raise exception 'unauthorized branch left a new thread'; end if;

  select * into v_receipt from public.delete_thread(v_thread_id);
  if v_receipt.thread_id <> v_thread_id or v_receipt.undo_until <= v_receipt.deleted_at then
    raise exception 'delete receipt has invalid undo window';
  end if;
  -- A failed claim is harmless before the grace window expires.
  if exists(select 1 from public.claim_thread_cleanup_jobs(5, 60)) then raise exception 'cleanup claimed before grace elapsed'; end if;

  -- Restore wins before claim and cancels the durable cleanup row.
  perform public.restore_thread(v_thread_id);
  if exists(select 1 from public.thread_cleanup_jobs where thread_id = v_thread_id and status <> 'completed') then
    raise exception 'restore did not cancel the queued job';
  end if;

  select * into v_receipt from public.delete_thread(v_thread_id);
  update public.threads set deleted_at = now() - interval '31 seconds' where id = v_thread_id;
  update public.thread_cleanup_jobs set available_at = now() - interval '31 seconds' where thread_id = v_thread_id and status = 'pending';
  select * into v_claim from public.claim_thread_cleanup_jobs(5, 60) where thread_id = v_thread_id;
  if v_claim.claim_token is null then raise exception 'eligible cleanup job was not claimed'; end if;
  begin
    perform public.restore_thread(v_thread_id);
    raise exception 'restore succeeded after a cleanup claim';
  exception when sqlstate '40001' then null;
  end;
  if public.finish_thread_cleanup_job(v_claim.job_id, gen_random_uuid()) then raise exception 'stale cleanup token was accepted'; end if;
  if not public.fail_thread_cleanup_job(v_claim.job_id, v_claim.claim_token, 'test retry') then raise exception 'current cleanup claim could not be returned to retry'; end if;
  if public.finish_thread_cleanup_job(v_claim.job_id, v_claim.claim_token) then raise exception 'finished a failed/stale cleanup claim'; end if;
end;
$$;

-- A branch keeps its parent's object readable/undeleted after parent cleanup;
-- deleting that last branch makes the shared object eligible for cleanup.
do $$
declare
  v_user_id uuid := gen_random_uuid(); v_parent_id uuid := gen_random_uuid(); v_draft_id uuid := gen_random_uuid(); v_hidden_id uuid := gen_random_uuid();
  v_attachment_path text; v_draft_path text; v_branch public.threads%rowtype; v_claim record;
begin
  insert into auth.users (id, aud, role, email, encrypted_password, email_confirmed_at, created_at, updated_at)
  values (v_user_id, 'authenticated', 'authenticated', 'thread-ref-' || v_user_id || '@example.test', '', now(), now(), now());
  perform set_config('request.jwt.claim.sub', v_user_id::text, true);
  v_attachment_path := v_user_id::text || '/' || v_parent_id::text || '/shared.txt';
  insert into public.threads(id, user_id, title, model) values(v_parent_id, v_user_id, 'Attachment parent', 'test-model');
  insert into public.messages(thread_id, user_id, role, content, attachments)
  values(v_parent_id, v_user_id, 'user', 'file', jsonb_build_array(jsonb_build_object('path', v_attachment_path)));
  insert into storage.objects(bucket_id, name) values('chat-attachments', v_attachment_path);
  select * into v_branch from public.branch_thread(v_parent_id, (select id from public.messages where thread_id = v_parent_id));
  v_draft_path := v_user_id::text || '/' || v_draft_id::text || '/unreferenced.txt';
  insert into public.threads(id, user_id, title, model) values(v_draft_id, v_user_id, 'Draft with file', 'test-model');
  insert into storage.objects(bucket_id, name) values('chat-attachments', v_draft_path);
  insert into public.threads(id, user_id, title, model) values(v_hidden_id, v_user_id, 'Undo window', 'test-model');

  perform public.delete_thread(v_parent_id);
  perform public.delete_thread(v_branch.id);
  perform public.delete_thread(v_hidden_id);
  update public.threads set deleted_at = now() - interval '31 seconds' where id = v_parent_id;
  update public.thread_cleanup_jobs set available_at = now() - interval '31 seconds' where thread_id = v_parent_id and status = 'pending';
  select * into v_claim from public.claim_thread_cleanup_jobs(5, 60) where thread_id = v_parent_id;
  if v_attachment_path = any(v_claim.paths) then raise exception 'parent cleanup claimed an attachment still referenced by an active branch'; end if;
  if not public.finish_thread_cleanup_job(v_claim.job_id, v_claim.claim_token) then raise exception 'parent cleanup could not finish around a retained branch attachment'; end if;
  if not public.thread_path_is_referenced(v_attachment_path, v_user_id) then raise exception 'active branch did not retain the parent attachment reference'; end if;
  perform public.restore_thread(v_branch.id);
  insert into thread_lifecycle_context(key, user_id, thread_id, path) values
    ('retained', v_user_id, v_branch.id, v_attachment_path),
    ('draft', v_user_id, v_draft_id, v_draft_path),
    ('hidden', v_user_id, v_hidden_id, null);
end;
$$;

-- Exercise the Storage and threads policies as a real authenticated role.
set local role authenticated;
select set_config('request.jwt.claim.sub', (select user_id::text from thread_lifecycle_context where key = 'retained'), true);
do $$
declare v_count integer; v_deleted integer;
begin
  select count(*) into v_count from public.threads where id = (select thread_id from thread_lifecycle_context where key = 'hidden');
  if v_count <> 0 then raise exception 'soft-deleted thread remained visible'; end if;
  select count(*) into v_count from storage.objects where name = (select path from thread_lifecycle_context where key = 'retained');
  if v_count <> 1 then raise exception 'active branch could not read its parent attachment'; end if;
  delete from storage.objects where name = (select path from thread_lifecycle_context where key = 'retained');
  get diagnostics v_deleted = row_count;
  if v_deleted <> 0 then raise exception 'Storage allowed deleting an attachment referenced by an active branch'; end if;
  select count(*) into v_count from storage.objects where name = (select path from thread_lifecycle_context where key = 'draft');
  if v_count <> 1 then raise exception 'active draft could not access its own upload'; end if;
  delete from storage.objects where name = (select path from thread_lifecycle_context where key = 'draft');
  get diagnostics v_deleted = row_count;
  if v_deleted <> 1 then raise exception 'unreferenced upload in an active draft could not be deleted'; end if;
  perform set_config('request.jwt.claim.sub', gen_random_uuid()::text, true);
  select count(*) into v_count from storage.objects where name = (select path from thread_lifecycle_context where key = 'retained');
  if v_count <> 0 then raise exception 'another user could read a private attachment'; end if;
  delete from storage.objects where name = (select path from thread_lifecycle_context where key = 'retained');
  get diagnostics v_deleted = row_count;
  if v_deleted <> 0 then raise exception 'another user could delete a private attachment'; end if;
end;
$$;
reset role;

do $$
declare v_context record; v_claim record;
begin
  select * into v_context from thread_lifecycle_context where key = 'retained';
  perform set_config('request.jwt.claim.sub', v_context.user_id::text, true);
  perform public.delete_thread(v_context.thread_id);
  update public.threads set deleted_at = now() - interval '31 seconds' where id = v_context.thread_id;
  update public.thread_cleanup_jobs set available_at = now() - interval '31 seconds' where thread_id = v_context.thread_id and status = 'pending';
  select * into v_claim from public.claim_thread_cleanup_jobs(5, 60) where thread_id = v_context.thread_id;
  if not (v_context.path = any(v_claim.paths)) then raise exception 'last branch cleanup omitted its shared attachment'; end if;
  update thread_lifecycle_context set job_id = v_claim.job_id, claim_token = v_claim.claim_token where key = 'retained';
end;
$$;

set local role authenticated;
select set_config('request.jwt.claim.sub', (select user_id::text from thread_lifecycle_context where key = 'retained'), true);
do $$
declare v_context record; v_count integer; v_deleted integer;
begin
  select * into v_context from thread_lifecycle_context where key = 'retained';
  select count(*) into v_count from storage.objects where name = v_context.path;
  if v_count <> 1 then raise exception 'Storage could not read a leased cleanup path'; end if;
  delete from storage.objects where name = v_context.path;
  get diagnostics v_deleted = row_count;
  if v_deleted <> 1 then raise exception 'Storage denied deleting a leased unreferenced path'; end if;
  if not public.finish_thread_cleanup_job(v_context.job_id, v_context.claim_token) then raise exception 'authenticated cleanup finish rejected the current claim'; end if;
  select count(*) into v_count from public.threads where id = v_context.thread_id;
  if v_count <> 0 then raise exception 'finished cleanup did not hard-delete the tombstone'; end if;
end;
$$;
reset role;

-- A trigger failure after the branch thread is inserted must roll back the
-- thread and any already-copied prefix rows in the same RPC transaction.
create or replace function public.test_fail_branch_copy() returns trigger
language plpgsql set search_path = pg_catalog, public as $$
begin
  if new.content = 'force branch failure' and new.id <> '00000000-0000-4000-8000-000000000099'::uuid then
    raise exception 'forced branch copy failure';
  end if;
  return new;
end;
$$;
create trigger test_fail_branch_copy before insert on public.messages
for each row execute function public.test_fail_branch_copy();

do $$
declare v_user_id uuid := gen_random_uuid(); v_thread_id uuid := gen_random_uuid(); v_anchor uuid := gen_random_uuid(); v_before integer; v_after integer;
begin
  insert into auth.users (id, aud, role, email, encrypted_password, email_confirmed_at, created_at, updated_at)
  values (v_user_id, 'authenticated', 'authenticated', 'thread-atomic-' || v_user_id || '@example.test', '', now(), now(), now());
  perform set_config('request.jwt.claim.sub', v_user_id::text, true);
  insert into public.threads (id, user_id, title, model) values (v_thread_id, v_user_id, 'Atomic test', 'test-model');
  insert into public.messages (thread_id, user_id, role, content) values (v_thread_id, v_user_id, 'user', 'copied before failure') returning id into v_anchor;
  insert into public.messages (id, thread_id, user_id, role, content, created_at)
  values ('00000000-0000-4000-8000-000000000099', v_thread_id, v_user_id, 'assistant', 'force branch failure', now() + interval '1 second');
  select count(*) into v_before from public.threads;
  begin
    perform public.branch_thread(v_thread_id, (select id from public.messages where thread_id = v_thread_id and content = 'force branch failure'));
    raise exception 'branch copy unexpectedly survived trigger failure';
  exception when others then
    if sqlerrm = 'branch copy unexpectedly survived trigger failure' then raise; end if;
  end;
  select count(*) into v_after from public.threads;
  if v_after <> v_before then raise exception 'failed branch left a partial thread'; end if;
  if (select count(*) from public.messages m join public.threads t on t.id = m.thread_id where t.user_id = v_user_id and m.thread_id <> v_thread_id) <> 0 then
    raise exception 'failed branch left copied messages';
  end if;
end;
$$;

rollback;
