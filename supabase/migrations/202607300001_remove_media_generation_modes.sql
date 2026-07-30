delete from public.generation_jobs
where mode not in ('chat', 'search');

alter table public.generation_jobs
  drop constraint if exists generation_jobs_mode_check;

alter table public.generation_jobs
  add constraint generation_jobs_mode_check
  check (mode in ('chat', 'search'));
