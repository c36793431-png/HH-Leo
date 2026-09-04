-- NOT APPLIED. DO NOT RUN until the code deploy that ships alongside 0079 (approveFeedTierRequest
-- / upsertFeedSubscriptionForRequest repointed to feed_subscriptions_request_tier_uidx, all 5
-- feed_tier_requests.subscription_id read sites repointed to feed_subscriptions.request_id) is
-- live and confirmed. This is step (iii) of Fable's deploy order (m36289, thread
-- leo-package-grant-fix-2026-09-04) -- running it before the code deploy drops the index
-- 0079's ON CONFLICT target still needs, and every approval (single-tier or package) starts
-- failing loudly with "no unique or exclusion constraint matching the ON CONFLICT specification".
--
-- Fable's ruling (m36289, item 1 + section 3.3 item 3): feed_tier_requests.subscription_id is
-- DROPPED, not left null. A 1-to-N relation (one approval, N grants) cannot live in a scalar
-- column -- "first member" is a silent lie for the other N-1 rows, "null for packages" makes
-- the column mean "granted" for some requests and nothing for others, and an array would just
-- denormalise the FK that already exists the other direction. feed_subscriptions.request_id is
-- that FK, already indexed, already the only direction a 1-to-N relation can point. "Is this
-- request granted" is feed_tier_requests.status, not this column.
--
-- Reader audit (leo, 2026-09-04, thread leo-package-grant-fix-2026-09-04): grepped
-- src/ and app/ for every subscriptionId / subscription_id reference. All five write/read sites
-- are internal to src/lib/feed-tier-requests.ts (FeedTierRequestRow.subscriptionId, mapRow,
-- RequestRow, SELECT_BASE, the approval UPDATE) and are repointed/removed in the code deploy
-- this migration follows. The only other subscriptionId occurrences in the codebase
-- (feed-subscriptions.ts's ProviderSubscriberRow/SubscriberFeedTierSubscription, and
-- app/feed/dashboard/accounts/page.tsx's s.subscriptionId) are feed_subscriptions.id under an
-- unrelated field name -- confirmed by tracing their source query, not this column. No reader
-- anywhere requires feed_tier_requests.subscription_id to be non-null; dropping it is safe.
--
-- No backfill: the request_id/subscription_id columns were added same-migration in 0078
-- (2026-09-03), so every existing row already reflects the current write pattern or is null on
-- both sides; nothing needs reconciling before the drop.
--
-- Expected result per statement:
--   DROP INDEX feed_subscriptions_request_uidx -- succeeds (0079's index already covers every
--     case the old one did, and more).
--   ALTER TABLE ... DROP COLUMN subscription_id -- succeeds; no other object references it
--     (no FK, no view, no other index).
--   INSERT into schema_migrations -- 1 row, version '0080'.

begin;

drop index if exists feed_subscriptions_request_uidx;

alter table feed_tier_requests
  drop column if exists subscription_id;

insert into schema_migrations (version, name) values
  ('0080', '0080_drop_feed_tier_requests_subscription_id.sql')
on conflict (version) do nothing;

commit;
