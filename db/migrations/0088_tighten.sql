-- NOT APPLIED. 0088_tighten.sql -- step (iii) of the 0086 deploy order (0086_marketplace_recut.sql
-- header lines 72-104 as merged at 9e84f16). Written by kai on branch kai/tighten-0087-2026-09-12,
-- thread kai-tighten-0087-2026-09-12. Spec: docs/specs/0087-tighten.md (the 0087 in that name is
-- historical; the SQL files are 0088). Companion rollback: db/migrations/0088_rollback.sql (not run
-- automatically). Migration number 0088: 0087 is reserved for the feed_tiers connection-fields
-- migration, which is parked (not merged, not applied), touches only feed_tiers, and is independent
-- of this file; step 0 neither requires nor forbids it.
--
-- One transaction. Every DO block either raises (whole transaction aborts) or emits a notice line
-- with its counts. The operator dry-runs once with `rollback;` in place of `commit;` and pastes
-- every notice line, then runs it for real; the two pastes must be equal.
--
-- NO CLIENT LIST IS COMMITTED IN THIS FILE. R4..R8 carried six full uuids (marcus's Neon read of
-- 2026-09-13 14:55Z, m49945_mtzxrd14); two days later his read of 2026-09-14 08:41Z
-- (m50350_mu0ztzip) returns a different population, and the committed list would have aborted
-- step 5 on apply. Every set this file acts on is therefore computed from the data at run time,
-- on the transaction's own now(): the lapse population (step 4b) and the CHECK's carve-out
-- (step 5, materialised into the constraint text by `execute format`). Marcus's counts appear
-- below only as EXPECTED values to compare a notice against, never inside a predicate.
--
-- WHAT THIS DOES, IN ORDER (0086 header 93-97: re-run the section 1 / 3 / 4 backfills and gates,
-- re-run preflight D over the completed mapping, then SET NOT NULL and the CHECK; then the three
-- statements the old table's retirement needs. The 0081 index drop is 0089's, see step 6):
--   0. Ledger preflight: schema_migrations has '0086' and does not have '0088'.
--   1. 0086 section 1 re-run: server_registrations.user_id from licenses.user_id where NULL;
--      gate null = 0; owner gate `sr.user_id is distinct from l.user_id` = 0 (rows named), plus
--      the count of licences with user_id NULL that have a server row (must be 0, named as the
--      cause). Expected UPDATE 0: the new server writer has been live since 3ded80d; the only
--      window rows are those registered between the 0086 apply (2026-09-12 17:30Z) and the
--      phase-2 deploy instant below.
--      Vercel deployment dpl_6SggmsWv7raHRi7vHUu6k6C33rfV ready 2026-09-12T22:58:19Z, meta.githubCommitSha=3ded80d, read by leo m49262
--      That instant, 2026-09-12T22:58:19Z, is the one literal shared with 0088_rollback.sql.
--   2. 0086 section 3 re-run with the ledger v1.55 skip predicate extended by conjunct (iv):
--      `not exists access_requests(legacy_feed_tier_request_id = ftr.id)`, so a row the first
--      run carried can never be counted as skipped. Same deterministic envelope ids, same upsert
--      guarded `where access_requests.decided_at is null`. The gate is the v1.55 DISTINCT form:
--      `count(distinct legacy_feed_tier_request_id) = legacy_rows - skipped` plus
--      `envelopes = details`. Then feed_subscriptions.access_request_id backfill from request_id
--      at tier grain, gated: zero rows with request_id set and access_request_id NULL. That gate
--      is the reader check for step 8.
--   2b. Dispositions slot. Literals present only when the cited word is on the thread; a run
--      without the word aborts at step 3 as designed (step 5 no longer refuses a live no-server
--      row -- it carves that row out and 0089 settles it). EMPTY BY DEFAULT. Three shapes
--      (see the slot): (a) reject of a no-envelope pending legacy row; (b) worded lapse of a
--      live no-server subscription; (c) allowlist carry of an approved-only legacy row that WAS
--      told, told_at = the legacy row's actioned_at, asserted not null. (b) and (c) literals
--      stage into temp tables; the fixed blocks after the slot gate them, apply them and count
--      them (fs_lapsed_by_word, allowlist_carried_by_word in the summary).
--   3. Disposition preflight: every feed_tier_requests row with no envelope, one notice per row
--      (id, requester, tier, status, created_at, licence expires_at). pending / approved /
--      provisioned in that set aborts, named; rejected is noticed and drops with the table.
--   4. 0086 section 4 re-run: server_registration_id via licence -> server row (gate left_null =
--      no_server), ends_at re-seed for rows still NULL (non-trial from the licence, trial from
--      feed_tier_trials), gate active rows with ends_at NULL = 0. Expected UPDATE 0 / 0 / 0.
--   4b. REFUSAL GATE, THEN THE PREDICATE LAPSE (marcus m50350_mu0ztzip, 2026-09-14; narrowed to
--      NULL-server rows by his Z1 ruling m50396_mu10majx, 2026-09-14). One notice per candidate
--      first ('step 4b candidate:', fable Z2 in m50391_mu10l45h), so the paste names every row
--      the step is about to touch, not only the refused ones. Then the gate: every row the lapse
--      is about to touch (`status <> 'lapsed' and ends_at < now() and server_registration_id is
--      null`) must ALREADY compute 'lapsed' under the read side's own CASE, transcribed below from
--      EFFECTIVE_STATUS_SQL at src/lib/feed-subscriptions.ts:140-159 (blob 94fa705, branch head
--      e1835fb) with s -> fs. If any does not, the file aborts and names each row with the branch
--      that keeps it alive. That row is one a client can still see today, and flipping its stored
--      status would take something away -- which is not what housekeeping does. The gate is here
--      because a read proves the population safe on the day it is taken, not on the day the file
--      is applied; this file has already sat unapplied for two days while its own committed
--      population went stale. A migration that re-checks its own precondition cannot be overtaken
--      by time. Then the lapse: `status = 'lapsed', lapsed_at = coalesce(lapsed_at, ends_at)`
--      where `status <> 'lapsed' and ends_at < now() and server_registration_id is null` --
--      NULL-server rows only. The `server_registration_id is null` conjunct is marcus's Z1 ruling
--      (m50396_mu10majx, 2026-09-14, option (a)), in his words: the lapse "exceeds the
--      authorisation" without it, because coxwell ruled on the six clients in the no-server
--      blocker table and a client with a server row "was not in that table"; and "a step that
--      alters client records without advancing its own purpose should not run" -- the CHECK this
--      lapse exists to unblock only looks at NULL-server rows. A stored 'lapsed' also matches the
--      read CASE's first branch, so on a renewed-in-place licence such a row would stay lapsed
--      until an admin re-grant where today it reads live again (fable, m50391_mu10l45h Z1).
--      Expected today 18 rows / 6 clients (marcus's prod read of 08:41Z, m50350_mu0ztzip, minus
--      the three rows / one client that HAVE a server row; count restated in his Z1 ruling).
--      lapsed_at is the seeded end, not now(): the truthful instant is when access actually
--      stopped.
--   5. Every feed_subscriptions row with server_registration_id NULL, one notice per row. What is
--      still non-lapsed after 4b is the CARVE-OUT, computed here, never written down:
--      `server_registration_id is null and status <> 'lapsed' and (ends_at > now() or ends_at is
--      null)`. Expected today 6 rows / 2 clients (marcus m50350: Aylrn to 09-19, rasoolx55 to
--      09-25) -- a notice to read, NOT a gate and NOT a list: the number shrinks to 3 on the 19th
--      and to 0 after the 25th, and any number is legitimate. The old SUBSET / EXISTENCE gates on
--      the six are STRUCK with the six (marcus m50350). One gate survives: a NULL-server
--      non-lapsed row that the carve-out predicate does NOT cover (reachable only if its ends_at
--      is exactly the transaction's now(), so neither `< now()` nor `> now()` holds) aborts
--      named, rather than being left to fail ADD CONSTRAINT with 23514. Then the constraint,
--      built by `execute format` over the computed ids:
--        alter table feed_subscriptions add constraint feed_subscriptions_server_or_lapsed_chk
--          check (status = 'lapsed' or server_registration_id is not null
--                 or id in (<the carve-out ids, computed above>));
--      Nothing can join the carve-out (id is the uuid primary key), every NEW NULL-server live
--      row is still refused, and the carve-out rows' renewal UPDATEs pass. An EMPTY carve-out
--      drops the `id in` clause entirely and leaves 0089 nothing to settle. Column stays nullable
--      (0086 header 80-82). Not `not valid`, and not because of taste: Postgres re-checks every
--      UPDATED row against a NOT VALID constraint, so a carve-out client's renewal would fail
--      23514 -- a paying client cut by another route (fable, 12:53Z). 0089 removes the exception.
--   6. Preflight D re-run on (server_registration_id, feed_tier_id) among live rows (must be 0).
--      The 0081 index drop MOVES OUT to 0089: the carve-out rows are live with NULL server and
--      the 0086 server-keyed index cannot see them; 0081's (license_id, feed_tier_id) is their
--      only uniqueness cover until they are bound or lapsed. No replacement index. The 0078
--      provider_tier twin is not touched.
--   7. server_registrations: `alter column user_id set not null` (gate = step 1); `licenses`
--      gains `unique (id, user_id)` (additive, id is the PK); the 0031 single-column FK to
--      licenses is looked up by conrelid/confrelid/contype (created unnamed in 0031, so the
--      name is noticed, not assumed) and dropped; then
--        foreign key (license_id, user_id) references licenses (id, user_id)
--          on delete set null (license_id)
--      named server_registrations_license_owner_fkey. MATCH SIMPLE: a licence-less row is not
--      checked. Column-list SET NULL needs Postgres >= 15 (prod is 17.11). ON UPDATE stays NO
--      ACTION. `unique (license_id)` from 0031 kept plain.
--   8. request_id goes: the step-2 gate re-run immediately before (zero rows with request_id set
--      and access_request_id NULL), a notice of the rows that had a value, then
--      `drop index if exists feed_subscriptions_request_tier_uidx` (0079) and
--      `alter table feed_subscriptions drop column if exists request_id` (takes the 0078 FK to
--      feed_tier_requests with it). Reader proof: `git grep -n request_id -- src` at 9e84f16 =
--      18 lines, none reads feed_subscriptions.request_id (spec line one).
--   9. The 'provisioned' carry into feed_allowlist_records (server, tier, declared_ip,
--      told_at = actioned_at; package literals expand exactly as 0086 section 3 does), guarded:
--      every provisioned row has a server row, has actioned_at not null, and resolves to >= 1
--      feed_tiers row; INSERT skips a (server, tier, ip) that already has an open record; post
--      gate: every distinct (server, tier, ip) has an open record. Then the drop guard
--      (`count(*) from pg_constraint where confrelid = 'feed_tier_requests'::regclass` = 0) and
--      `drop table feed_tier_requests` (its two 0034 indexes go with it). `git grep -n
--      feed_tier_requests -- src` at 9e84f16 = 13 comment lines, zero code.
--  10. Summary row, then the schema_migrations row ('0088').
--
-- AFTER THIS FILE: the vendor record set is complete after this file; a provider surface may
-- present it as the truth of what the provider was told.
--
-- WHAT THIS DOES NOT DO:
--   - Does not touch feed_subscriptions.license_id or any writer of it. The server_registrations
--     half of the ledger v1.49 window rule ends here (user_id NOT NULL); the feed_subscriptions
--     half survives until read-side flip (c) (ledger v1.63): EFFECTIVE_STATUS_SQL still joins
--     licenses on s.license_id.
--   - Does not add told_by to feed_allowlist_records (ledger: not this file; carried rows are
--     not back-fillable later, accepted).
--   - Does not add a no-server unique index and does not drop the 0081 index: the only live
--     rows with NULL server after step 5 are the carve-out ids, which 0081 keeps covering by
--     (license_id, feed_tier_id) until db/migrations/0089_drop_server_or_lapsed_exception.sql
--     (it reads the carve-out back out of the live CHECK, re-keys those rows, gates on none of
--     them live with a NULL server, lapses the expired ones, re-adds the CHECK without the
--     exception, drops 0081).
--   - Does not pad the deploy-instant literal. A legacy row actioned at or after it would sit
--     above the rollback's `told_at < literal` bound; the apply gates in spec section 11 (both
--     expect 0, re-taken before the dry-run and before apply) keep that case empty.
--
-- Expected result per statement is in the section comments.

begin;

-- Counts that later steps cannot re-derive (the objects they count are gone by step 10).
create temp table tmp_0088_counts (k text primary key, v integer not null) on commit drop;

-- ---------------------------------------------------------------------------------------
-- 0. LEDGER PREFLIGHT
-- ---------------------------------------------------------------------------------------

-- '0086' present, '0088' absent. '0087' is neither required nor forbidden: the feed_tiers
-- connection-fields migration holds that number, is parked, and is independent of this file.
do $$
begin
  if not exists (select 1 from schema_migrations where version = '0086') then
    raise exception 'step 0: schema_migrations has no 0086 row; 0086_marketplace_recut.sql must be applied first';
  end if;
  if exists (select 1 from schema_migrations where version = '0088') then
    raise exception 'step 0: schema_migrations already has a 0088 row; this file has been applied';
  end if;
  raise notice 'step 0 ok: 0086 present, 0088 absent, 0087 present=%',
    exists (select 1 from schema_migrations where version = '0087');
end $$;

-- ---------------------------------------------------------------------------------------
-- 1. 0086 SECTION 1 RE-RUN, THEN THE OWNER GATE
-- ---------------------------------------------------------------------------------------

-- Expected: UPDATE 0 (window rows only), notice x1.
-- updated_at deliberately untouched (0086 rule: "last edited" in the admin panel).
update server_registrations sr
set user_id = l.user_id
from licenses l
where l.id = sr.license_id
  and sr.user_id is null;

-- Gate 1: no NULL user_id left. Gate 2: stored owner agrees with the licence owner,
-- `is distinct from` because licenses.user_id is nullable (0001:51) and `<>` is NULL-blind.
-- If nonzero, the rows are named and the file aborts here; disposition (claim or delete) is a
-- decision, not a default. The abort also carries the count of licences with user_id NULL that
-- have any server row, so an unclaimed licence bound to a server is named as the cause.
do $$
declare
  r record;
  unresolved integer;
  mismatch integer;
  null_owner_with_server integer;
begin
  select count(*) into unresolved from server_registrations where user_id is null;
  if unresolved != 0 then
    raise exception 'step 1: user_id backfill left % server_registrations row(s) null', unresolved;
  end if;

  select count(*) into mismatch
  from server_registrations sr
  join licenses l on l.id = sr.license_id
  where sr.user_id is distinct from l.user_id;

  select count(*) into null_owner_with_server
  from licenses l
  where l.user_id is null
    and exists (select 1 from server_registrations sr where sr.license_id = l.id);

  if mismatch != 0 or null_owner_with_server != 0 then
    for r in
      select sr.id, sr.license_id, sr.user_id as stored_user_id, l.user_id as licence_user_id
      from server_registrations sr
      join licenses l on l.id = sr.license_id
      where sr.user_id is distinct from l.user_id
      order by sr.id
    loop
      raise notice 'step 1 owner mismatch: server_registration=% license=% stored_user_id=% licence_user_id=%',
        r.id, r.license_id, r.stored_user_id, r.licence_user_id;
    end loop;
    raise exception 'step 1: % server row(s) whose user_id is distinct from the licence owner (listed above); % licence(s) with user_id NULL have a server row',
      mismatch, null_owner_with_server;
  end if;
  raise notice 'step 1 ok: server_registrations.user_id null=0 owner_mismatch=0 null_owner_licences_with_server=0';
end $$;

-- ---------------------------------------------------------------------------------------
-- 2. 0086 SECTION 3 RE-RUN WITH PREDICATE (iv)
-- ---------------------------------------------------------------------------------------

-- The ledger v1.54 skip predicate (0086 C0) written once, extended by conjunct (iv): a legacy
-- row that already has an envelope is never a skip, whatever else is true of it. Read by step
-- 2's gate; not by step 3 (which lists by "no envelope" directly).
-- Expected: SELECT <skipped count> (0086 apply: the ftr_skipped it printed, unless a window row
-- changed the set).
create temp table tmp_0088_skipped_requests on commit drop as
select
  ftr.id,
  coalesce(u.email, u.display_name, u.id::text) as requester,
  ftr.tier_key,
  ftr.status,
  ftr.created_at,
  l.expires_at as licence_expires_at
from feed_tier_requests ftr
left join users u on u.id = ftr.user_id
left join licenses l on l.id = ftr.license_id
where not exists (select 1 from server_registrations sr where sr.license_id = ftr.license_id)
  and ftr.status in ('pending', 'rejected')
  and (ftr.status <> 'pending' or l.expires_at <= now())
  and not exists (select 1 from feed_subscriptions fs where fs.request_id = ftr.id)
  and not exists (select 1 from access_requests a where a.legacy_feed_tier_request_id = ftr.id);

-- Same expansion as 0086:446-463 (package literals as PACKAGE_TIER_KEYS,
-- src/lib/feed-tier-catalogue.ts:58-61). Envelope id md5(legacy id || ':' || tier id)::uuid.
-- Expected: SELECT <N> (temp), INSERT 0 envelopes / 0 details on prod unless the old code wrote
-- a request in the window (then N, named in the gate notice), notice.
create temp table tmp_0088_expanded on commit drop as
select
  ftr.id as legacy_id,
  md5(ftr.id::text || ':' || ft.id::text)::uuid as envelope_id,
  ftr.user_id,
  ftr.status,
  ftr.reason,
  ftr.actioned_by,
  ftr.actioned_at,
  ftr.created_at,
  ftr.license_id,
  ft.id as feed_tier_id
from feed_tier_requests ftr
join feed_tiers ft
  on ft.tier_key = ftr.tier_key
  or (ftr.tier_key = 'ld-retail-package' and ft.tier_key in ('ld-beta-56', 'ld-gamma-19', 'ld-delta-18'))
  or (ftr.tier_key = 'ny-retail-package' and ft.tier_key in ('ny-fast', 'ny-normal'))
where not exists (select 1 from tmp_0088_skipped_requests s where s.id = ftr.id);

insert into access_requests
  (id, user_id, product_kind, batch_id, status, decision, ends_at, invoice_ref, reason,
   decided_by, decided_at, legacy_feed_tier_request_id, created_at)
select
  e.envelope_id,
  e.user_id,
  'feed_tier',
  e.legacy_id,
  case e.status when 'provisioned' then 'approved' else e.status end,
  null,
  null,
  null,
  e.reason,
  e.actioned_by,
  e.actioned_at,
  e.legacy_id,
  e.created_at
from tmp_0088_expanded e
on conflict (id) do update set
  status = excluded.status,
  reason = excluded.reason,
  decided_by = excluded.decided_by,
  decided_at = excluded.decided_at
where access_requests.decided_at is null;

insert into feed_tier_request_details (request_id, server_registration_id, feed_tier_id)
select
  e.envelope_id,
  sr.id,
  e.feed_tier_id
from tmp_0088_expanded e
join server_registrations sr on sr.license_id = e.license_id
on conflict (request_id) do nothing;

-- GATE, the v1.55 DISTINCT form (0086:504-530): count(distinct legacy_feed_tier_request_id) =
-- legacy_rows - skipped, plus envelopes = details.
do $$
declare
  legacy_rows integer;
  skipped integer;
  mapped_legacy integer;
  envelopes integer;
  details integer;
begin
  select count(*) into legacy_rows from feed_tier_requests;
  select count(*) into skipped from tmp_0088_skipped_requests;
  select count(distinct legacy_feed_tier_request_id) into mapped_legacy
  from access_requests where legacy_feed_tier_request_id is not null;
  select count(*) into envelopes from access_requests where legacy_feed_tier_request_id is not null;
  select count(*) into details
  from feed_tier_request_details d
  join access_requests a on a.id = d.request_id
  where a.legacy_feed_tier_request_id is not null;
  if envelopes != details then
    raise exception 'step 2: envelope/detail mismatch envelopes=% details=%', envelopes, details;
  end if;
  if mapped_legacy != legacy_rows - skipped then
    raise exception 'step 2: legacy rows with an envelope=% but legacy_rows - skipped = % - % = %',
      mapped_legacy, legacy_rows, skipped, legacy_rows - skipped;
  end if;
  raise notice 'step 2 ok: legacy_rows=% skipped=% legacy_rows_with_envelope=% envelopes=% details=%',
    legacy_rows, skipped, mapped_legacy, envelopes, details;
end $$;

-- access_request_id backfill from request_id at tier grain (0086:542-548), then its gate. The
-- gate is the reader check for step 8: after it, every fact request_id carried is carried by
-- access_request_id (row level) plus access_requests.legacy_feed_tier_request_id (request level).
-- Expected: UPDATE 0, notice.
update feed_subscriptions fs
set access_request_id = a.id
from access_requests a
where fs.request_id is not null
  and fs.feed_tier_id is not null
  and a.id = md5(fs.request_id::text || ':' || fs.feed_tier_id::text)::uuid
  and fs.access_request_id is null;

do $$
declare
  with_request integer;
  unmapped integer;
begin
  select count(*) into with_request from feed_subscriptions where request_id is not null;
  select count(*) into unmapped
  from feed_subscriptions
  where request_id is not null and access_request_id is null;
  if unmapped != 0 then
    raise exception 'step 2 gate: % of % feed_subscriptions rows with request_id have no access_request_id', unmapped, with_request;
  end if;
  raise notice 'step 2 gate ok: feed_subscriptions with request_id=% unmapped=0', with_request;
end $$;

-- ---------------------------------------------------------------------------------------
-- 2b. DISPOSITIONS SLOT -- literals only, each under a comment citing the bus message id and
--     date of the word. EMPTY BY DEFAULT. Nothing here loosens step 3 or step 5.
-- ---------------------------------------------------------------------------------------

-- NO EXEMPT LIST HERE ANY MORE. R4..R8 created tmp_0088_exempt at this point with six committed
-- uuids (fable ruling 12:53Z, ledger v1.71 3800e9d, on marcus m49538_mtzt2uia; full uuids from
-- his read of 2026-09-13 14:55Z, m49945_mtzxrd14). Marcus's read of 2026-09-14 08:41Z
-- (m50350_mu0ztzip) returns a different population two days later, so that list would have
-- aborted the old step-5 SUBSET gate on apply. The carve-out is computed in step 5 instead, from
-- the rows that are still non-lapsed with a NULL server after the step-4b lapse, and is
-- materialised only inside the CHECK. Nothing before step 5 needs it: 2b(b) below asserts its
-- staged ids against the live data directly.

-- Staging for (b) and (c). Created on every run so the fixed blocks below and the summary can
-- count 0 when the slot is empty.
create temp table tmp_0088_lapse_by_word (id uuid primary key) on commit drop;

create temp table tmp_0088_carry_by_word (
  legacy_id uuid primary key,   -- one carry per legacy row; a repeat fails 23505 at staging (fable R-b)
  server_registration_id uuid,
  feed_tier_id uuid,
  ip text,
  told_at timestamptz
) on commit drop;

-- (a) reject of a no-envelope pending legacy row (today: 31cd1813, licence expired 09-01; no
--     code path can reject it). The row then drops with the table in step 9 as rejected. Shape:
--       -- coxwell <message id>, <date>: reject
--       update feed_tier_requests
--       set status = 'rejected', actioned_at = now(), reason = '<coxwell, message id, date>'
--       where id = '31cd1813-5994-4946-bc3e-b5e1f3a52f64' and status = 'pending';
--
-- (b) worded lapse of a subscription that is live with no server right here (no writer inserts a
--     NULL-server row, Leo m49736). Without a word such a row is CARVED OUT by step 5 and settled
--     by 0089; a word ends it now instead. The fixed block below refuses a staged id that is not
--     live with a NULL server at this point of the run -- a worded lapse of any other row is a
--     mistake, not a disposition, and an expired row needs no word (step 4b lapses it on the
--     predicate). lapsed_at = now(): a decision, dated when taken, unlike 4b's seeded end. The
--     other resolution needs NO literal: the client registers a real server row before the run
--     and step 4 re-keys the rows. Shape:
--       -- coxwell <message id>, <date>: lapse
--       insert into tmp_0088_lapse_by_word (id) values ('<row id>'), ('<row id>');
--
-- (c) allowlist carry of a legacy approved-only row the vendor WAS told about. One literal per
--     legacy row; packages expand exactly as step 9's carry does; told_at = the legacy row's
--     actioned_at, asserted not null by the fixed gate below (never a NULL told_at). Shape:
--       -- coxwell <message id>, <date>: was told
--       insert into tmp_0088_carry_by_word (legacy_id, server_registration_id, feed_tier_id, ip, told_at)
--       select ftr.id, sr.id, ft.id, sr.declared_ip, ftr.actioned_at
--       from feed_tier_requests ftr
--       join server_registrations sr on sr.license_id = ftr.license_id
--       join feed_tiers ft
--         on ft.tier_key = ftr.tier_key
--         or (ftr.tier_key = 'ld-retail-package' and ft.tier_key in ('ld-beta-56', 'ld-gamma-19', 'ld-delta-18'))
--         or (ftr.tier_key = 'ny-retail-package' and ft.tier_key in ('ny-fast', 'ny-normal'))
--       where ftr.id = '<legacy id>' and ftr.status = 'approved';

-- (slot: no literals present)

-- Fixed: apply (b). Every staged id must exist and be a live no-server row at this point of the
-- run (fable v1.75 item (ii), with its "one of the six" conjunct struck by marcus m50350_mu0ztzip
-- along with the list itself), else abort naming it: a worded lapse of any other row is a
-- mistake, not a disposition. Expected on an empty slot: staged=0 lapsed=0.
do $$
declare
  r record;
  staged integer;
  bad integer;
  lapsed integer;
begin
  select count(*) into staged from tmp_0088_lapse_by_word;
  select count(*) into bad
  from tmp_0088_lapse_by_word w
  left join feed_subscriptions fs on fs.id = w.id
  where fs.id is null
     or fs.server_registration_id is not null
     or fs.status = 'lapsed'
     or not (fs.ends_at > now() or fs.ends_at is null);
  if bad != 0 then
    for r in
      select w.id, fs.status, fs.server_registration_id, fs.ends_at
      from tmp_0088_lapse_by_word w
      left join feed_subscriptions fs on fs.id = w.id
      where fs.id is null
         or fs.server_registration_id is not null
         or fs.status = 'lapsed'
         or not (fs.ends_at > now() or fs.ends_at is null)
      order by w.id
    loop
      raise notice 'step 2b(b) not a live no-server row: id=% status=% server_registration_id=% ends_at=%',
        r.id, r.status, r.server_registration_id, r.ends_at;
    end loop;
    raise exception 'step 2b(b): % of % staged lapse id(s) are not rows that exist and are live with no server (listed above)', bad, staged;
  end if;

  update feed_subscriptions fs
  set status = 'lapsed', lapsed_at = now(), updated_at = now()
  from tmp_0088_lapse_by_word w
  where fs.id = w.id;
  get diagnostics lapsed = row_count;

  insert into tmp_0088_counts (k, v) values ('fs_lapsed_by_word', lapsed);
  raise notice 'step 2b(b) ok: staged=% lapsed_by_word=%', staged, lapsed;
end $$;

-- Fixed: apply (c). Every staged row must carry a non-null told_at (the legacy actioned_at),
-- a server row and a tier, else abort naming the legacy row. INSERT shape = step 9's carry
-- (skip where an open same-IP record exists; on conflict on the PK do nothing).
-- Expected on an empty slot: staged=0 inserted=0.
do $$
declare
  r record;
  staged integer;
  bad integer;
  inserted integer;
begin
  select count(*) into staged from tmp_0088_carry_by_word;
  select count(*) into bad
  from tmp_0088_carry_by_word w
  where w.told_at is null or w.server_registration_id is null or w.feed_tier_id is null or w.ip is null;
  if bad != 0 then
    for r in
      select w.legacy_id, w.server_registration_id, w.feed_tier_id, w.ip, w.told_at
      from tmp_0088_carry_by_word w
      where w.told_at is null or w.server_registration_id is null or w.feed_tier_id is null or w.ip is null
      order by w.legacy_id, w.feed_tier_id
    loop
      raise notice 'step 2b(c) incomplete carry: legacy_id=% server_registration_id=% feed_tier_id=% ip=% told_at=%',
        r.legacy_id, r.server_registration_id, r.feed_tier_id, r.ip, r.told_at;
    end loop;
    raise exception 'step 2b(c): % of % staged carry row(s) have a NULL told_at / server / tier / ip (listed above); told_at is the legacy actioned_at and has no fallback', bad, staged;
  end if;

  insert into feed_allowlist_records (server_registration_id, feed_tier_id, ip, told_at)
  select w.server_registration_id, w.feed_tier_id, w.ip, w.told_at
  from tmp_0088_carry_by_word w
  where not exists (select 1 from feed_allowlist_records x
                    where x.server_registration_id = w.server_registration_id
                      and x.feed_tier_id = w.feed_tier_id and x.ip = w.ip and x.revoked_at is null)
  on conflict (server_registration_id, feed_tier_id, told_at) do nothing;
  get diagnostics inserted = row_count;

  insert into tmp_0088_counts (k, v) values ('allowlist_carried_by_word', inserted);
  raise notice 'step 2b(c) ok: staged=% allowlist_carried_by_word=%', staged, inserted;
end $$;

-- ---------------------------------------------------------------------------------------
-- 3. DISPOSITION PREFLIGHT: legacy rows with no envelope (0086 header 89-92)
-- ---------------------------------------------------------------------------------------

-- Runs AFTER step 2 so a row the old code wrote in the window and step 2 just carried is not
-- listed. pending aborts; approved / provisioned cannot be in this set after step 2 unless the
-- expansion join lost them, so they abort too; rejected is noticed and drops with the table.
-- Expected today: one row (31cd1813): rejected via 2b(a) and the run continues; without the
-- literal it is pending and the file aborts here, as designed.
do $$
declare
  r record;
  listed integer := 0;
  blocking integer := 0;
  rejected integer := 0;
begin
  for r in
    select ftr.id, coalesce(u.email, u.display_name, u.id::text) as requester, ftr.tier_key,
           ftr.status, ftr.created_at, l.expires_at as licence_expires_at
    from feed_tier_requests ftr
    left join users u on u.id = ftr.user_id
    left join licenses l on l.id = ftr.license_id
    where not exists (select 1 from access_requests a where a.legacy_feed_tier_request_id = ftr.id)
    order by requester, ftr.created_at, ftr.id
  loop
    listed := listed + 1;
    if r.status = 'rejected' then
      rejected := rejected + 1;
    else
      blocking := blocking + 1;
    end if;
    raise notice 'step 3 no envelope: id=% requester=% tier=% status=% created_at=% licence_expires_at=%',
      r.id, r.requester, r.tier_key, r.status, r.created_at, r.licence_expires_at;
  end loop;
  if blocking != 0 then
    raise exception 'step 3: % of % no-envelope legacy row(s) are not rejected (listed above); a pending one needs a word in 2b(a)', blocking, listed;
  end if;
  insert into tmp_0088_counts (k, v) values ('legacy_no_envelope_rejected', rejected);
  raise notice 'step 3 ok: no-envelope rows=% rejected (drop with the table)=% blocking=0', listed, rejected;
end $$;

-- ---------------------------------------------------------------------------------------
-- 4. 0086 SECTION 4 RE-RUN
-- ---------------------------------------------------------------------------------------

-- Expected: UPDATE 0 / 0 / 0 (phase-2 writers set all three columns), notice x2.
update feed_subscriptions fs
set server_registration_id = sr.id, updated_at = now()
from server_registrations sr
where sr.license_id = fs.license_id
  and fs.server_registration_id is null;

do $$
declare
  left_null integer;
  no_server integer;
begin
  select count(*) into left_null from feed_subscriptions where server_registration_id is null;
  select count(*) into no_server
  from feed_subscriptions fs
  left join server_registrations sr on sr.license_id = fs.license_id
  where sr.id is null;
  if left_null != no_server then
    raise exception 'step 4: server_registration_id backfill left % row(s) null but only % have no server row', left_null, no_server;
  end if;
  raise notice 'step 4 ok: feed_subscriptions.server_registration_id null rows=% (all with no server row; listed in step 5)', left_null;
end $$;

update feed_subscriptions fs
set ends_at = l.expires_at, updated_at = now()
from licenses l
where l.id = fs.license_id
  and fs.status <> 'trial'
  and fs.ends_at is null;

update feed_subscriptions fs
set ends_at = ftt.trial_ends_at, updated_at = now()
from feed_tiers ft
join feed_tier_trials ftt on ftt.tier_key = ft.tier_key
where ft.id = fs.feed_tier_id
  and ftt.user_id = fs.subscriber_user_id
  and fs.status = 'trial'
  and fs.ends_at is null;

do $$
declare
  active_null integer;
  trial_null integer;
begin
  select count(*) into active_null
  from feed_subscriptions
  where status = 'active' and ends_at is null;
  if active_null != 0 then
    raise exception 'step 4 gate: % active feed_subscriptions rows with ends_at NULL (expected 0)', active_null;
  end if;
  select count(*) into trial_null
  from feed_subscriptions
  where status = 'trial' and ends_at is null;
  raise notice 'step 4 gate ok: active rows with ends_at NULL=0; trial rows with ends_at NULL=%', trial_null;
end $$;

-- ---------------------------------------------------------------------------------------
-- 4b. REFUSAL GATE, THEN THE PREDICATE LAPSE (marcus m50350_mu0ztzip + Z1 ruling m50396_mu10majx)
-- ---------------------------------------------------------------------------------------

-- The candidate set: every row the lapse is about to touch. Runs AFTER step 4's ends_at re-seed,
-- so it reads the seeded value, not the NULL. `< now()`, not `<= now()`: word for word from
-- marcus m50350_mu0ztzip ("Predicate lapse step -- `ends_at < now()`, as specified").
-- NULL-server rows ONLY: `and fs.server_registration_id is null` is marcus's Z1 ruling
-- (m50396_mu10majx, 2026-09-14, option (a), on fable's strike m50391_mu10l45h Z1). Without it the
-- set is population (b) (`status <> 'lapsed' and ends_at < now()`, 21 rows / 7 clients in his
-- 08:41Z read) rather than population (b) intersected with the no-server population (a) that
-- coxwell was actually shown, and it would lapse 3 rows of one client who HAS a server row and
-- was never in the blocker table. His words: "a literal can under-reach; a predicate can
-- over-reach. Neither is safe by category -- the test is whether the set it selects is the set
-- that was authorised."
--
-- computed_status is EFFECTIVE_STATUS_SQL transcribed, s -> fs, from
-- src/lib/feed-subscriptions.ts:140-159 as of blob 94fa705 (branch head e1835fb, 2026-09-14):
--
--     case
--       when s.status = 'lapsed' then 'lapsed'
--       when ft.region_key is null then s.status
--       when <REGION_TO_FEED_TYPE_SQL, :114> is null then s.status
--       when exists (select 1 from licenses l
--                    where l.id = s.license_id and l.status = 'active' and l.expires_at > now())
--         then s.status
--       when exists (select 1 from feed_tier_trials ftt
--                    where ftt.user_id = s.subscriber_user_id and ftt.tier_key = ft.tier_key
--                      and ftt.trial_status = 'active' and ftt.trial_ends_at > now())
--         then s.status
--       else 'lapsed'
--     end
--
-- and REGION_TO_FEED_TYPE_SQL (same file, line 114) is
--     case ft.region_key when 'london' then 'london' when 'ny' then 'ny' when 'tokyo' then 'crypto' else null end
--
-- LEFT join feed_tiers, matching step 5's listing: a provider_tier row has feed_tier_id NULL and
-- reaches the `region_key is null` branch, where the CASE returns its own status. Under the inner
-- join some readers use, such a row would vanish from the gate instead of being named -- the
-- conservative choice is the one that can still refuse. `reason` mirrors the same ladder for the
-- operator and is diagnostic only; computed_status is what the gate decides on.
-- LEFT join users, unlike the notice loops elsewhere in this file: this table decides what gets
-- lapsed, so a row must not be able to fall out of the gate because its subscriber row is missing.
create temp table tmp_0088_lapse_candidates on commit drop as
select fs.id,
       coalesce(u.email, u.display_name, fs.subscriber_user_id::text) as subscriber,
       fs.subscriber_user_id,
       ft.tier_key,
       fs.status,
       fs.server_registration_id,
       fs.ends_at,
       case
         when fs.status = 'lapsed' then 'lapsed'
         when ft.region_key is null then fs.status
         when (case ft.region_key when 'london' then 'london' when 'ny' then 'ny'
                                  when 'tokyo' then 'crypto' else null end) is null then fs.status
         when exists (
           select 1 from licenses l
           where l.id = fs.license_id
             and l.status = 'active' and l.expires_at > now()
         ) then fs.status
         when exists (
           select 1 from feed_tier_trials ftt
           where ftt.user_id = fs.subscriber_user_id
             and ftt.tier_key = ft.tier_key
             and ftt.trial_status = 'active'
             and ftt.trial_ends_at > now()
         ) then fs.status
         else 'lapsed'
       end as computed_status,
       case
         when ft.region_key is null then 'ungated: no region_key (provider_tier row or unregioned tier)'
         when (case ft.region_key when 'london' then 'london' when 'ny' then 'ny'
                                  when 'tokyo' then 'crypto' else null end) is null
           then 'ungated: region maps to no FeedType (cme)'
         when exists (
           select 1 from licenses l
           where l.id = fs.license_id
             and l.status = 'active' and l.expires_at > now()
         ) then 'licence bound to this row is active and unexpired (renewed in place?)'
         when exists (
           select 1 from feed_tier_trials ftt
           where ftt.user_id = fs.subscriber_user_id
             and ftt.tier_key = ft.tier_key
             and ftt.trial_status = 'active'
             and ftt.trial_ends_at > now()
         ) then 'a live feed_tier_trial covers this tier_key'
         else 'computes lapsed (no branch keeps it alive)'
       end as reason
from feed_subscriptions fs
left join users u on u.id = fs.subscriber_user_id
left join feed_tiers ft on ft.id = fs.feed_tier_id
where fs.status <> 'lapsed'
  and fs.ends_at < now()
  and fs.server_registration_id is null;

-- ONE NOTICE PER CANDIDATE, THEN THE REFUSAL GATE.
--
-- The candidate notices are fable's Z2 (m50391_mu10l45h, 2026-09-14): every row this step is
-- about to touch is named in the paste, not only the refused ones, so the operator's record of
-- what moved comes from the SAME run's now() as the move. The before-read cannot serve that
-- purpose -- it is a different now(), and a row whose ends_at falls between the two reads is a
-- mover the before-read does not list (Aylrn's 3 rows cross on 09-19).
--
-- The gate: a candidate that computes non-lapsed is a row a client can still see today; storing
-- 'lapsed' on it would take access away, and this step is housekeeping -- stored status catching
-- up with what the read side already says. Empty in marcus's read of 2026-09-14 08:41Z
-- (m50350_mu0ztzip: 21 rows over both populations, effective_status 'lapsed' on every one),
-- which is why the flip is housekeeping AT THAT INSTANT and says nothing about the instant this
-- file is applied. This block re-takes that proof on the transaction's own now(), so the file
-- cannot be overtaken by time the way its committed six-uuid list was. It does not abort on the
-- count -- only on a row that would lose something. Expected today: candidates=18 clients=6
-- non_lapsed=0 (18 / 6 is marcus's Z1 ruling m50396_mu10majx; the other 3 rows of his 21 have a
-- server row and are no longer candidates).
do $$
declare
  r record;
  candidates integer;
  clients integer;
  non_lapsed integer;
  lapsed_now integer;
begin
  select count(*), count(distinct subscriber_user_id) into candidates, clients
  from tmp_0088_lapse_candidates;

  for r in
    select id, subscriber, tier_key, status, server_registration_id, ends_at,
           computed_status, reason
    from tmp_0088_lapse_candidates
    order by subscriber, tier_key, id
  loop
    raise notice 'step 4b candidate: id=% subscriber=% tier=% status=% server_registration_id=% ends_at=% computed=% because=%',
      r.id, r.subscriber, coalesce(r.tier_key, '(provider_tier)'), r.status,
      r.server_registration_id, r.ends_at, r.computed_status, r.reason;
  end loop;

  select count(*) into non_lapsed
  from tmp_0088_lapse_candidates where computed_status <> 'lapsed';

  if non_lapsed != 0 then
    for r in
      select id, subscriber, tier_key, status, server_registration_id, ends_at,
             computed_status, reason
      from tmp_0088_lapse_candidates
      where computed_status <> 'lapsed'
      order by subscriber, tier_key, id
    loop
      raise notice 'step 4b REFUSE (still live to the reader): id=% subscriber=% tier=% status=% server_registration_id=% ends_at=% computed=% because=%',
        r.id, r.subscriber, coalesce(r.tier_key, '(provider_tier)'), r.status,
        r.server_registration_id, r.ends_at, r.computed_status, r.reason;
    end loop;
    raise exception 'step 4b: % of % row(s) with a past ends_at still compute non-lapsed under EFFECTIVE_STATUS_SQL (listed above); lapsing them would revoke access a client has today. Not housekeeping -- stop and take each row to the thread', non_lapsed, candidates;
  end if;

  -- The lapse. Restricted to the gated set by id, so the rows updated are exactly the rows the
  -- gate cleared. lapsed_at = coalesce(lapsed_at, ends_at): the truthful instant is the seeded
  -- end, not the run (2b(b)'s worded lapse is the one that dates itself now()).
  update feed_subscriptions fs
  set status = 'lapsed', lapsed_at = coalesce(fs.lapsed_at, fs.ends_at), updated_at = now()
  from tmp_0088_lapse_candidates c
  where fs.id = c.id and fs.status <> 'lapsed';
  get diagnostics lapsed_now = row_count;

  if lapsed_now != candidates then
    raise exception 'step 4b: gate cleared % candidate(s) but the lapse updated %; the two must be equal', candidates, lapsed_now;
  end if;

  insert into tmp_0088_counts (k, v) values ('fs_predicate_lapsed', lapsed_now);
  insert into tmp_0088_counts (k, v) values ('fs_predicate_lapsed_clients', clients);
  raise notice 'step 4b ok: candidates=% clients=% computed_non_lapsed=0 lapsed=% (expected 18 / 6 / 0 / 18: marcus m50350 08:41Z read narrowed to NULL-server rows by his Z1 ruling m50396)',
    candidates, clients, lapsed_now;
end $$;

-- ---------------------------------------------------------------------------------------
-- 5. NULL-SERVER DISPOSITION, THEN THE CHECK (0086 header 80-86)
-- ---------------------------------------------------------------------------------------

-- The lapse now happens in step 4b, on the predicate and over every NULL-server row, so this step
-- no longer lapses anything: it names what is left with a NULL server and carries it. R4..R8 gated here
-- against six committed uuids with a SUBSET gate, an EXISTENCE gate and a live-count notice;
-- all three are STRUCK with the list (marcus m50350_mu0ztzip, 2026-09-14: "Rip out the six
-- hardcoded uuids in 0088 R8's four lists and the step-5 gate", "Use it as a CHECK, never as a
-- hardcoded list"). What is still NULL-server and non-lapsed after 4b IS the carve-out -- by
-- construction, the exact set that would otherwise fail the constraint -- and it is read out of
-- the data here, on the transaction's own now().
--
-- First one notice per NULL-server row whatever its status; the operator pastes every
-- 'step 5 no server:' and 'step 5 carve-out:' line. Expected today listed=27: marcus's read of
-- 08:41Z (m50350) has 24 NULL-server non-lapsed rows / 8 clients, of which 18 were just lapsed by
-- 4b -- since his Z1 ruling (m50396_mu10majx) every 4b candidate is a NULL-server row, so 4b's
-- population and this listing's non-lapsed half are the same 18 rows / 6 clients -- plus the 3
-- already stored lapsed with a NULL server in his read of 2026-09-12 (m49188), and the 6 / 2 that
-- are still live and become the carve-out.
do $$
declare
  r record;
  listed integer := 0;
begin
  for r in
    select fs.id, coalesce(u.email, u.display_name, u.id::text) as subscriber,
           ft.tier_key, fs.status, fs.ends_at,
           (fs.ends_at > now() or fs.ends_at is null) as computed_live
    from feed_subscriptions fs
    join users u on u.id = fs.subscriber_user_id
    left join feed_tiers ft on ft.id = fs.feed_tier_id
    where fs.server_registration_id is null
    order by subscriber, ft.tier_key, fs.id
  loop
    listed := listed + 1;
    raise notice 'step 5 no server: id=% subscriber=% tier=% status=% ends_at=% computed_live=%',
      r.id, r.subscriber, coalesce(r.tier_key, '(provider_tier)'), r.status, r.ends_at, r.computed_live;
  end loop;
  insert into tmp_0088_counts (k, v) values ('fs_no_server_listed', listed);
  raise notice 'step 5 listed: no-server rows=% (expected 27 on marcus m49188 + m50350)', listed;
end $$;

-- THE CARVE-OUT. Predicate word for word from marcus m50350_mu0ztzip ("NULL-server carve-out
-- gated on `ends_at > now()`"), with `or ends_at is null` kept from the S4 liveness form (a NULL
-- ends_at reads live; step 4's gate has already forced active rows with ends_at NULL to 0).
-- Expected: SELECT 6 today (his read: Aylrn to 2026-09-19 x3, rasoolx55 to 2026-09-25 x3). That
-- number is a CHECK to read against, never a bound: it becomes 3 after the 19th and 0 after the
-- 25th, and 0 is a legitimate outcome that drops the exception clause entirely.
create temp table tmp_0088_carve_out on commit drop as
select fs.id
from feed_subscriptions fs
where fs.server_registration_id is null
  and fs.status <> 'lapsed'
  and (fs.ends_at > now() or fs.ends_at is null);

-- Name every carve-out row, then the one surviving gate: a NULL-server non-lapsed row the
-- predicate does NOT cover would fail ADD CONSTRAINT with 23514 below. After 4b that is reachable
-- only for a row whose ends_at is exactly this transaction's now() -- neither `< now()` (4b) nor
-- `> now()` (here) holds. Aborting named beats an opaque 23514, and the fix is to re-run: the
-- next transaction's now() has moved past it.
do $$
declare
  r record;
  carved integer;
  clients integer;
  uncovered integer;
begin
  select count(*) into carved from tmp_0088_carve_out;
  select count(distinct fs.subscriber_user_id) into clients
  from feed_subscriptions fs join tmp_0088_carve_out c on c.id = fs.id;

  for r in
    select fs.id, coalesce(u.email, u.display_name, fs.subscriber_user_id::text) as subscriber,
           ft.tier_key, fs.status, fs.ends_at
    from tmp_0088_carve_out c
    join feed_subscriptions fs on fs.id = c.id
    left join users u on u.id = fs.subscriber_user_id
    left join feed_tiers ft on ft.id = fs.feed_tier_id
    order by subscriber, ft.tier_key, fs.id
  loop
    raise notice 'step 5 carve-out: id=% subscriber=% tier=% status=% ends_at=%',
      r.id, r.subscriber, coalesce(r.tier_key, '(provider_tier)'), r.status, r.ends_at;
  end loop;

  select count(*) into uncovered
  from feed_subscriptions fs
  where fs.server_registration_id is null and fs.status <> 'lapsed'
    and not exists (select 1 from tmp_0088_carve_out c where c.id = fs.id);
  if uncovered != 0 then
    for r in
      select fs.id, coalesce(u.email, u.display_name, fs.subscriber_user_id::text) as subscriber,
             ft.tier_key, fs.status, fs.ends_at
      from feed_subscriptions fs
      left join users u on u.id = fs.subscriber_user_id
      left join feed_tiers ft on ft.id = fs.feed_tier_id
      where fs.server_registration_id is null and fs.status <> 'lapsed'
        and not exists (select 1 from tmp_0088_carve_out c where c.id = fs.id)
      order by subscriber, ft.tier_key, fs.id
    loop
      raise notice 'step 5 UNCOVERED no-server non-lapsed row: id=% subscriber=% tier=% status=% ends_at=%',
        r.id, r.subscriber, coalesce(r.tier_key, '(provider_tier)'), r.status, r.ends_at;
    end loop;
    raise exception 'step 5: % no-server non-lapsed row(s) are in neither the 4b lapse nor the carve-out (listed above); their ends_at equals this transaction''s now() exactly. Re-run: the next now() is past them', uncovered;
  end if;

  insert into tmp_0088_counts (k, v) values ('fs_carve_out', carved);
  insert into tmp_0088_counts (k, v) values ('fs_carve_out_clients', clients);
  raise notice 'step 5 carve-out ok: rows=% clients=% uncovered=0 (expected 6 / 2 / 0 on marcus m50350 08:41Z; any count is legitimate, the expectation is a read not a gate)',
    carved, clients;
end $$;

-- Every non-lapsed row now has a server, except the carve-out rows just named. The CHECK carries
-- them BY ID, built by `execute format` over tmp_0088_carve_out rather than from a literal list
-- written into this file (marcus m50350_mu0ztzip). By id because that is what cannot grow: id is
-- the uuid primary key, so no NEW row can enter the exception, every new live NULL-server row is
-- still refused, and the carried rows' own renewal UPDATEs pass. A predicate exception
-- (`or ends_at > now()`) would have been the loose shape -- it would let any new NULL-server row
-- in for as long as its ends_at is in the future, which is the thing 0086 header 80-86 asks this
-- constraint to stop. Empty carve-out => the plain two-branch form, and 0089 has nothing to
-- settle. Column stays nullable: a lapsed row may keep NULL server forever. Not `not valid`, and
-- not because of taste: Postgres re-checks every UPDATED row against a NOT VALID constraint, so a
-- carried client's renewal would fail 23514, a paying client cut by another route (fable 12:53Z).
-- Added AFTER the lapse, never before it (marcus m49852 item 3; the lapse is 4b's now).
-- The exception is removed by db/migrations/0089_drop_server_or_lapsed_exception.sql, which reads
-- the list back out of this constraint instead of carrying its own copy. Expected: notice with
-- the definition, and either 'carve-out ids=6' or 'NO exception' when the carve-out is empty.
do $$
declare
  ids text;
  carved integer;
begin
  select count(*) into carved from tmp_0088_carve_out;
  if carved = 0 then
    execute 'alter table feed_subscriptions'
         || ' add constraint feed_subscriptions_server_or_lapsed_chk'
         || ' check (status = ''lapsed'' or server_registration_id is not null)';
    raise notice 'step 5 CHECK added with NO exception: the carve-out is empty (nothing left non-lapsed with a NULL server)';
  else
    select string_agg(format('%L', c.id::text), ', ' order by c.id) into ids from tmp_0088_carve_out c;
    execute format('alter table feed_subscriptions'
                || ' add constraint feed_subscriptions_server_or_lapsed_chk'
                || ' check (status = ''lapsed'' or server_registration_id is not null'
                || ' or id in (%s))', ids);
    raise notice 'step 5 CHECK added with carve-out ids=%', carved;
  end if;
end $$;

-- Read the constraint back out of the catalog and prove it carries exactly the carve-out: every
-- carve-out id present in the text, and no uuid literal in the text that is not a carve-out id
-- (count equality does the second half -- the ids came from this table, so equal counts plus
-- total containment is set equality). Expected: notice 'step 5 CHECK ok: carve_out=6 literals=6'.
do $$
declare
  def text;
  missing integer;
  literals integer;
  carved integer;
begin
  select count(*) into carved from tmp_0088_carve_out;
  select pg_get_constraintdef(c.oid) into def
  from pg_constraint c
  where c.conrelid = 'feed_subscriptions'::regclass
    and c.conname = 'feed_subscriptions_server_or_lapsed_chk';
  if def is null then
    raise exception 'step 5 CHECK: feed_subscriptions_server_or_lapsed_chk is not in the catalog after ADD CONSTRAINT';
  end if;
  select count(*) into missing
  from tmp_0088_carve_out x
  where position(x.id::text in def) = 0;
  if missing != 0 then
    raise exception 'step 5 CHECK: % carve-out id(s) are not in the constraint text. Definition: %', missing, def;
  end if;
  select count(*) into literals
  from regexp_matches(def, '[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}', 'g');
  if literals != carved then
    raise exception 'step 5 CHECK: constraint text carries % uuid literal(s) but the carve-out has %. Definition: %', literals, carved, def;
  end if;
  raise notice 'step 5 CHECK ok: carve_out=% literals=% definition=%', carved, literals, def;
end $$;

-- ---------------------------------------------------------------------------------------
-- 6. PREFLIGHT D RE-RUN. THE 0081 INDEX DROP IS 0089's.
-- ---------------------------------------------------------------------------------------

-- Live (server, tier) duplicate groups on the stored column (0086 D computed them through the
-- mapping). Structurally 0 for rows WITH a server: feed_subscriptions_server_feed_tier_live_uidx
-- (0086:657-659) has covered every live row with a NOT NULL server since 0086. Rows with NULL
-- server are excluded from the count on purpose: the carve-out rows are (today) two subscribers
-- on the same three tiers, and GROUP BY folds their NULL servers into one group per tier (count
-- 2), a false duplicate the unique index itself never sees (NULLs are distinct there). 0086 D
-- had no such rows to meet (it computed the key through the mapping).
do $$
declare
  dup_groups integer;
begin
  select count(*) into dup_groups
  from (
    select fs.server_registration_id, fs.feed_tier_id
    from feed_subscriptions fs
    where fs.server_registration_id is not null
      and fs.feed_tier_id is not null and fs.status in ('trial', 'active')
    group by fs.server_registration_id, fs.feed_tier_id
    having count(*) > 1
  ) d;
  if dup_groups != 0 then
    raise exception 'step 6 preflight D: % live (server, tier) duplicate groups', dup_groups;
  end if;
  raise notice 'step 6 preflight D ok: live (server, tier) duplicate groups=0 (NULL-server rows excluded: the carve-out)';
end $$;

-- NOT dropped here: the 0081 licence-keyed twin feed_subscriptions_license_feed_tier_live_uidx
-- (fable v1.71 item 3, v1.75 (iv)). Carve-out rows have a NULL server, invisible to the
-- 0086 server-keyed index, and 0081's (license_id, feed_tier_id) is their only uniqueness cover
-- until they are bound or lapsed. db/migrations/0089_drop_server_or_lapsed_exception.sql reads
-- the carve-out back out of the live CHECK, re-keys those rows, gates on none of them live with a
-- NULL server, lapses the expired ones, re-adds the CHECK without the exception, drops 0081. If
-- the carve-out here is empty, 0089 finds no ids and does the constraint and index work alone.
-- The window check at
-- feed-subscriptions.ts:403-410 (REMOVAL POINT comment :392) therefore stays through 0088 and
-- is deleted with 0089, not with this file. No replacement index. The 0078 provider_tier twin
-- (feed_subscriptions_subscriber_provider_tier_live_uidx) is not touched.

-- ---------------------------------------------------------------------------------------
-- 7. server_registrations: user_id NOT NULL, then the owner FK (0086 header 74, 148-150)
-- ---------------------------------------------------------------------------------------

-- Expected: ALTER TABLE (gate = step 1), ALTER TABLE (additive: id is the PK, so the pair is
-- always unique), DO (drops the 0031 FK by lookup, notices its name), ALTER TABLE (composite FK).
alter table server_registrations
  alter column user_id set not null;

alter table licenses
  add constraint licenses_id_user_id_key unique (id, user_id);

do $$
declare
  fk record;
  found integer := 0;
begin
  for fk in
    select c.conname, array_length(c.conkey, 1) as ncols
    from pg_constraint c
    where c.conrelid = 'server_registrations'::regclass
      and c.confrelid = 'licenses'::regclass
      and c.contype = 'f'
  loop
    found := found + 1;
    if fk.ncols <> 1 then
      raise exception 'step 7: unexpected %-column FK % from server_registrations to licenses already present', fk.ncols, fk.conname;
    end if;
    execute format('alter table server_registrations drop constraint %I', fk.conname);
    raise notice 'step 7: dropped FK % (server_registrations.license_id -> licenses.id, 0031, on delete cascade)', fk.conname;
  end loop;
  if found <> 1 then
    raise exception 'step 7: expected exactly 1 FK from server_registrations to licenses, found %', found;
  end if;
end $$;

-- MATCH SIMPLE (default): a row with license_id NULL is not checked. on delete set null
-- (license_id) nulls only the licence column, so user_id NOT NULL survives a licence delete.
-- Column-list SET NULL needs Postgres >= 15. ON UPDATE stays NO ACTION. Cannot fail on data
-- this file did not name: step 1's owner gate is 0. unique (license_id) from 0031 stays plain.
alter table server_registrations
  add constraint server_registrations_license_owner_fkey
  foreign key (license_id, user_id) references licenses (id, user_id)
  on delete set null (license_id);

-- ---------------------------------------------------------------------------------------
-- 8. feed_subscriptions.request_id goes (0086 header 78-79)
-- ---------------------------------------------------------------------------------------

-- Step 2's gate repeated here so the DROP cannot be separated from its proof by a later edit.
-- Expected: notice, DROP INDEX (0079), ALTER TABLE (takes the 0078 FK to feed_tier_requests
-- with it, which is why this step precedes step 9).
do $$
declare
  with_request integer;
  unmapped integer;
begin
  select count(*) into with_request from feed_subscriptions where request_id is not null;
  select count(*) into unmapped
  from feed_subscriptions
  where request_id is not null and access_request_id is null;
  if unmapped != 0 then
    raise exception 'step 8 guard: % of % feed_subscriptions rows with request_id have no access_request_id', unmapped, with_request;
  end if;
  insert into tmp_0088_counts (k, v) values ('fs_request_id_rows_dropped', with_request);
  raise notice 'step 8 guard ok: rows with request_id=% unmapped=0; the column drops now', with_request;
end $$;

drop index if exists feed_subscriptions_request_tier_uidx;

alter table feed_subscriptions
  drop column if exists request_id;

-- ---------------------------------------------------------------------------------------
-- 9. THE 'provisioned' CARRY, THEN drop table feed_tier_requests LAST
-- ---------------------------------------------------------------------------------------

-- (server, tier, declared_ip, told_at = actioned_at). Packages expand exactly as step 2 does.
-- server_row_last_edited > told_at is the "IP may have changed since" flag, display only.
-- Expected: SELECT <provisioned rows expanded by package membership> (0086 apply printed
-- provisioned_to_map=<n>; 0 rows on prod as read 2026-09-12 23:22Z).
create temp table tmp_0088_carry on commit drop as
select ftr.id as legacy_id,
       coalesce(u.email, u.display_name, u.id::text) as requester,
       ftr.tier_key as requested_key,
       ft.tier_key as member_key,
       sr.id as server_registration_id,
       ft.id as feed_tier_id,
       sr.declared_ip as ip,
       ftr.actioned_at as told_at,
       sr.updated_at as server_row_last_edited
from feed_tier_requests ftr
left join users u on u.id = ftr.user_id
join server_registrations sr on sr.license_id = ftr.license_id
join feed_tiers ft
  on ft.tier_key = ftr.tier_key
  or (ftr.tier_key = 'ld-retail-package' and ft.tier_key in ('ld-beta-56', 'ld-gamma-19', 'ld-delta-18'))
  or (ftr.tier_key = 'ny-retail-package' and ft.tier_key in ('ny-fast', 'ny-normal'))
where ftr.status = 'provisioned'
order by requester, ftr.actioned_at, ft.tier_key;

-- Guards, each abort-with-names: (a) every provisioned row has a server row (0086 preflight C
-- blocked on this class; re-checked because a row could have been actioned in the window);
-- (b) every provisioned row has actioned_at not null (told_at has no fallback; a NULL is a date
-- for a human to supply, not a default); (c) every provisioned row's tier_key resolves to >= 1
-- feed_tiers row. Then the INSERT (skip where an open same-IP record exists = a legacy grant
-- ALSO re-approved through the new path since the deploy; PK conflict does nothing) and the
-- post gate: every distinct (server, tier, ip) in the carry has an open record.
do $$
declare
  r record;
  provisioned integer;
  no_server integer;
  no_actioned integer;
  no_tier integer;
  enumerated integer;
  inserted integer;
  misses integer;
begin
  select count(*) into provisioned from feed_tier_requests where status = 'provisioned';

  select count(*) into no_server
  from feed_tier_requests ftr
  left join server_registrations sr on sr.license_id = ftr.license_id
  where ftr.status = 'provisioned' and sr.id is null;

  select count(*) into no_actioned
  from feed_tier_requests ftr
  where ftr.status = 'provisioned' and ftr.actioned_at is null;

  select count(*) into no_tier
  from feed_tier_requests ftr
  where ftr.status = 'provisioned'
    and not exists (
      select 1 from feed_tiers ft
      where ft.tier_key = ftr.tier_key
         or (ftr.tier_key = 'ld-retail-package' and ft.tier_key in ('ld-beta-56', 'ld-gamma-19', 'ld-delta-18'))
         or (ftr.tier_key = 'ny-retail-package' and ft.tier_key in ('ny-fast', 'ny-normal'))
    );

  if no_server != 0 or no_actioned != 0 or no_tier != 0 then
    for r in
      select ftr.id, coalesce(u.email, u.display_name, u.id::text) as requester, ftr.tier_key,
             ftr.actioned_at, (sr.id is null) as no_server_row
      from feed_tier_requests ftr
      left join users u on u.id = ftr.user_id
      left join server_registrations sr on sr.license_id = ftr.license_id
      where ftr.status = 'provisioned'
        and (sr.id is null or ftr.actioned_at is null
             or not exists (
               select 1 from feed_tiers ft
               where ft.tier_key = ftr.tier_key
                  or (ftr.tier_key = 'ld-retail-package' and ft.tier_key in ('ld-beta-56', 'ld-gamma-19', 'ld-delta-18'))
                  or (ftr.tier_key = 'ny-retail-package' and ft.tier_key in ('ny-fast', 'ny-normal'))))
      order by requester, ftr.created_at, ftr.id
    loop
      raise notice 'step 9 carry blocked: id=% requester=% tier=% actioned_at=% no_server_row=%',
        r.id, r.requester, r.tier_key, r.actioned_at, r.no_server_row;
    end loop;
    raise exception 'step 9: provisioned rows=% with no server row=% with actioned_at NULL=% with unresolvable tier_key=% (listed above)',
      provisioned, no_server, no_actioned, no_tier;
  end if;

  for r in
    select c.legacy_id, c.requester, c.requested_key, c.member_key, c.server_registration_id,
           c.feed_tier_id, c.ip, c.told_at, c.server_row_last_edited
    from tmp_0088_carry c
    order by c.requester, c.told_at, c.member_key
  loop
    raise notice 'step 9 carry: legacy_id=% requester=% requested=% member=% server=% tier=% ip=% told_at=% server_row_last_edited=%',
      r.legacy_id, r.requester, r.requested_key, r.member_key, r.server_registration_id,
      r.feed_tier_id, r.ip, r.told_at, r.server_row_last_edited;
  end loop;
  select count(*) into enumerated from tmp_0088_carry;

  insert into feed_allowlist_records (server_registration_id, feed_tier_id, ip, told_at)
  select c.server_registration_id, c.feed_tier_id, c.ip, c.told_at
  from tmp_0088_carry c
  where not exists (select 1 from feed_allowlist_records x
                    where x.server_registration_id = c.server_registration_id
                      and x.feed_tier_id = c.feed_tier_id and x.ip = c.ip and x.revoked_at is null)
  on conflict (server_registration_id, feed_tier_id, told_at) do nothing;
  get diagnostics inserted = row_count;

  select count(*) into misses
  from (select distinct c.server_registration_id, c.feed_tier_id, c.ip from tmp_0088_carry c) k
  where not exists (select 1 from feed_allowlist_records x
                    where x.server_registration_id = k.server_registration_id
                      and x.feed_tier_id = k.feed_tier_id and x.ip = k.ip and x.revoked_at is null);
  if misses != 0 then
    raise exception 'step 9: % distinct (server, tier, ip) carry key(s) have no open allowlist record after the insert', misses;
  end if;

  insert into tmp_0088_counts (k, v) values ('allowlist_carried', inserted);
  raise notice 'step 9 carry ok: provisioned rows=% enumerated=% inserted=% skipped (open same-IP record existed)=% misses=0',
    provisioned, enumerated, inserted, enumerated - inserted;
end $$;

-- Drop guard: any FK still pointing at the table is a reader this file missed (after step 8 the
-- 0078 FK is gone and 0086 created none). Step 3 passed or the transaction is already gone.
do $$
declare
  refs integer;
  legacy_rows integer;
begin
  select count(*) into refs from pg_constraint where confrelid = 'feed_tier_requests'::regclass;
  if refs != 0 then
    raise exception 'step 9 drop guard: % constraint(s) still reference feed_tier_requests', refs;
  end if;
  select count(*) into legacy_rows from feed_tier_requests;
  insert into tmp_0088_counts (k, v) values ('legacy_rows_dropped', legacy_rows);
  raise notice 'step 9 drop guard ok: constraints referencing feed_tier_requests=0; rows dropping with the table=%', legacy_rows;
end $$;

-- Expected: DROP TABLE (feed_tier_requests_user_id_idx and feed_tier_requests_status_idx go
-- with it).
drop table feed_tier_requests;

-- ---------------------------------------------------------------------------------------
-- 10. SUMMARY, THEN THE LEDGER ROW
-- ---------------------------------------------------------------------------------------

-- Expected: one row. sr_user_id_null=0 sr_owner_mismatch=0 fs_no_server_live=fs_carve_out (equal
-- by construction: the carve-out was read from exactly that predicate after the 4b lapse, and
-- nothing between here and there writes feed_subscriptions) fs_request_id_column_present=false
-- ftr_table_present=false; the rest are counts to paste. Today's expected counts, from marcus's
-- prod read of 2026-09-14 08:41Z (m50350_mu0ztzip) narrowed by his Z1 ruling (m50396_mu10majx),
-- are NOT gates: fs_predicate_lapsed=18, fs_predicate_lapsed_clients=6, fs_carve_out=6,
-- fs_carve_out_clients=2, fs_no_server_listed=27.
select
  (select count(*) from server_registrations where user_id is null) as sr_user_id_null,
  (select count(*) from server_registrations sr join licenses l on l.id = sr.license_id
     where sr.user_id is distinct from l.user_id) as sr_owner_mismatch,
  (select count(*) from feed_subscriptions
     where server_registration_id is null and status <> 'lapsed'
       and (ends_at > now() or ends_at is null)) as fs_no_server_live,
  (select v from tmp_0088_counts where k = 'fs_no_server_listed') as fs_no_server_listed,
  (select v from tmp_0088_counts where k = 'fs_carve_out') as fs_carve_out,
  (select v from tmp_0088_counts where k = 'fs_carve_out_clients') as fs_carve_out_clients,
  (select v from tmp_0088_counts where k = 'fs_predicate_lapsed') as fs_predicate_lapsed,
  (select v from tmp_0088_counts where k = 'fs_predicate_lapsed_clients') as fs_predicate_lapsed_clients,
  (select v from tmp_0088_counts where k = 'fs_lapsed_by_word') as fs_lapsed_by_word,
  (select exists (select 1 from information_schema.columns
                  where table_name = 'feed_subscriptions' and column_name = 'request_id')) as fs_request_id_column_present,
  (select to_regclass('feed_tier_requests') is not null) as ftr_table_present,
  (select v from tmp_0088_counts where k = 'allowlist_carried') as allowlist_carried,
  (select v from tmp_0088_counts where k = 'allowlist_carried_by_word') as allowlist_carried_by_word,
  (select count(*) from feed_allowlist_records where revoked_at is null) as allowlist_open_total,
  (select count(*) from access_requests) as access_requests_rows,
  (select v from tmp_0088_counts where k = 'legacy_no_envelope_rejected') as legacy_no_envelope_rejected,
  (select v from tmp_0088_counts where k = 'fs_request_id_rows_dropped') as fs_request_id_rows_dropped,
  (select v from tmp_0088_counts where k = 'legacy_rows_dropped') as legacy_rows_dropped;

insert into schema_migrations (version, name) values
  ('0088', '0088_tighten.sql')
on conflict (version) do nothing;

commit;
