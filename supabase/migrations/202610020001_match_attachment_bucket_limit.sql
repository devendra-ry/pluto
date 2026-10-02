-- Keep direct Storage API uploads within the same limit enforced by the app.
-- Authenticated users can reach Storage through Supabase directly, so the
-- bucket limit must not exceed the server's 20 MiB attachment cap.
update storage.buckets
set file_size_limit = 20971520
where id = 'chat-attachments'
  and file_size_limit is distinct from 20971520;

-- Attachments are written with unique names and upsert disabled. Prevent
-- authenticated clients from replacing an existing object behind the
-- server's path-keyed attachment cache.
drop policy if exists "Users can update own attachments" on storage.objects;
