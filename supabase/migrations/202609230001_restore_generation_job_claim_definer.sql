-- The September 14 migration recreated this RPC as security invoker, but
-- authenticated clients intentionally have no direct UPDATE privilege on
-- generation_jobs. The function itself verifies auth.uid() and thread
-- ownership before claiming a job.
alter function public.claim_pending_generation_job(uuid, uuid, integer)
  security definer;

-- Keep the definer function's name resolution fixed and its entry point
-- available only to authenticated callers.
alter function public.claim_pending_generation_job(uuid, uuid, integer)
  set search_path = pg_catalog, public, pg_temp;

revoke all on function public.claim_pending_generation_job(uuid, uuid, integer)
  from public, anon;
grant execute on function public.claim_pending_generation_job(uuid, uuid, integer)
  to authenticated, service_role;
