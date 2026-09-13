-- Companion to 0088_tighten.sql. NOT applied automatically, not run as part of building or
-- reviewing it -- written in the same commit so it exists before the transaction runs (same
-- discipline as 0081_rollback.sql / 0086_rollback.sql). Thread kai-tighten-0087-2026-09-12.
--
-- Reverses 0088 in the opposite order. If 0088 failed mid-transaction (any DO block raised),
-- Postgres already rolled it back and none of this is needed; this is only for a 0088 that fully
-- COMMITted and is later judged wrong.
--
-- ONE VALUE MUST BE FILLED IN BEFORE RUNNING: expected_carried in step 9's guard = the 0088
-- summary row's allowlist_carried + allowlist_carried_by_word. Left NULL, the guard aborts.
--
-- What it cannot restore, stated up front:
--   - feed_tier_requests rows. The table is recreated in its 0034 shape (minus subscription_id,
--     dropped by 0080) and repopulated FROM the envelopes (access_requests where
--     legacy_feed_tier_request_id is not null, joined to feed_tier_request_details and
--     feed_tiers): id = legacy_feed_tier_request_id, user_id, license_id = the detail's server
--     row's license_id, region = feed_tiers.region_key, tier_key, status, reason, created_at,
--     actioned_by = decided_by, actioned_at = decided_at. 'approved' comes back for both former
--     'approved' and 'provisioned' -- that distinction is NOT recoverable from the envelope; the
--     carried allowlist rows (deleted below) were its only trace. A package request comes back
--     as N single-tier envelopes sharing one legacy id, which the primary key cannot hold, so the
--     repopulation keeps the FIRST member by tier_key only, with the original package tier_key
--     lost (each such id is named in a notice). Rows step 3 listed as rejected with no envelope
--     are gone; their provenance is the 0086 section 6 and 0088 step 3 notice pastes. A server
--     row whose license_id is NULL (only a licence delete under the 0088 FK does that) cannot
--     repopulate its request's NOT NULL license_id: named, abort.
--   - feed_subscriptions.request_id values: re-added nullable and backfilled as
--     access_requests.legacy_feed_tier_request_id via access_request_id (exact for every row
--     that had one, since 0088 step 2's gate proved the mapping total; NULL for new-path rows).
--   - The step-5 expiry lapses are NOT reverted: stored 'lapsed' on a row whose ends_at is past
--     is truthful either way.
--   - The 2b(a) reject and 2b(b) worded lapses are NOT reverted: dated decisions.
--   - The 2b(c) carries ARE deleted with the step-9 carries: the pre-tighten record set had no
--     legacy carries; the word stays in the ledger and in the 2b comment.
--   - The step-1 / step-4 backfills of user_id, server_registration_id and ends_at are 0086
--     columns and are left as written.
--
-- Restores exactly: the 0078 FK (request_id references feed_tier_requests(id)), the 0079 index
-- feed_subscriptions_request_tier_uidx, the 0031 single-column FK on delete cascade; drops the
-- CHECK (with its six-id exception, fable v1.71), the composite FK, the licenses unique, and
-- NOT NULL on server_registrations.user_id; deletes the '0088' ledger row. The 0081 index
-- feed_subscriptions_license_feed_tier_live_uidx is NOT recreated because 0088 no longer drops
-- it (the drop is 0089's, with its own rollback); so no duplicate-group preflight here. If 0089
-- has been applied, run 0089_rollback.sql FIRST: the preflight below refuses a '0089' ledger row.
--
-- The carried-record delete is bounded by the phase-2 deploy instant: new-path records cannot
-- predate the deploy, and a legacy row actioned in the 17:30Z-22:58Z window carries a told_at
-- inside that window. The guard requires the bounded count to equal expected_carried. The case
-- where a legacy row was actioned AFTER the instant is ACCEPTED as an abort: its told_at sits
-- above the bound, the count is short, nothing is deleted, and the remedy is a decision on the
-- thread, never a wider bound. 0088's apply gates (spec section 11 reads (1) and (2)) keep that
-- case empty.

begin;

do $$
begin
  if not exists (select 1 from schema_migrations where version = '0088') then
    raise exception 'rollback 0088: schema_migrations has no 0088 row; nothing to roll back';
  end if;
  if exists (select 1 from schema_migrations where version = '0089') then
    raise exception 'rollback 0088: schema_migrations has a 0089 row; run 0089_rollback.sql first (it restores the CHECK exception and the 0081 index this file does not touch)';
  end if;
end $$;

-- ---------------------------------------------------------------------------------------
-- 9 reverse: recreate feed_tier_requests and repopulate it; delete the carried records
-- ---------------------------------------------------------------------------------------

-- 0034 shape as of 0080 (subscription_id dropped). Same CHECKs, same two indexes.
create table if not exists feed_tier_requests (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references users(id) on delete cascade,
  license_id uuid not null references licenses(id) on delete cascade,
  region text not null check (region in ('london', 'ny', 'cme', 'tokyo')),
  tier_key text not null,
  status text not null default 'pending' check (status in ('pending', 'approved', 'rejected', 'provisioned')),
  reason text,
  created_at timestamptz not null default now(),
  actioned_at timestamptz,
  actioned_by uuid references users(id)
);

create index if not exists feed_tier_requests_user_id_idx on feed_tier_requests (user_id, created_at desc);
create index if not exists feed_tier_requests_status_idx on feed_tier_requests (status, created_at desc);

-- Guard: every legacy envelope has a detail row whose server row still carries a licence.
do $$
declare
  r record;
  envelopes integer;
  bad integer;
begin
  select count(*) into envelopes from access_requests where legacy_feed_tier_request_id is not null;
  select count(*) into bad
  from access_requests a
  left join feed_tier_request_details d on d.request_id = a.id
  left join server_registrations sr on sr.id = d.server_registration_id
  where a.legacy_feed_tier_request_id is not null
    and (d.request_id is null or sr.id is null or sr.license_id is null);
  if bad != 0 then
    for r in
      select a.id as envelope_id, a.legacy_feed_tier_request_id as legacy_id,
             d.server_registration_id, sr.license_id
      from access_requests a
      left join feed_tier_request_details d on d.request_id = a.id
      left join server_registrations sr on sr.id = d.server_registration_id
      where a.legacy_feed_tier_request_id is not null
        and (d.request_id is null or sr.id is null or sr.license_id is null)
      order by a.legacy_feed_tier_request_id, a.id
    loop
      raise notice 'rollback 0088 step 9 cannot repopulate: envelope=% legacy_id=% server_registration_id=% license_id=%',
        r.envelope_id, r.legacy_id, r.server_registration_id, r.license_id;
    end loop;
    raise exception 'rollback 0088 step 9: % of % legacy envelope(s) have no detail row, no server row, or a server row with license_id NULL (listed above)', bad, envelopes;
  end if;
  raise notice 'rollback 0088 step 9 guard ok: legacy envelopes=% repopulatable=%', envelopes, envelopes;
end $$;

-- First member by tier_key per legacy id (a package request had N envelopes). Package ids are
-- named below.
insert into feed_tier_requests
  (id, user_id, license_id, region, tier_key, status, reason, created_at, actioned_at, actioned_by)
select distinct on (a.legacy_feed_tier_request_id)
  a.legacy_feed_tier_request_id,
  a.user_id,
  sr.license_id,
  ft.region_key,
  ft.tier_key,
  a.status,
  a.reason,
  a.created_at,
  a.decided_at,
  a.decided_by
from access_requests a
join feed_tier_request_details d on d.request_id = a.id
join server_registrations sr on sr.id = d.server_registration_id
join feed_tiers ft on ft.id = d.feed_tier_id
where a.legacy_feed_tier_request_id is not null
order by a.legacy_feed_tier_request_id, ft.tier_key
on conflict (id) do nothing;

do $$
declare
  r record;
  legacy_ids integer;
  repopulated integer;
  packages integer := 0;
begin
  select count(distinct legacy_feed_tier_request_id) into legacy_ids
  from access_requests where legacy_feed_tier_request_id is not null;
  select count(*) into repopulated from feed_tier_requests;
  if repopulated != legacy_ids then
    raise exception 'rollback 0088 step 9: repopulated % feed_tier_requests row(s) but % distinct legacy id(s) have envelopes', repopulated, legacy_ids;
  end if;
  for r in
    select a.legacy_feed_tier_request_id as legacy_id, count(*) as members,
           string_agg(ft.tier_key, ',' order by ft.tier_key) as member_keys
    from access_requests a
    join feed_tier_request_details d on d.request_id = a.id
    join feed_tiers ft on ft.id = d.feed_tier_id
    where a.legacy_feed_tier_request_id is not null
    group by a.legacy_feed_tier_request_id
    having count(*) > 1
    order by a.legacy_feed_tier_request_id
  loop
    packages := packages + 1;
    raise notice 'rollback 0088 step 9 package collapsed to first member: legacy_id=% members=% member_keys=% (original package tier_key not recoverable)',
      r.legacy_id, r.members, r.member_keys;
  end loop;
  raise notice 'rollback 0088 step 9 ok: feed_tier_requests repopulated=% (of % legacy ids); package ids collapsed=%; provisioned/approved distinction not recoverable',
    repopulated, legacy_ids, packages;
end $$;

-- Delete the carried allowlist records (0088 step 9 + step 2b(c)). Bound = the phase-2 deploy
-- instant; the guard requires the bounded count to equal expected_carried (FILL IN from the 0088
-- summary row: allowlist_carried + allowlist_carried_by_word). A short count means a carry sits
-- above the bound: abort, nothing deleted, decision on the thread. The literal appears twice
-- below, each under its source comment.
do $$
declare
  expected_carried integer := null;  -- FILL IN before running
  bounded integer;
  deleted integer;
begin
  if expected_carried is null then
    raise exception 'rollback 0088 step 9: expected_carried is not filled in (allowlist_carried + allowlist_carried_by_word from the 0088 summary row)';
  end if;
  -- Vercel deployment dpl_6SggmsWv7raHRi7vHUu6k6C33rfV ready 2026-09-12T22:58:19Z, meta.githubCommitSha=3ded80d, read by leo m49262
  select count(*) into bounded from feed_allowlist_records where told_at < '2026-09-12T22:58:19Z';
  if bounded != expected_carried then
    raise exception 'rollback 0088 step 9: % allowlist record(s) with told_at below the deploy instant but the 0088 summary carried %; nothing deleted', bounded, expected_carried;
  end if;
  -- Vercel deployment dpl_6SggmsWv7raHRi7vHUu6k6C33rfV ready 2026-09-12T22:58:19Z, meta.githubCommitSha=3ded80d, read by leo m49262
  delete from feed_allowlist_records where told_at < '2026-09-12T22:58:19Z';
  get diagnostics deleted = row_count;
  raise notice 'rollback 0088 step 9 ok: carried allowlist records deleted=% (expected %)', deleted, expected_carried;
end $$;

-- ---------------------------------------------------------------------------------------
-- 8 reverse: request_id back, backfilled, with the 0078 FK and the 0079 index
-- ---------------------------------------------------------------------------------------

alter table feed_subscriptions
  add column if not exists request_id uuid references feed_tier_requests(id);

update feed_subscriptions fs
set request_id = a.legacy_feed_tier_request_id
from access_requests a
where a.id = fs.access_request_id
  and a.legacy_feed_tier_request_id is not null
  and fs.request_id is null;

create unique index if not exists feed_subscriptions_request_tier_uidx
  on feed_subscriptions (request_id, feed_tier_id)
  where request_id is not null and feed_tier_id is not null;

do $$
declare
  restored integer;
begin
  select count(*) into restored from feed_subscriptions where request_id is not null;
  raise notice 'rollback 0088 step 8 ok: feed_subscriptions.request_id restored on % row(s) (0088 step 8 notice said how many had one)', restored;
end $$;

-- ---------------------------------------------------------------------------------------
-- 7 reverse: composite FK -> 0031 FK, drop the licenses unique, user_id nullable
-- ---------------------------------------------------------------------------------------

alter table server_registrations
  drop constraint if exists server_registrations_license_owner_fkey;

-- 0031 created its FK unnamed; server_registrations_license_id_fkey is the default name and is
-- given explicitly here so the notice can state it.
alter table server_registrations
  add constraint server_registrations_license_id_fkey
  foreign key (license_id) references licenses (id) on delete cascade;

alter table licenses
  drop constraint if exists licenses_id_user_id_key;

alter table server_registrations
  alter column user_id drop not null;

do $$
begin
  raise notice 'rollback 0088 step 7 ok: server_registrations_license_owner_fkey dropped, server_registrations_license_id_fkey (on delete cascade) added, licenses_id_user_id_key dropped, user_id nullable';
end $$;

-- ---------------------------------------------------------------------------------------
-- 6 reverse: nothing. 0088 step 6 is a read-only preflight; the 0081 index is still there
-- (its drop and its recreate are 0089's, fable v1.71 item 3).
-- ---------------------------------------------------------------------------------------

-- ---------------------------------------------------------------------------------------
-- 5 reverse: drop the CHECK, exception and all (the expiry lapses stay)
-- ---------------------------------------------------------------------------------------

alter table feed_subscriptions
  drop constraint if exists feed_subscriptions_server_or_lapsed_chk;

-- ---------------------------------------------------------------------------------------
-- ledger
-- ---------------------------------------------------------------------------------------

delete from schema_migrations where version = '0088';

commit;
