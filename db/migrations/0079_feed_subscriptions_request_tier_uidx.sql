-- NOT APPLIED. Write only -- marcus runs this in the Neon console after review.
-- Thread leo-package-grant-fix-2026-09-04.
--
-- Fable's ruling (specs/horizon-feed-provisioning-ledger-v1.md, d108353, section 3.3 item 1
-- + section 6 step 2d0; relayed verbatim to leo over the bus, m36289): "the identity of the
-- approval is the request; the identity of a grant is (request, tier)." 0078's
-- feed_subscriptions_request_uidx -- unique on request_id alone -- assumed one request could
-- only ever back one grant row. That was true of every single-tier request, and false the
-- moment a package tier_key (ld-retail-package, ny-retail-package -- PACKAGE_TIER_KEYS,
-- feed-tier-catalogue.ts) needed N grant rows off one request_id. This migration is step (i)
-- of Fable's two-migration, code-in-between deploy order (her words):
--
--   (i)   this file -- create the new index ALONGSIDE the old one. Cannot fail: the old
--         index already guarantees at most one feed_subscriptions row per request_id, so
--         (request_id, feed_tier_id) is trivially unique today too.
--   (ii)  code deploy -- approveFeedTierRequest/upsertFeedSubscriptionForRequest repointed to
--         upsert on (request_id, feed_tier_id); feed_tier_requests.subscription_id write
--         removed, its 5 read sites in feed-tier-requests.ts repointed to
--         feed_subscriptions.request_id. Single-tier and package approvals both work in this
--         gap; nothing regresses (feed_subscriptions_request_uidx still lets each single-tier
--         request write its one row exactly as it does today).
--   (iii) 0080 -- drops feed_subscriptions_request_uidx and feed_tier_requests.subscription_id,
--         once (ii) is confirmed live. NOT this file. Do not run 0080 before the code from
--         this slice is deployed and confirmed.
--
-- Index shape is Fable's literal answer (m36289), not leo's original inference: the second
-- predicate clause (`and feed_tier_id is not null`) was missing from leo's guess. It's needed
-- because feed_subscriptions.feed_tier_id is nullable under the feed_subscriptions_one_tier_ref
-- check constraint (a row can carry provider_tier_id instead) -- a partial index on
-- (request_id, feed_tier_id) with only the request_id predicate would treat every
-- provider_tier_id-only row as feed_tier_id = NULL and, per Postgres NULL-distinctness rules,
-- that's actually fine for uniqueness (NULLs never collide) -- but Fable's answer is explicit
-- that the clause belongs regardless, so it's included as she specified.
--
-- No provider_tier_id twin (Q21a, reconfirmed m36289 item 2): a request-driven grant can only
-- ever resolve to a house feed_tiers row via getFeedTierForAssignment(tierKey) -- the
-- request path has never carried a provider_tier_id column (0034 original, 0078 only added
-- subscription_id) -- so one_tier_ref's provider_tier_id half is covered by the admin-direct-
-- grant path only, and this migration ships one index, not two.
--
-- Preflight (read-only, prod, leo, 2026-09-04 ~13:35Z): zero existing (request_id, feed_tier_id)
-- duplicate groups, zero existing request_id with more than one feed_subscriptions row --
-- the new index cannot conflict with live data. Six pending feed_tier_requests rows exist
-- (ld-ultra x2, ld-alpha-85 x1, ld-retail-package x1 -- including G's HHFT-J8WRG3-PKVZ4Q-RXW8AC
-- pending package + 2 more pending on the same licence, coxwell's to click), none has a backing
-- feed_subscriptions row yet (all pending, nothing approved) -- this migration does not touch
-- them and creates no state for any of them.
--
-- Expected result per statement:
--   CREATE UNIQUE INDEX -- succeeds silently (index did not exist).
--   INSERT into schema_migrations -- 1 row, version '0079'.

begin;

create unique index if not exists feed_subscriptions_request_tier_uidx
  on feed_subscriptions (request_id, feed_tier_id)
  where request_id is not null and feed_tier_id is not null;

insert into schema_migrations (version, name) values
  ('0079', '0079_feed_subscriptions_request_tier_uidx.sql')
on conflict (version) do nothing;

commit;
