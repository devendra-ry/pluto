-- Assistant replies now store their source message in reply_to_message_id.
-- The hardened column grant predates that field, so authenticated chat
-- requests cannot persist a generated reply without this grant.
grant insert (reply_to_message_id) on table public.messages to authenticated;
