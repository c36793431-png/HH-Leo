-- APPLIED 2026-09-04 17:24Z by marcus. All gates passed, 29 rows verified (8 existing + 21
-- new); confirmed present in schema_migrations. This header previously read "NOT APPLIED --
-- do not run against prod" from when the migration was written but not yet executed; corrected
-- here (marcus, thread leo-provider-panel-package-labels-2026-09-04) so it doesn't mislead a
-- future reader into thinking this was never run.
-- Thread leo-london-backfill-2026-09-04. Spec is Fable's, relayed by marcus (m36633, m36648,
-- m36651): "2d is a MIGRATION, not a script" -- feed_subscriptions.license_id does not exist
-- yet, and 21 admin-direct-grant calls to assignFeedTierSubscription() would be up to 42
-- autocommit transactions with no single rollback unit. This is one transaction, raw INSERTs,
-- explicit column list.
--
-- WHAT THIS DOES, IN ORDER (marcus's ordering, unchanged):
--   1. add feed_subscriptions.license_id, nullable
--   2. backfill the 8 existing rows' license_id
--   3. insert the 21 new London Base grant rows, explicit ids, RETURNING id
--   4. set license_id not null
--   5. drop the 0078 (subscriber, feed_tier) live business-key index, create its
--      (license_id, feed_tier_id) replacement -- both statements in this same transaction,
--      so there is never a window with neither index live
--   6. feed_tier_trials -- see note below, this step is a no-op today
--
-- POPULATION (coxwell's outcome authorisation, 2026-09-04 15:22Z, relayed by marcus: "yes we
-- need that to be visible because they are actively using the base london feed package"):
-- the 7 users below hold the legacy `licenses.feed_types = {london}` checkbox tick and get the
-- full LD Base package (ld-beta-56 / ld-gamma-19 / ld-delta-18) = 21 new rows. Re-derived live
-- 2026-09-04 (see tmp_migration_0081_prep_20260904.mjs output, not committed) -- identical to
-- marcus's and my two prior independent reads on this thread, no divergence:
--   741108888@qq.com, abizokium@gmail.com, bwalyadavid099@gmail.com, giang2000ln@gmail.com,
--   jorgbuteijn@gmail.com, mujunik824@gmail.com, rasoolx55@gmail.com
-- Every (user_id, license_id) pair below is hardcoded to these seven identities, not
-- recomputed from a live query at execution time -- coxwell's authorisation was for these
-- named seven specifically. The DO block preflight after this header re-runs the population
-- query at execution time and raises (aborting the whole transaction) if it no longer matches
-- this exact set -- so drift between "dry-run text approved" and "migration actually run" is
-- caught, not silently papered over by a dynamic re-query.
--
-- license_id RESOLUTION FOR THE 8 EXISTING ROWS (live read 2026-09-04):
--   - G's 3 (subscriber 5201d6c0-e509-42e5-9c64-e92c971466cb, request_id 8d17cd1e-4046-44d7-
--     9c65-c27c87aa33ef): license_id = feed_tier_requests.license_id = 7e43acb8-2216-4ded-
--     bcd0-b0c060ac4c20, for all 3 rows (ld-beta-56, ld-gamma-19, ld-delta-18).
--   - abdulkareem.almansoori@gmail.com (ld-delta-18, active): 1 license total, license_id =
--     630b318d-36a4-4d02-8f09-66f1e0a54d56 (active, unexpired). Unambiguous.
--   - efm.rafi@gmail.com (2 rows: ld-delta-18, ny-fast, both active): 2 licenses on file, but
--     only one (8ed18ecc-379b-494b-afea-d2ef6e1be293) is currently status='active' AND
--     expires_at > now() -- the other (56ef59c3-...) is active-status but expired 2026-08-26.
--     license_id = 8ed18ecc for both rows.
--   - c36793431@gmail.com (2 rows: ld-beta-56, ny-normal, both lapsed): this account carries
--     TEN license rows (test/smoke licenses, see [[project_horizon_london_feed_backfill_7_clients]]
--     addendum #2 -- these are Leo's own smoke-test feed_subscriptions rows, flagged there as
--     awaiting coxwell's call, not deleted). Only one of the ten is currently status='active'
--     AND expires_at > now(): 837a85f0-0a62-438d-b789-db12a9c07dc6. license_id = 837a85f0 for
--     both rows.
--   NOTE on "the subscriber's single licence" (marcus's phrasing for the legacy 5): literally
--   true for only 1 of the 5 rows (abdulkareem). efm.rafi and c36793431 both carry multiple
--   license rows, but in both cases exactly one is active+unexpired today, so the resolution
--   is still unambiguous. None of the 8 hit the "legacy lapsed row's only licence is dead"
--   case marcus asked to be named explicitly -- there is no such case in the live data.
--   RE-COUNT (marcus's ask, re-run 2026-09-04, not trusted from v1.15): zero users hold more
--   than one ACTIVE (status='active' AND expires_at>now()) license simultaneously today --
--   confirmed by direct query, matches v1.15. The backfill UPDATE for the 5 legacy rows below
--   uses a scalar subquery on exactly this predicate, which fails loudly (raises, aborting the
--   transaction) rather than picking arbitrarily if that ever stops being true by execution day.
--
-- provider_user_id -- Fable's corrected line (m36651), NOT a literal in this file: "=
-- feed_tiers.provider_user_id of the tier row resolved by tier_key, read inside the same
-- transaction (a subselect on the tier row)." The INSERT below does exactly that via a
-- subselect against feed_tiers keyed on the literal feed_tier_id already in each row.
-- Preflight (her required gate, must return 1,0) is enforced below as a hard DO-block abort,
-- not just a comment -- read live 2026-09-04: distinct=1, null=0, value=94529d89-ae75-4df5-
-- a15f-1f8a004509d1, matching all 8 existing rows' own provider_user_id column already.
--
-- DISCREPANCY, flagged rather than silently resolved: the row spec (m36633) lists
-- "region/region_key copied from the tier row, not from the tick" as a field to set.
-- feed_subscriptions has no region or region_key column -- confirmed via
-- information_schema.columns, live read 2026-09-04 -- and none of the 6 migration steps
-- above call for adding one. Nothing is written for this line; flagging it back to
-- marcus/Fable rather than inventing a column that isn't part of the actual schema or the
-- itemised step list.
--
-- feed_tier_trials -- step 6 ("same column on feed_tier_trials") is a NO-OP: license_id
-- already exists there, not null, references licenses(id) on delete cascade, since the
-- table's original creation (0036, 2026-08-13) -- confirmed via information_schema.columns,
-- live read 2026-09-04. No ALTER needed or included.
--
-- FUTURE-ROW CAVEAT (not blocking, flagged): making license_id NOT NULL is table-wide, and
-- there are zero provider_tier_id-only rows in feed_subscriptions today, so nothing existing
-- is blocked. But a future third-party (provider_tier_id) subscription would also need a
-- license_id under this constraint, which may or may not be the intended design for
-- non-Horizon-catalogue grants -- not resolved here, out of scope for backfilling 8 house-tier
-- rows plus 21 new ones.
--
-- request_id is NULL by nature on all 21 new rows (no feed_tier_requests row backs an
-- admin/legacy backfill grant) -- so per 2e0's design (feed-subscriptions.ts) these rows are
-- NOT covered by the trial carve-out branch and compute through the license-gate branch,
-- same as the existing 5 legacy rows already do.
--
-- status='active' for all 21, including the three trial-tier licences (bwalyadavid099,
-- mujunik824, rasoolx55) -- 'trial' status names the feed_tier_trials path specifically, and
-- Base tiers (ld-beta-56/gamma-19/delta-18) are excluded from that path twice over (0038
-- CHECK constraint, TRIAL_ELIGIBLE_TIER_KEYS) -- a 'trial' status row here would name a code
-- path never taken for these tiers.
--
-- Timestamps: started_at/created_at/updated_at all now(), not backdated -- the true
-- provisioning date is unmeasured (per Fable's row spec) and belongs in a future
-- feed_provisioning_events channel='legacy' row, not here. lapsed_at NULL. No expiry column
-- exists on feed_subscriptions -- a licence expiring 2026-09-06 will read 'lapsed' via
-- EFFECTIVE_STATUS_SQL's license-gate branch on 2026-09-07 by design, not a defect in this
-- migration.
--
-- GATE (marcus's, unchanged): after this migration, re-running EFFECTIVE_STATUS_SQL over all
-- 29 rows (8 existing + 21 new) must show the 8 existing unchanged and all 21 new reading
-- 'active', nothing else. This is a post-commit read-side check (EFFECTIVE_STATUS_SQL is
-- unmodified by this migration and was already validated for exactly these 7 users' license
-- coverage in the 2026-09-04 15:17Z dry-run, m36621) -- not something this transaction can
-- assert on its own, since it depends on code outside the DB. If that read disagrees after
-- this commits, the rollback below is what reverses it.
--
-- ROLLBACK (ready before this transaction runs, not composed after): a DELETE by the 21
-- explicit ids this INSERT uses, plus reverting the two backfill UPDATEs and the index swap.
-- Full standalone script: db/migrations/0081_rollback.sql (companion file, not applied by
-- this migration, not run automatically).

begin;

-- Step 1: add the column, nullable.
alter table feed_subscriptions
  add column if not exists license_id uuid references licenses(id) on delete cascade;

-- Preflight A: feed_tiers.provider_user_id must be a single non-null value across the three
-- LD Base tier keys, or this migration must not run at all (Fable's explicit gate, m36651).
do $$
declare
  distinct_count integer;
  null_count integer;
begin
  select count(distinct provider_user_id), count(*) filter (where provider_user_id is null)
  into distinct_count, null_count
  from feed_tiers
  where tier_key in ('ld-beta-56', 'ld-gamma-19', 'ld-delta-18');

  if distinct_count != 1 or null_count != 0 then
    raise exception
      'feed_tiers provider_user_id preflight failed: distinct=% null=% (expected 1/0)',
      distinct_count, null_count;
  end if;
end $$;

-- Preflight B: the 7-user London Base population must exactly match the identities this
-- migration's literal INSERT values were built from -- both the count and the specific
-- (user_id, license_id) pairs. Aborts the whole transaction on any drift since the dry-run.
do $$
declare
  total_count integer;
  match_count integer;
begin
  select count(*) into total_count
  from licenses l
  join users u on u.id = l.user_id
  where l.status = 'active' and l.expires_at > now() and array_length(l.feed_types, 1) > 0;

  select count(*) into match_count
  from licenses l
  join users u on u.id = l.user_id
  where l.status = 'active' and l.expires_at > now() and array_length(l.feed_types, 1) > 0
    and (u.id, l.id) in (
      ('9239faa5-88a0-4789-9774-b0c161823b29'::uuid, 'c0e8b76c-3b3d-433d-a47c-b7ba4f87c45b'::uuid),
      ('a66d928c-6830-4cb3-80af-06cfca4ad3b6'::uuid, '6c3f0587-b3b3-4a58-909f-05c507d975e9'::uuid),
      ('5182a8be-96ab-4ad7-8b3c-ff2603e8f784'::uuid, '973abad0-bc81-4c8e-87cf-9a30c1287385'::uuid),
      ('a830b5f8-a358-4203-971d-281fd65784b9'::uuid, '176ca960-de6a-4dac-b17b-693448a526ad'::uuid),
      ('122221aa-789d-4830-8726-2060147d9206'::uuid, '5b50698e-98f1-4ca3-b607-e91ae2183028'::uuid),
      ('ce3d2cce-28dc-4e4c-bb8e-889c9a6a29db'::uuid, '692523d5-207d-4ad5-8310-2702035d29c2'::uuid),
      ('5e3fa8fd-ebac-4516-a68a-9d8101644786'::uuid, '6865647f-735f-4db6-b3da-5f233e341aa0'::uuid)
    );

  if total_count != 7 or match_count != 7 then
    raise exception
      'London-base population drift since dry-run: total=% match=% (expected 7/7)',
      total_count, match_count;
  end if;
end $$;

-- Step 2a: backfill G's 3 rows via their backing feed_tier_requests row (deterministic --
-- request_id is a foreign key to exactly one request).
update feed_subscriptions fs
set license_id = ftr.license_id, updated_at = now()
from feed_tier_requests ftr
where fs.request_id = ftr.id
  and fs.license_id is null;

-- Step 2b: backfill the 5 legacy rows via the subscriber's currently active+unexpired
-- licence. Scalar subquery, not UPDATE...FROM: if a subscriber ever has more than one
-- matching licence, Postgres raises "more than one row returned by a subquery used as an
-- expression" here and the whole transaction aborts, rather than silently picking one --
-- this is the live enforcement of the "re-count zero users with two active licences" check.
update feed_subscriptions fs
set license_id = (
    select l.id
    from licenses l
    where l.user_id = fs.subscriber_user_id
      and l.status = 'active'
      and l.expires_at > now()
  ),
  updated_at = now()
where fs.request_id is null
  and fs.license_id is null;

-- Guard: every existing row must now have a license_id. Fails close to the cause, before the
-- 21-row insert runs, rather than surfacing only at the later NOT NULL statement.
do $$
declare
  unresolved integer;
begin
  select count(*) into unresolved from feed_subscriptions where license_id is null;
  if unresolved != 0 then
    raise exception
      'license_id backfill left % existing row(s) unresolved', unresolved;
  end if;
end $$;

-- Step 3: insert the 21 new London Base grant rows. Explicit ids (not gen_random_uuid()) so
-- the rollback DELETE list can be written out before this transaction runs, not captured
-- after the fact. provider_user_id is a subselect on feed_tiers, read inside this same
-- transaction, per Fable's corrected line -- not a literal.
insert into feed_subscriptions
  (id, provider_user_id, subscriber_user_id, license_id, feed_tier_id, provider_tier_id,
   status, started_at, lapsed_at, created_at, updated_at)
select
  v.id,
  (select ft.provider_user_id from feed_tiers ft where ft.id = v.feed_tier_id),
  v.subscriber_user_id,
  v.license_id,
  v.feed_tier_id,
  null,
  'active',
  now(),
  null,
  now(),
  now()
from (values
  ('6b289973-d884-496a-af5c-409948e7ff34'::uuid, '9239faa5-88a0-4789-9774-b0c161823b29'::uuid, 'c0e8b76c-3b3d-433d-a47c-b7ba4f87c45b'::uuid, '21842a66-62be-46e6-a0b1-c38ff78a0da5'::uuid), -- 741108888@qq.com / ld-beta-56
  ('66ff6d2a-0898-4fab-8b0f-b79cacb5b4bc'::uuid, '9239faa5-88a0-4789-9774-b0c161823b29'::uuid, 'c0e8b76c-3b3d-433d-a47c-b7ba4f87c45b'::uuid, '19cb2c39-8446-4b91-937f-16da2250770d'::uuid), -- 741108888@qq.com / ld-gamma-19
  ('26d6e55e-445c-4d1d-87cb-cf73685744e7'::uuid, '9239faa5-88a0-4789-9774-b0c161823b29'::uuid, 'c0e8b76c-3b3d-433d-a47c-b7ba4f87c45b'::uuid, 'a8538ab6-0057-44a8-80c2-6877980c85e6'::uuid), -- 741108888@qq.com / ld-delta-18
  ('ac5f6031-d51f-4f3d-b46c-10df3f133fd0'::uuid, 'a66d928c-6830-4cb3-80af-06cfca4ad3b6'::uuid, '6c3f0587-b3b3-4a58-909f-05c507d975e9'::uuid, '21842a66-62be-46e6-a0b1-c38ff78a0da5'::uuid), -- abizokium@gmail.com / ld-beta-56
  ('2230a0d5-909e-47fd-b721-161de60bc678'::uuid, 'a66d928c-6830-4cb3-80af-06cfca4ad3b6'::uuid, '6c3f0587-b3b3-4a58-909f-05c507d975e9'::uuid, '19cb2c39-8446-4b91-937f-16da2250770d'::uuid), -- abizokium@gmail.com / ld-gamma-19
  ('75efdca4-48e4-4612-948b-ddb6d14d1726'::uuid, 'a66d928c-6830-4cb3-80af-06cfca4ad3b6'::uuid, '6c3f0587-b3b3-4a58-909f-05c507d975e9'::uuid, 'a8538ab6-0057-44a8-80c2-6877980c85e6'::uuid), -- abizokium@gmail.com / ld-delta-18
  ('6ee69a58-fb85-4572-901a-3d2ab5ad8586'::uuid, '5182a8be-96ab-4ad7-8b3c-ff2603e8f784'::uuid, '973abad0-bc81-4c8e-87cf-9a30c1287385'::uuid, '21842a66-62be-46e6-a0b1-c38ff78a0da5'::uuid), -- bwalyadavid099@gmail.com / ld-beta-56
  ('224c74f0-7cec-4338-874d-9fb219c20c70'::uuid, '5182a8be-96ab-4ad7-8b3c-ff2603e8f784'::uuid, '973abad0-bc81-4c8e-87cf-9a30c1287385'::uuid, '19cb2c39-8446-4b91-937f-16da2250770d'::uuid), -- bwalyadavid099@gmail.com / ld-gamma-19
  ('610fb605-ad42-4f69-b9ad-18cc9d499ee2'::uuid, '5182a8be-96ab-4ad7-8b3c-ff2603e8f784'::uuid, '973abad0-bc81-4c8e-87cf-9a30c1287385'::uuid, 'a8538ab6-0057-44a8-80c2-6877980c85e6'::uuid), -- bwalyadavid099@gmail.com / ld-delta-18
  ('4a0a7fb8-0ac2-49f4-b7a8-4007a7c92500'::uuid, 'a830b5f8-a358-4203-971d-281fd65784b9'::uuid, '176ca960-de6a-4dac-b17b-693448a526ad'::uuid, '21842a66-62be-46e6-a0b1-c38ff78a0da5'::uuid), -- giang2000ln@gmail.com / ld-beta-56
  ('82147257-d90b-4ed9-a12e-68adeaf0b2d4'::uuid, 'a830b5f8-a358-4203-971d-281fd65784b9'::uuid, '176ca960-de6a-4dac-b17b-693448a526ad'::uuid, '19cb2c39-8446-4b91-937f-16da2250770d'::uuid), -- giang2000ln@gmail.com / ld-gamma-19
  ('00f9e32c-70e8-46f6-a74c-43317edf62c5'::uuid, 'a830b5f8-a358-4203-971d-281fd65784b9'::uuid, '176ca960-de6a-4dac-b17b-693448a526ad'::uuid, 'a8538ab6-0057-44a8-80c2-6877980c85e6'::uuid), -- giang2000ln@gmail.com / ld-delta-18
  ('a909d7b1-e9ed-47ab-81f9-b84f55345b93'::uuid, '122221aa-789d-4830-8726-2060147d9206'::uuid, '5b50698e-98f1-4ca3-b607-e91ae2183028'::uuid, '21842a66-62be-46e6-a0b1-c38ff78a0da5'::uuid), -- jorgbuteijn@gmail.com / ld-beta-56
  ('e4072a70-ebcb-4121-9f38-7bd24bc5930c'::uuid, '122221aa-789d-4830-8726-2060147d9206'::uuid, '5b50698e-98f1-4ca3-b607-e91ae2183028'::uuid, '19cb2c39-8446-4b91-937f-16da2250770d'::uuid), -- jorgbuteijn@gmail.com / ld-gamma-19
  ('43b24734-e77f-40be-afe0-a2a630d4182d'::uuid, '122221aa-789d-4830-8726-2060147d9206'::uuid, '5b50698e-98f1-4ca3-b607-e91ae2183028'::uuid, 'a8538ab6-0057-44a8-80c2-6877980c85e6'::uuid), -- jorgbuteijn@gmail.com / ld-delta-18
  ('b45e07dc-1149-4e0d-9ccd-f82cc6fc8bb3'::uuid, 'ce3d2cce-28dc-4e4c-bb8e-889c9a6a29db'::uuid, '692523d5-207d-4ad5-8310-2702035d29c2'::uuid, '21842a66-62be-46e6-a0b1-c38ff78a0da5'::uuid), -- mujunik824@gmail.com / ld-beta-56
  ('960b5641-c036-4f79-ada0-020f9eb7e5ac'::uuid, 'ce3d2cce-28dc-4e4c-bb8e-889c9a6a29db'::uuid, '692523d5-207d-4ad5-8310-2702035d29c2'::uuid, '19cb2c39-8446-4b91-937f-16da2250770d'::uuid), -- mujunik824@gmail.com / ld-gamma-19
  ('0b358beb-d4cd-4034-a805-7a23f68090d5'::uuid, 'ce3d2cce-28dc-4e4c-bb8e-889c9a6a29db'::uuid, '692523d5-207d-4ad5-8310-2702035d29c2'::uuid, 'a8538ab6-0057-44a8-80c2-6877980c85e6'::uuid), -- mujunik824@gmail.com / ld-delta-18
  ('2e7ad400-9c26-440c-af09-44db1aa8d254'::uuid, '5e3fa8fd-ebac-4516-a68a-9d8101644786'::uuid, '6865647f-735f-4db6-b3da-5f233e341aa0'::uuid, '21842a66-62be-46e6-a0b1-c38ff78a0da5'::uuid), -- rasoolx55@gmail.com / ld-beta-56
  ('a453d4c0-fcb0-4643-a244-ad6e14273164'::uuid, '5e3fa8fd-ebac-4516-a68a-9d8101644786'::uuid, '6865647f-735f-4db6-b3da-5f233e341aa0'::uuid, '19cb2c39-8446-4b91-937f-16da2250770d'::uuid), -- rasoolx55@gmail.com / ld-gamma-19
  ('1161625a-72bb-4472-9282-16062f0cad13'::uuid, '5e3fa8fd-ebac-4516-a68a-9d8101644786'::uuid, '6865647f-735f-4db6-b3da-5f233e341aa0'::uuid, 'a8538ab6-0057-44a8-80c2-6877980c85e6'::uuid) -- rasoolx55@gmail.com / ld-delta-18
) as v(id, subscriber_user_id, license_id, feed_tier_id)
returning id, subscriber_user_id, feed_tier_id, provider_user_id;

-- Step 4: now that every row (8 existing + 21 new) carries a license_id, enforce it.
alter table feed_subscriptions
  alter column license_id set not null;

-- Step 5: swap the business-key live index from (subscriber, tier) to (license, tier) in the
-- same transaction as the drop -- no window with neither index in place. The provider_tier_id
-- twin from 0078 (feed_subscriptions_subscriber_provider_tier_live_uidx) is untouched: no
-- current provider_tier_id rows exist and license_id's meaning (a Horizon-issued licence)
-- doesn't apply to third-party catalogue grants the same way.
drop index if exists feed_subscriptions_subscriber_feed_tier_live_uidx;

create unique index if not exists feed_subscriptions_license_feed_tier_live_uidx
  on feed_subscriptions (license_id, feed_tier_id)
  where feed_tier_id is not null and status in ('trial', 'active');

-- Step 6: feed_tier_trials already has license_id (not null, since 0036) -- no ALTER needed,
-- see header note. Nothing executed for this step.

-- Post-migration read for manual review before commit is trusted (not an automated gate --
-- EFFECTIVE_STATUS_SQL lives in application code, not SQL, so it can't be asserted here).
select id, subscriber_user_id, license_id, feed_tier_id, status, request_id
from feed_subscriptions
order by started_at;

insert into schema_migrations (version, name) values
  ('0081', '0081_feed_subscriptions_license_id.sql')
on conflict (version) do nothing;

commit;
