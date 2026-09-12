-- Companion to 0086_marketplace_recut.sql. NOT applied automatically, not run as part of
-- building or reviewing it -- written ahead of execution so it exists before the transaction
-- runs (same discipline as 0081_rollback.sql / 0082_rollback.sql). Thread
-- kai-marketplace-feed-product-2026-09-12.
--
-- Reverses 0086 in the opposite order. If 0086 failed mid-transaction (any DO block raised),
-- Postgres already rolled it back and none of this is needed; this is only for a 0086 that
-- fully COMMITted and is later judged wrong.
--
-- What it cannot restore, stated up front:
--   - A composite FK feed_subscriptions -> licenses(id, user_id), if 0086's section 4 dropped
--     one. None is defined in migrations 0001-0084, so there is no definition to recreate; if
--     the 0086 apply log shows "dropped composite FK <name>", recreate it by hand from that
--     name's definition before running this.
--   - NOT NULL on feed_subscriptions.license_id and server_registrations.license_id is
--     re-declared below. If phase 2 code has already written rows with NULL license_id, those
--     two statements fail and the whole rollback aborts -- by design, loud, since the data
--     shape has moved on and a blind rollback would be wrong.
--   - Rows the new code wrote into access_requests / feed_tier_request_details /
--     software_request_details / feed_allowlist_records after apply are dropped with their
--     tables. feed_tier_requests was never modified by 0086, so the pre-0086 request history
--     is intact.

begin;

-- 5. allowlist of record
drop table if exists feed_allowlist_records;

-- 4. feed_subscriptions
drop index if exists feed_subscriptions_server_feed_tier_live_uidx;

alter table feed_subscriptions
  alter column license_id set not null;

alter table feed_subscriptions
  drop column if exists ends_at;

alter table feed_subscriptions
  drop column if exists server_registration_id;

-- 3. access_request_id references access_requests, so it goes before that table drops.
--    request_id (0078) was never touched by 0086 and is left alone.
alter table feed_subscriptions
  drop column if exists access_request_id;

-- 3 + 2. requests (detail tables first, they reference the envelope)
drop table if exists software_request_details;
drop table if exists feed_tier_request_details;
drop table if exists access_requests;

-- 1. server_registrations
drop index if exists server_registrations_user_idx;

alter table server_registrations
  alter column license_id set not null;

alter table server_registrations
  drop column if exists user_id;

delete from schema_migrations where version = '0086';

commit;
