-- APPLIED to production 2026-09-03 ~23:05 local, in the Neon console
-- (neon-purple-apple / main / neondb), run by marcus with coxwell watching over
-- RustDesk. Thread leo-0078-execution-sql-and-expected-results-2026-09-03.
--
-- NOTE (leo, committing after the fact): this file's SQL body is unchanged from
-- commit f9f4bb9 on the still-unpushed branch prep/feed-subscriptions-tier-key-2026-09-03,
-- which was explicitly marked "PREPARED, NOT APPLIED -- gated on coxwell's ruling" at the
-- time it was written. It was run before that ruling landed. Marcus reports he wrapped it in
-- BEGIN/COMMIT (Fable's instruction, so a mid-script failure rolls back cleanly) and added his
-- own header comment recording pre-flight results and an "amend-the-predicates" rule; I do not
-- have his literal comment text, so this header is mine, not a verbatim reproduction of his --
-- ask him if the exact wording matters. The executable SQL below is unchanged and structurally
-- verified against his reported statement-by-statement result (2 ALTER, 3 CREATE INDEX, 1
-- SELECT returning feed_tier_duplicate_groups=0 / provider_tier_duplicate_groups=0, 1 INSERT).
--
-- Original rationale, kept for the record (grain is tier, not region; see below for the write-
-- pattern fix Fable required before this could ship):
--
-- The London Base package is three London tiers (ld-beta-56, ld-gamma-19, ld-delta-18) sold as
-- one unit -- a subscriber can legitimately hold three simultaneous rows in the same
-- region_key, so region can never be the grain. 0071 added no unique index on this table at
-- all, so this was purely an app-level assumption, never a DB constraint.
--
-- Fable's review (her words: "Fixing the columns without fixing the write pattern leaves the
-- same machine loaded with a different trigger"): a unique index on the business key alone
-- invites the SAME upsert-on-business-key pattern that caused the original incident, just at a
-- finer grain. The fix is at the write pattern: approval must upsert on the identity of the
-- request being approved, not on the tier. Three additions:
--
-- 1. request_id on feed_subscriptions (nullable -- the admin-direct-grant path has no request
--    to point at and is unaffected), unique where set. Lets an approval write upsert
--    `on conflict (request_id)`, so replaying the same request (retry, double-click) is a
--    no-op against the SAME row, never a second insert.
--
-- 2. subscription_id on feed_tier_requests, meant to be written back by the approval path in
--    the same transaction as the status flip to 'approved'. Turns "approved with no backing
--    grant" from something only a human happening to look catches into a query.
--
-- 3. The business-key partial unique index, scoped to WHERE status IN ('trial','active') --
--    not unconditional, which would permanently block re-granting a tier after it lapses. A
--    second concurrent grant landing on the same LIVE tier via a different request_id now
--    fails loudly (unique_violation) instead of silently merging into one row.
--
-- Verified live 2026-09-03 (read-only check, prod, pre-migration): zero existing
-- (subscriber_user_id, feed_tier_id) or (subscriber_user_id, provider_tier_id) duplicates
-- among live-status rows, so this constraint did not conflict with existing data and needed no
-- pre-migration cleanup pass. Table was tiny -- plain ALTER/CREATE INDEX, no CONCURRENTLY
-- needed.
--
-- KNOWN GAP AT TIME OF APPLY: the app-code half of this change (upsertFeedSubscriptionForRequest,
-- approveFeedTierRequest's one-transaction rewrite) is still unpushed on
-- prep/feed-subscriptions-tier-key-2026-09-03 (f9f4bb9), gated on coxwell's picker-UI ruling.
-- Until that merges, the live approval path (assignFeedTierSubscription, select-then-
-- insert-or-update, no request_id awareness) does not populate request_id or subscription_id,
-- and a concurrent double-approval on the same subscriber+tier now surfaces a raw
-- unique_violation (500) instead of the prior silent duplicate -- loud failure, not yet
-- idempotent. Merging that branch is what closes the gap.

begin;

alter table feed_subscriptions
  add column if not exists request_id uuid references feed_tier_requests(id);

alter table feed_tier_requests
  add column if not exists subscription_id uuid references feed_subscriptions(id);

create unique index if not exists feed_subscriptions_request_uidx
  on feed_subscriptions (request_id)
  where request_id is not null;

-- Live-status partial uniqueness on the business key. Two separate indexes, matching the
-- existing feed_subscriptions_one_tier_ref check constraint's either/or shape.
create unique index if not exists feed_subscriptions_subscriber_feed_tier_live_uidx
  on feed_subscriptions (subscriber_user_id, feed_tier_id)
  where feed_tier_id is not null and status in ('trial', 'active');

create unique index if not exists feed_subscriptions_subscriber_provider_tier_live_uidx
  on feed_subscriptions (subscriber_user_id, provider_tier_id)
  where provider_tier_id is not null and status in ('trial', 'active');

-- Verification: both counts should be 0. Returned exactly that in production.
select
  (select count(*) from (
    select subscriber_user_id, feed_tier_id from feed_subscriptions
    where feed_tier_id is not null and status in ('trial', 'active')
    group by subscriber_user_id, feed_tier_id having count(*) > 1
  ) d1) as feed_tier_duplicate_groups,
  (select count(*) from (
    select subscriber_user_id, provider_tier_id from feed_subscriptions
    where provider_tier_id is not null and status in ('trial', 'active')
    group by subscriber_user_id, provider_tier_id having count(*) > 1
  ) d2) as provider_tier_duplicate_groups;

insert into schema_migrations (version, name) values
  ('0078', '0078_feed_subscriptions_tier_key_unique.sql')
on conflict (version) do nothing;

commit;
