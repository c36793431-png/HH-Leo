-- PREPARED, NOT APPLIED. Thread leo-region-vs-tier-subscription-key-collision-2026-09-03
-- (marcus, amending m35703: prepare only, do not run against prod). coxwell has not yet
-- ruled on the paired app-code change (feed-subscriptions-tier-key branch); do not apply
-- this migration before that code is live, or the old region-keyed upsert in
-- assignFeedTierSubscription will start throwing a unique-violation on every second tier
-- granted in the same region instead of silently overwriting the first (marginally better,
-- still wrong -- the code fix has to land first or together with this).
--
-- Locks in per-TIER uniqueness for feed_subscriptions, replacing an app-level
-- one-row-per-region assumption that was never actually a DB constraint (0071 added no
-- unique index on this table at all). The London Base package is three London tiers
-- (ld-beta-56, ld-gamma-19, ld-delta-18) sold as one unit -- a subscriber can legitimately
-- hold three simultaneous rows in the same region_key, so region can never be the grain.
-- Verified live 2026-09-03 (read-only check, prod): zero existing (subscriber_user_id,
-- feed_tier_id) or (subscriber_user_id, provider_tier_id) duplicates across all 5 rows in
-- the table today, so this constraint does not conflict with current data and needs no
-- pre-migration cleanup pass. Table is tiny (5 rows) -- plain CREATE UNIQUE INDEX is fine,
-- no CONCURRENTLY/lock-avoidance needed.
--
-- Two partial indexes, matching the existing feed_subscriptions_one_tier_ref check
-- constraint's either/or shape (exactly one of feed_tier_id / provider_tier_id is ever
-- set): a subscriber can hold at most one row per Horizon-catalogue tier, and separately
-- at most one row per third-party provider_tiers package.

create unique index if not exists feed_subscriptions_subscriber_feed_tier_uidx
  on feed_subscriptions (subscriber_user_id, feed_tier_id)
  where feed_tier_id is not null;

create unique index if not exists feed_subscriptions_subscriber_provider_tier_uidx
  on feed_subscriptions (subscriber_user_id, provider_tier_id)
  where provider_tier_id is not null;

-- Verification: both counts should be 0 before this migration is ever applied for real.
-- A non-zero result here means new duplicate rows appeared after the 2026-09-03 read-only
-- check and must be resolved (merge or lapse the extras) before this migration can run.
select
  (select count(*) from (
    select subscriber_user_id, feed_tier_id from feed_subscriptions
    where feed_tier_id is not null
    group by subscriber_user_id, feed_tier_id having count(*) > 1
  ) d1) as feed_tier_duplicate_groups,
  (select count(*) from (
    select subscriber_user_id, provider_tier_id from feed_subscriptions
    where provider_tier_id is not null
    group by subscriber_user_id, provider_tier_id having count(*) > 1
  ) d2) as provider_tier_duplicate_groups;

insert into schema_migrations (version, name) values
  ('0078', '0078_feed_subscriptions_tier_key_unique.sql')
on conflict (version) do nothing;
