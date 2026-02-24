-- Migration: Persist assistant reply performance stats on messages
-- Run this in the Supabase SQL Editor before deploying app changes.

alter table public.messages
  add column if not exists reply_stats jsonb null;

alter table public.messages
  drop constraint if exists messages_reply_stats_object_check;
alter table public.messages
  add constraint messages_reply_stats_object_check
  check (
    reply_stats is null
    or jsonb_typeof(reply_stats) = 'object'
  );
