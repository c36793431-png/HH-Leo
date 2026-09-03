-- PREPARED, NOT APPLIED. Thread leo-region-vs-tier-subscription-key-collision-2026-09-03.
-- REVISED per m35715 (marcus, relaying Fable's review of this migration's first draft --
-- see below the original draft's rationale, kept for the record, is still right about the
-- GRAIN (tier, not region) but wrong about the MECHANISM). coxwell has not yet ruled; do not
-- apply before that, and only together with the paired app-code change (same branch,
-- feed-subscriptions.ts / feed-tier-requests.ts).
--
-- Original draft's rationale (grain is still correct, keeping for context): the London Base
-- package is three London tiers (ld-beta-56, ld-gamma-19, ld-delta-18) sold as one unit -- a
-- subscriber can legitimately hold three simultaneous rows in the same region_key, so region
-- can never be the grain. 0071 added no unique index on this table at all, so this was purely
-- an app-level assumption, never a DB constraint.
--
-- What changed after Fable's review (her words: "Fixing the columns without fixing the write
-- pattern leaves the same machine loaded with a different trigger"): a unique index on the
-- business key alone invites the SAME upsert-on-business-key pattern that caused the original
-- incident, just at a finer grain -- nothing stops a retried/duplicated approval from still
-- silently reactivating an unrelated request's row via that key. The fix is at the write
-- pattern: approval must upsert on the identity of the request being approved, not on the
-- tier. Three additions instead of one:
--
-- 1. request_id on feed_subscriptions (nullable -- the admin-direct-grant path has no request
--    to point at and is unaffected), unique where set. Lets approveFeedTierRequest's write
--    upsert `on conflict (request_id)`, so replaying the same request (retry, double-click) is
--    a no-op against the SAME row, never a second insert.
--
-- 2. subscription_id on feed_tier_requests, written back by approveFeedTierRequest in the
--    same transaction as the status flip to 'approved'. Turns "approved with no backing grant"
--    (the actual 2026-09-03 incident -- HH1's ld-beta-56/ld-gamma-19 requests read approved
--    after their feed_subscriptions rows were silently overwritten by later approvals in the
--    same region) from something only a human happening to look catches into a query
--    (`select ... from feed_tier_requests where status = 'approved' and subscription_id is
--    null`) and eventually a CI assertion.
--
-- 3. The business-key partial unique index, scoped to WHERE status IN ('trial','active') --
--    not unconditional like the original draft below, which would have permanently blocked
--    re-granting a tier after it lapses (a lapsed row would still count against an
--    unconditional unique key). A second concurrent grant landing on the same LIVE tier via a
--    different request_id now fails loudly (unique_violation, surfaced by
--    upsertFeedSubscriptionForRequest as DuplicateTierGrantError) instead of silently merging
--    into one row -- approving the same tier twice is an error a human should see.
--
-- Verified live 2026-09-03 (read-only check, prod): zero existing (subscriber_user_id,
-- feed_tier_id) or (subscriber_user_id, provider_tier_id) duplicates among live-status rows
-- across all 5 rows in the table today, so this constraint does not conflict with current
-- data and needs no pre-migration cleanup pass. Table is tiny (5 rows) -- plain ALTER/CREATE
-- INDEX is fine, no CONCURRENTLY/lock-avoidance needed.

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

-- Verification: both counts should be 0 before this migration is ever applied for real.
-- A non-zero result here means new duplicate live rows appeared after the 2026-09-03
-- read-only check and must be resolved (merge or lapse the extras) before this migration
-- can run.
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
