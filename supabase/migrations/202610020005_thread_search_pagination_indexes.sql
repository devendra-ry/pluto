-- Support stable keyset pagination and substring title search for conversations.

create schema if not exists extensions;
create extension if not exists pg_trgm with schema extensions;

create index if not exists threads_user_updated_id_desc_idx
  on public.threads (user_id, updated_at desc, id desc);

-- pg_trgm may already be installed in public on an older project. Resolve the
-- operator class from the extension's actual schema instead of assuming where
-- a pre-existing installation placed it.
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
    'create index if not exists threads_title_trgm_idx on public.threads using gin (title %I.gin_trgm_ops)',
    pg_trgm_schema
  );
end;
$$;

analyze public.threads;
