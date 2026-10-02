-- Transactional regression for claim fencing. Run against a migrated local
-- Supabase database with: psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f this-file
-- All fixture rows and claim changes are rolled back at the end.
begin;

do $$
declare
  v_user_id uuid := gen_random_uuid();
  v_thread_id uuid := gen_random_uuid();
  v_complete_message_id uuid := gen_random_uuid();
  v_persist_message_id uuid := gen_random_uuid();
  v_deleted_message_id uuid := gen_random_uuid();
  v_complete_job_id uuid := gen_random_uuid();
  v_persist_job_id uuid := gen_random_uuid();
  v_deleted_job_id uuid := gen_random_uuid();
  v_old_token uuid;
  v_current_token uuid;
  v_reply_id uuid;
begin
  insert into auth.users (
    id, aud, role, email, encrypted_password, email_confirmed_at, created_at, updated_at
  ) values (
    v_user_id,
    'authenticated',
    'authenticated',
    'claim-fence-' || v_user_id::text || '@example.test',
    '',
    now(),
    now(),
    now()
  );

  insert into public.threads (id, user_id, title, model)
  values (v_thread_id, v_user_id, 'Claim fence test', 'test-model');

  insert into public.messages (id, thread_id, user_id, role, content, attachments)
  values
    (v_complete_message_id, v_thread_id, v_user_id, 'user', 'complete test', '[]'::jsonb),
    (v_persist_message_id, v_thread_id, v_user_id, 'user', 'persist test', '[]'::jsonb),
    (v_deleted_message_id, v_thread_id, v_user_id, 'user', 'deleted anchor test', '[]'::jsonb);

  insert into public.generation_jobs (id, thread_id, user_message_id, user_id, model_id, status)
  values
    (v_complete_job_id, v_thread_id, v_complete_message_id, v_user_id, 'test-model', 'pending'),
    (v_persist_job_id, v_thread_id, v_persist_message_id, v_user_id, 'test-model', 'pending'),
    (v_deleted_job_id, v_thread_id, v_deleted_message_id, v_user_id, 'test-model', 'pending');

  perform set_config('request.jwt.claim.sub', v_user_id::text, true);

  select claim.claim_token into v_old_token
  from public.claim_pending_generation_job(v_thread_id, v_complete_message_id, 30) claim;
  if v_old_token is null then raise exception 'initial completion claim failed'; end if;

  update public.generation_jobs
  set claim_expires_at = now() - interval '1 second'
  where id = v_complete_job_id;
  select claim.claim_token into v_current_token
  from public.claim_pending_generation_job(v_thread_id, v_complete_message_id, 30) claim;
  if v_current_token is null or v_current_token = v_old_token then
    raise exception 'reclaim did not issue a new completion token';
  end if;

  if public.complete_generation_job(v_complete_job_id, v_old_token, 'failed', 'stale') then
    raise exception 'stale completion unexpectedly changed the job';
  end if;
  if not public.complete_generation_job(v_complete_job_id, v_current_token, 'completed', null) then
    raise exception 'current completion token was rejected';
  end if;
  if exists (
    select 1 from public.generation_jobs
    where id = v_complete_job_id and (status <> 'completed' or claim_token is not null)
  ) then
    raise exception 'valid completion did not clear the claim';
  end if;

  select claim.claim_token into v_old_token
  from public.claim_pending_generation_job(v_thread_id, v_persist_message_id, 30) claim;
  update public.generation_jobs
  set claim_expires_at = now() - interval '1 second'
  where id = v_persist_job_id;
  select claim.claim_token into v_current_token
  from public.claim_pending_generation_job(v_thread_id, v_persist_message_id, 30) claim;

  begin
    perform public.persist_generation_response(
      v_persist_job_id, v_old_token, 'test-model', 'stale reply', '', null
    );
    raise exception 'stale response unexpectedly persisted';
  exception when sqlstate '40001' then
    null;
  end;
  if exists (
    select 1 from public.messages
    where reply_to_message_id = v_persist_message_id and deleted_at is null
  ) then
    raise exception 'stale response left an assistant message behind';
  end if;

  v_reply_id := public.persist_generation_response(
    v_persist_job_id, v_current_token, 'test-model', 'current reply', '', null
  );
  if v_reply_id is null or not exists (
    select 1 from public.messages
    where id = v_reply_id and reply_to_message_id = v_persist_message_id
  ) then
    raise exception 'current response was not persisted';
  end if;
  if exists (
    select 1 from public.generation_jobs
    where id = v_persist_job_id and (status <> 'completed' or claim_token is not null)
  ) then
    raise exception 'persisting the current response did not complete its job';
  end if;

  select claim.claim_token into v_current_token
  from public.claim_pending_generation_job(v_thread_id, v_deleted_message_id, 30) claim;
  update public.messages
  set deleted_at = now(), deleted_by = v_user_id
  where id = v_deleted_message_id;

  begin
    perform public.persist_generation_response(
      v_deleted_job_id, v_current_token, 'test-model', 'orphan reply', '', null
    );
    raise exception 'response for a deleted prompt unexpectedly persisted';
  exception when sqlstate '40001' then
    null;
  end;
  if exists (
    select 1 from public.messages
    where reply_to_message_id = v_deleted_message_id and deleted_at is null
  ) then
    raise exception 'deleted prompt received an assistant response';
  end if;
end;
$$;

rollback;
