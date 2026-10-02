-- Opt-in, rollback-only query-plan benchmark for the current database hot paths.
-- Run on a migrated local database with scripts/benchmark-database.mjs.
-- The fixture tables clone production indexes into the session-local schema, so
-- the same script can compare plans before and after a migration without
-- inserting rows or changing statistics on public tables.
begin;
set local statement_timeout = '120s';

create temporary table benchmark_threads (like public.threads including all) on commit drop;
create temporary table benchmark_messages (like public.messages including all) on commit drop;
create temporary table benchmark_thread_map (
  thread_no integer primary key,
  user_id uuid not null,
  thread_id uuid not null
) on commit drop;
create temporary table benchmark_target (
  user_id uuid not null,
  thread_id uuid not null,
  path text not null,
  needle text not null
) on commit drop;

insert into benchmark_target values (
  '10000000-0000-4000-8000-000000000001',
  '20000000-0000-4000-8000-000000000201',
  '10000000-0000-4000-8000-000000000001/20000000-0000-4000-8000-000000000201/benchmark-target.bin',
  'rare benchmark needle 9e72c4'
);

-- One 15k-message conversation plus 200 smaller conversations owned by
-- 20 users makes the benchmark sensitive to both a conversation B-tree seek
-- and the candidate trigram/JSONB GIN indexes.
insert into benchmark_thread_map (thread_no, user_id, thread_id)
select n,
       ('10000000-0000-4000-8000-' || lpad((((n - 1) / 10) + 1)::text, 12, '0'))::uuid,
       ('20000000-0000-4000-8000-' || lpad(n::text, 12, '0'))::uuid
  from generate_series(1, 200) as n;

insert into benchmark_threads (id, user_id, title, model, created_at, updated_at)
select thread_id, user_id, 'DB benchmark ' || thread_no, 'benchmark-model',
       now() - make_interval(days => thread_no), now() - make_interval(days => thread_no)
  from benchmark_thread_map;

insert into benchmark_threads (id, user_id, title, model)
select thread_id, user_id, 'DB benchmark large conversation', 'benchmark-model'
  from benchmark_target;

with source_rows as (
  select n,
         case when n <= 15000 then (select thread_id from benchmark_target)
              else (select thread_id from benchmark_thread_map where thread_no = ((n - 15001) % 200) + 1)
          end as thread_id,
         case when n <= 15000 then (select user_id from benchmark_target)
              else (select user_id from benchmark_thread_map where thread_no = ((n - 15001) % 200) + 1)
          end as user_id
    from generate_series(1, 20000) as n
)
insert into benchmark_messages (id, thread_id, user_id, role, content, attachments, deleted_at, created_at)
select ('30000000-0000-4000-8000-' || lpad(n::text, 12, '0'))::uuid,
       thread_id,
       user_id,
       case when n % 2 = 0 then 'user' else 'assistant' end,
       case when n = 14998 then 'Message containing rare benchmark needle 9e72c4'
            else repeat('ordinary benchmark message text ', 4) || n::text
        end,
       case
         when n = 14998 then jsonb_build_array(jsonb_build_object('path', (select path from benchmark_target)))
         when n % 100 = 0 then jsonb_build_array(jsonb_build_object(
           'path', user_id::text || '/' || thread_id::text || '/sparse-' || n::text || '.bin'
         ))
         else '[]'::jsonb
       end,
       case when n % 10 = 0 then now() else null end,
       now() - make_interval(secs => 20001 - n)
  from source_rows;

analyze benchmark_threads;
analyze benchmark_messages;
analyze benchmark_thread_map;
analyze benchmark_target;

-- Report fixture size/index inventory so saved plan output is interpretable.
select 'fixture rows' as benchmark, count(*) as value from benchmark_messages
union all
select 'fixture threads', count(*) from benchmark_threads
union all
select 'fixture users', count(distinct user_id) from benchmark_threads;
select 'fixture index' as benchmark, indexname as value
  from pg_indexes
 where schemaname = (select nspname from pg_namespace where oid = pg_my_temp_schema())
   and tablename = 'benchmark_messages'
 order by indexname;

-- This is the conversation search query shape: newest visible messages in one
-- conversation, with substring matching and a bounded result window.
select 'PLAN: conversation substring search';
explain (analyze, buffers, summary, costs)
select m.id, m.created_at, m.role, m.content
  from benchmark_messages m
 where m.thread_id = '20000000-0000-4000-8000-000000000201'::uuid
   and m.user_id = '10000000-0000-4000-8000-000000000001'::uuid
   and m.deleted_at is null
   and m.content ilike '%rare benchmark needle 9e72c4%'
 order by m.created_at desc, m.id desc
 limit 20;

-- A second plan checks whether the explicit non-null predicate helps the
-- planner prove the candidate content GIN index's partial-index predicate.
select 'PLAN: substring search with explicit non-null predicate';
explain (analyze, buffers, summary, costs)
select m.id, m.created_at, m.role, m.content
  from benchmark_messages m
 where m.thread_id = '20000000-0000-4000-8000-000000000201'::uuid
   and m.user_id = '10000000-0000-4000-8000-000000000001'::uuid
   and m.deleted_at is null
   and m.content is not null
   and m.content ilike '%rare benchmark needle 9e72c4%'
 order by m.created_at desc, m.id desc
 limit 20;

-- Indexed attachment-reference lookup used by migration 007's helper. The
-- owner/thread join and 30-second deletion grace match the production helper.
select 'PLAN: attachment reference via indexed JSON containment';
explain (analyze, buffers, summary, costs)
select m.id
  from benchmark_messages m
  join benchmark_threads bt on bt.id = m.thread_id
 where bt.user_id = '10000000-0000-4000-8000-000000000001'::uuid
   and (bt.deleted_at is null or bt.deleted_at + interval '30 seconds' > clock_timestamp())
   and m.attachments <> '[]'::jsonb
   and m.attachments @> '[{"path":"10000000-0000-4000-8000-000000000001/20000000-0000-4000-8000-000000000201/benchmark-target.bin"}]'::jsonb
 limit 1;

-- Legacy helper from migration 006: extract every path through
-- public.attachment_paths() for each eligible message and compare the result.
-- Keep the original predicate set; it did not filter out empty attachment
-- arrays before calling the helper.
select 'PLAN: attachment reference via migration 006 path expansion';
explain (analyze, buffers, summary, costs)
select m.id
  from benchmark_messages m
  join benchmark_threads bt on bt.id = m.thread_id
 where bt.user_id = '10000000-0000-4000-8000-000000000001'::uuid
   and (bt.deleted_at is null or bt.deleted_at + interval '30 seconds' > clock_timestamp())
   and exists (
     select 1
       from public.attachment_paths(m.attachments) ap(path)
      where ap.path = '10000000-0000-4000-8000-000000000001/20000000-0000-4000-8000-000000000201/benchmark-target.bin'
   )
 limit 1;

-- The browser proxy asks for a path within its active conversation. This plan
-- retains the exact PostgREST contains() shape, including empty arrays, to
-- verify that the attachment index covers the production query.
select 'PLAN: active-conversation attachment containment query';
explain (analyze, buffers, summary, costs)
select m.id
  from benchmark_messages m
 where m.thread_id = '20000000-0000-4000-8000-000000000201'::uuid
   and m.user_id = '10000000-0000-4000-8000-000000000001'::uuid
   and m.deleted_at is null
   and m.attachments @> '[{"path":"10000000-0000-4000-8000-000000000001/20000000-0000-4000-8000-000000000201/benchmark-target.bin"}]'::jsonb
 limit 1;

-- Recent message cursor read, matching the paged chat transcript query.
select 'PLAN: recent message cursor page';
explain (analyze, buffers, summary, costs)
select m.id, m.created_at, m.role, m.content
  from benchmark_messages m
 where m.thread_id = '20000000-0000-4000-8000-000000000201'::uuid
   and m.user_id = '10000000-0000-4000-8000-000000000001'::uuid
   and m.deleted_at is null
   and (m.created_at, m.id) < (now() - interval '5000 seconds', '30000000-0000-4000-8000-000000015000'::uuid)
 order by m.created_at desc, m.id desc
 limit 51;

rollback;
