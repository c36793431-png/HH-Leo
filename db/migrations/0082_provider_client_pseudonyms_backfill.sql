-- PREPARE ONLY. Written, not applied -- marcus takes this to coxwell for the go, then
-- marcus/FOC16/coxwell runs it in the Neon console. Do not run this against prod.
-- Thread leo-provider-panel-package-labels-2026-09-04 (marcus, Job 8, m37424/m37426):
-- 0081 (applied 2026-09-04T17:24Z) landed 29 feed_subscriptions rows, but only 6 of them
-- (4 distinct (provider,subscriber) pairs, seq 1/2/6/12) have a provider_client_pseudonyms
-- row -- listSubscribersForProvider (feed-subscriptions.ts) inner-joins on that table, so
-- the other 23 rows never render on the provider panel at all. That makes 0081 cosmetically
-- pointless in production: the seven London clients marcus told coxwell were "recorded and
-- visible" are not visible. This migration allocates the missing pseudonyms.
--
-- POPULATION (live read 2026-09-04, this session): the 23 orphaned rows collapse to exactly
-- 8 distinct (provider_user_id, subscriber_user_id) pairs -- the pseudonym is per PAIR, not
-- per row (provider_client_pseudonyms primary key), and 7 of the 8 pairs each carry 3 rows
-- (the London Base package = 3 tiers). Query: left join feed_subscriptions to
-- provider_client_pseudonyms on (provider_user_id, subscriber_user_id), where the pseudonym
-- side is null. All 23 rows share ONE provider_user_id -- answering marcus's two questions:
--   - Do the 23 span more than one provider? No. Single provider throughout:
--     94529d89-ae75-4df5-a15f-1f8a004509d1 (c36793431@gmail.com).
--   - Does any client appear twice? No subscriber appears under more than one provider
--     among these rows (checked against the full provider_client_pseudonyms table, not just
--     this batch). Multiple ROWS per pair (3 for each Base-package client) is expected and is
--     exactly what per-pair (not per-row) pseudonym assignment is for.
--
-- ANOMALY FLAGGED, NOT SILENTLY RESOLVED: one of the 8 pairs is provider_user_id =
-- subscriber_user_id = 94529d89-ae75-4df5-a15f-1f8a004509d1 -- the provider account
-- subscribing to itself (2 lapsed rows, ld-beta-56 + ny-normal, started 2026-09-03T19:08).
-- This is the same c36793431@gmail.com smoke-test account flagged in 0081's header (ten
-- license rows, not deleted, awaiting coxwell's call) and in
-- project_horizon_london_feed_backfill_7_clients addendum #2. It is one of the 23 rows Job 8
-- was scoped to, so it's included below to keep the population exact and reviewable, but it
-- is not a real client -- confirm with coxwell whether to carve it out before running. If it
-- should be dropped, delete its VALUES line below and drop preflight B's 8th tuple; nothing
-- else in this file depends on it.
--
-- NUMBERING: reuses assignPseudonymSeq's own algorithm (feed-subscriptions.ts) verbatim --
-- read-or-insert provider_pseudonym_counters, UPDATE ... RETURNING next_seq - 1 AS seq, then
-- INSERT ... ON CONFLICT DO NOTHING -- run once per pair inside a single DO block, in this
-- transaction, so it is provably the same numbering source as the app code and not a
-- hand-rolled range. Live read 2026-09-04: provider_pseudonym_counters.next_seq = 13 for this
-- provider (max existing seq = 12across the 4 untouched pairs). Preflight A aborts if that
-- baseline has drifted. The 6 existing pseudonym rows (seq 1, 2, 6, 12) are never written by
-- this migration -- only ON CONFLICT DO NOTHING inserts for the 8 new pairs, so even a
-- baseline that somehow already included one of the 8 would no-op that row rather than
-- collide or renumber it.
--
-- ORDER: chronological by first feed_subscriptions.started_at per pair -- the self-subscription
-- pair (started 2026-09-03) sorts first, then the 7 London Base pairs (all started
-- 2026-09-04T17:24:01, same instant) in the same left-to-right order 0081 used for them.
-- Expected allocation: seq 13 (self), 14=741108888@qq.com, 15=abizokium@gmail.com,
-- 16=bwalyadavid099@gmail.com, 17=giang2000ln@gmail.com, 18=jorgbuteijn@gmail.com,
-- 19=mujunik824@gmail.com, 20=rasoolx55@gmail.com.
--
-- IDEMPOTENT: safe to attempt twice, not silent on the second attempt -- preflight B checks
-- the live orphaned-pair set still matches this exact hardcoded list of 8 and aborts
-- (raises, whole transaction rolls back) on any drift, same shape as 0081's preflight B. A
-- second run after a successful first run will find 0 orphaned pairs left and fail preflight
-- B loudly rather than silently no-op or double-insert.
--
-- ROLLBACK: db/migrations/0082_rollback.sql (companion file, not applied by this migration,
-- not run automatically) -- DELETEs the 8 rows by (provider_user_id, subscriber_user_id) and
-- resets provider_pseudonym_counters.next_seq back to 13.

begin;

-- Preflight A: the counter this migration allocates from must still be at the baseline read
-- during prep, or the seq values below (implicit in allocation order, not literals) would
-- land somewhere other than 13-20.
do $$
declare
  current_next_seq integer;
begin
  select next_seq into current_next_seq
  from provider_pseudonym_counters
  where provider_user_id = '94529d89-ae75-4df5-a15f-1f8a004509d1';

  if current_next_seq is null or current_next_seq != 13 then
    raise exception
      'provider_pseudonym_counters preflight failed: next_seq=% (expected 13)', current_next_seq;
  end if;
end $$;

-- Preflight B: the orphaned-pair population must exactly match these 8 pairs -- both count
-- and identity. Aborts the whole transaction on any drift since prep (a new subscription,
-- a manually-assigned pseudonym, etc. landing between prep and execution).
do $$
declare
  orphaned_count integer;
  match_count integer;
begin
  select count(*) into orphaned_count
  from (
    select distinct s.provider_user_id, s.subscriber_user_id
    from feed_subscriptions s
    left join provider_client_pseudonyms p
      on p.provider_user_id = s.provider_user_id and p.subscriber_user_id = s.subscriber_user_id
    where p.provider_user_id is null
  ) orphaned;

  select count(*) into match_count
  from (
    select distinct s.provider_user_id, s.subscriber_user_id
    from feed_subscriptions s
    left join provider_client_pseudonyms p
      on p.provider_user_id = s.provider_user_id and p.subscriber_user_id = s.subscriber_user_id
    where p.provider_user_id is null
      and (s.provider_user_id, s.subscriber_user_id) in (
        ('94529d89-ae75-4df5-a15f-1f8a004509d1'::uuid, '94529d89-ae75-4df5-a15f-1f8a004509d1'::uuid),
        ('94529d89-ae75-4df5-a15f-1f8a004509d1'::uuid, '9239faa5-88a0-4789-9774-b0c161823b29'::uuid),
        ('94529d89-ae75-4df5-a15f-1f8a004509d1'::uuid, 'a66d928c-6830-4cb3-80af-06cfca4ad3b6'::uuid),
        ('94529d89-ae75-4df5-a15f-1f8a004509d1'::uuid, '5182a8be-96ab-4ad7-8b3c-ff2603e8f784'::uuid),
        ('94529d89-ae75-4df5-a15f-1f8a004509d1'::uuid, 'a830b5f8-a358-4203-971d-281fd65784b9'::uuid),
        ('94529d89-ae75-4df5-a15f-1f8a004509d1'::uuid, '122221aa-789d-4830-8726-2060147d9206'::uuid),
        ('94529d89-ae75-4df5-a15f-1f8a004509d1'::uuid, 'ce3d2cce-28dc-4e4c-bb8e-889c9a6a29db'::uuid),
        ('94529d89-ae75-4df5-a15f-1f8a004509d1'::uuid, '5e3fa8fd-ebac-4516-a68a-9d8101644786'::uuid)
      )
  ) matched;

  if orphaned_count != 8 or match_count != 8 then
    raise exception
      'pseudonym-backfill population drift since prep: orphaned=% match=% (expected 8/8)',
      orphaned_count, match_count;
  end if;
end $$;

-- Pre-commit count, for the after-read comparison below.
select count(*) as pseudonym_count_before
from provider_client_pseudonyms
where provider_user_id = '94529d89-ae75-4df5-a15f-1f8a004509d1';

-- Allocation: assignPseudonymSeq's exact algorithm (feed-subscriptions.ts), run once per pair
-- in chronological order, inside this transaction.
do $$
declare
  provider uuid := '94529d89-ae75-4df5-a15f-1f8a004509d1';
  subscriber uuid;
  candidate_seq integer;
  inserted_seq integer;
  subscribers uuid[] := array[
    '94529d89-ae75-4df5-a15f-1f8a004509d1'::uuid, -- self-subscription anomaly, see header
    '9239faa5-88a0-4789-9774-b0c161823b29'::uuid, -- 741108888@qq.com
    'a66d928c-6830-4cb3-80af-06cfca4ad3b6'::uuid, -- abizokium@gmail.com
    '5182a8be-96ab-4ad7-8b3c-ff2603e8f784'::uuid, -- bwalyadavid099@gmail.com
    'a830b5f8-a358-4203-971d-281fd65784b9'::uuid, -- giang2000ln@gmail.com
    '122221aa-789d-4830-8726-2060147d9206'::uuid, -- jorgbuteijn@gmail.com
    'ce3d2cce-28dc-4e4c-bb8e-889c9a6a29db'::uuid, -- mujunik824@gmail.com
    '5e3fa8fd-ebac-4516-a68a-9d8101644786'::uuid  -- rasoolx55@gmail.com
  ];
begin
  foreach subscriber in array subscribers loop
    -- Same as assignPseudonymSeq: no-op if this exact pair already has a row (defensive;
    -- preflight B already guarantees none do).
    perform seq from provider_client_pseudonyms
      where provider_user_id = provider and subscriber_user_id = subscriber;
    if found then
      continue;
    end if;

    insert into provider_pseudonym_counters (provider_user_id, next_seq)
    values (provider, 1)
    on conflict (provider_user_id) do nothing;

    update provider_pseudonym_counters
    set next_seq = next_seq + 1
    where provider_user_id = provider
    returning next_seq - 1 into candidate_seq;

    insert into provider_client_pseudonyms (provider_user_id, subscriber_user_id, seq)
    values (provider, subscriber, candidate_seq)
    on conflict (provider_user_id, subscriber_user_id) do nothing
    returning seq into inserted_seq;

    if inserted_seq is null then
      raise exception
        'lost an impossible single-writer race allocating seq for subscriber %, candidate_seq=%',
        subscriber, candidate_seq;
    end if;
  end loop;
end $$;

-- After-read, for manual review before commit is trusted.
select provider_user_id, subscriber_user_id, seq, created_at
from provider_client_pseudonyms
where provider_user_id = '94529d89-ae75-4df5-a15f-1f8a004509d1'
order by seq;

insert into schema_migrations (version, name) values
  ('0082', '0082_provider_client_pseudonyms_backfill.sql')
on conflict (version) do nothing;

commit;
