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
-- WHAT THIS DOES, IN ORDER (0086 header 93-97: re-run the section 1 / 3 / 4 backfills and gates,
-- re-run preflight D over the completed mapping, then SET NOT NULL, the CHECK, the 0081 index drop;
-- then the three statements the old table's retirement needs):
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
--      without the word aborts at step 3 / step 5 as designed. EMPTY BY DEFAULT. Three shapes
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
--   5. Every feed_subscriptions row with server_registration_id NULL, one notice per row. Live =
--      `status <> 'lapsed' and (ends_at > now() or ends_at is null)`: count must be 0, else abort
--      with every row named (resolution is a real server row registered before the run, which
--      step 4 re-keys, or a worded lapse in 2b(b); no synthetic server row). Dead ones
--      (`status <> 'lapsed' and ends_at <= now()`) are stored lapsed inside the transaction,
--      lapsed_at = coalesce(lapsed_at, ends_at). Then
--        alter table feed_subscriptions add constraint feed_subscriptions_server_or_lapsed_chk
--          check (status = 'lapsed' or server_registration_id is not null);
--      Column stays nullable (0086 header 80-82). Not `not valid`.
--   6. Preflight D re-run on (server_registration_id, feed_tier_id) among live rows (must be 0),
--      then `drop index if exists feed_subscriptions_license_feed_tier_live_uidx` (0081). The
--      0086 index feed_subscriptions_server_feed_tier_live_uidx covers every live row after step
--      5's CHECK. No replacement index. The 0078 provider_tier twin is not touched.
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
--   - Does not add a no-server unique index: with the step-5 CHECK the set of live rows with
--     NULL server is empty by construction.
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

-- Staging for (b) and (c). Created on every run so the fixed blocks below and the summary can
-- count 0 when the slot is empty.
create temp table tmp_0088_lapse_by_word (id uuid primary key) on commit drop;

create temp table tmp_0088_carry_by_word (
  legacy_id uuid not null,
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
-- (b) worded lapse of a live no-server subscription (step 5's block set). lapsed_at = now(): a
--     decision, dated when taken. The other resolution needs NO literal: the client registers a
--     real server row before the run and step 4 re-keys the rows. Shape:
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

-- Fixed: apply (b). Every staged id must be a live no-server row (exactly step 5's block
-- predicate), else abort naming it: a worded lapse of any other row is a mistake, not a
-- disposition. Expected on an empty slot: staged=0 lapsed=0.
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
    raise exception 'step 2b(b): % of % staged lapse id(s) are not live no-server rows (listed above)', bad, staged;
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
-- 5. NULL-SERVER DISPOSITION, THEN THE CHECK (0086 header 80-86)
-- ---------------------------------------------------------------------------------------

-- One notice per NULL-server row, then: live rows (status <> 'lapsed' and (ends_at > now() or
-- ends_at is null); NULL ends_at = live) must be 0, else abort with every row named. Dead rows
-- (status <> 'lapsed' and ends_at <= now()) are stored lapsed, lapsed_at = coalesce(lapsed_at,
-- ends_at): the truthful instant is the seeded end. Their computed status does not move (they
-- already compute lapsed through the licence branch); stored now agrees with computed.
-- The operator pastes every 'step 5 no server:' line.
-- Expected today: live=6 (two subscribers x 3 tiers, both without a server row) -> abort here
-- until they are resolved; with them resolved, lapsed_now = the dead no-server rows.
do $$
declare
  r record;
  listed integer := 0;
  live integer;
  lapsed_now integer;
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

  select count(*) into live
  from feed_subscriptions
  where server_registration_id is null and status <> 'lapsed'
    and (ends_at > now() or ends_at is null);
  if live != 0 then
    for r in
      select fs.id, coalesce(u.email, u.display_name, u.id::text) as subscriber,
             ft.tier_key, fs.status, fs.ends_at
      from feed_subscriptions fs
      join users u on u.id = fs.subscriber_user_id
      left join feed_tiers ft on ft.id = fs.feed_tier_id
      where fs.server_registration_id is null and fs.status <> 'lapsed'
        and (fs.ends_at > now() or fs.ends_at is null)
      order by subscriber, ft.tier_key, fs.id
    loop
      raise notice 'step 5 BLOCK live no server: id=% subscriber=% tier=% status=% ends_at=%',
        r.id, r.subscriber, coalesce(r.tier_key, '(provider_tier)'), r.status, r.ends_at;
    end loop;
    raise exception 'step 5: % live feed_subscriptions row(s) with no server row (listed above); resolution is a real server row registered before the run, or a worded lapse in 2b(b)', live;
  end if;

  update feed_subscriptions
  set status = 'lapsed', lapsed_at = coalesce(lapsed_at, ends_at), updated_at = now()
  where server_registration_id is null and status <> 'lapsed' and ends_at <= now();
  get diagnostics lapsed_now = row_count;

  insert into tmp_0088_counts (k, v) values ('fs_no_server_lapsed_now', lapsed_now);
  raise notice 'step 5 ok: no-server rows listed=% live=0 lapsed_now=%', listed, lapsed_now;
end $$;

-- Every non-lapsed row now has a server. Column stays nullable: a lapsed row may keep NULL
-- server forever. Not `not valid`: the failure above is ours, named, before Postgres's.
-- Expected: ALTER TABLE.
alter table feed_subscriptions
  add constraint feed_subscriptions_server_or_lapsed_chk
  check (status = 'lapsed' or server_registration_id is not null);

-- ---------------------------------------------------------------------------------------
-- 6. PREFLIGHT D RE-RUN, THEN DROP THE 0081 INDEX
-- ---------------------------------------------------------------------------------------

-- Live (server, tier) duplicate groups on the stored column (0086 D computed them through the
-- mapping). Structurally 0: feed_subscriptions_server_feed_tier_live_uidx (0086:657-659) has
-- covered every live row with a NOT NULL server since 0086, and after step 5's CHECK every live
-- row has one.
do $$
declare
  dup_groups integer;
begin
  select count(*) into dup_groups
  from (
    select fs.server_registration_id, fs.feed_tier_id
    from feed_subscriptions fs
    where fs.feed_tier_id is not null and fs.status in ('trial', 'active')
    group by fs.server_registration_id, fs.feed_tier_id
    having count(*) > 1
  ) d;
  if dup_groups != 0 then
    raise exception 'step 6 preflight D: % live (server, tier) duplicate groups', dup_groups;
  end if;
  raise notice 'step 6 preflight D ok: live (server, tier) duplicate groups=0';
end $$;

-- The 0081 licence-keyed twin. Nothing in src names it in an ON CONFLICT (the two mentions at
-- 9e84f16 are comments; the window check at feed-subscriptions.ts:403-410 is a plain SELECT and
-- keeps working until the cleanup commit removes it). No replacement index. The 0078
-- provider_tier twin (feed_subscriptions_subscriber_provider_tier_live_uidx) is not touched.
-- Expected: DROP INDEX.
drop index if exists feed_subscriptions_license_feed_tier_live_uidx;

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

-- Expected: one row. sr_user_id_null=0 sr_owner_mismatch=0 fs_no_server_live=0
-- fs_request_id_column_present=false ftr_table_present=false; the rest are counts to paste.
select
  (select count(*) from server_registrations where user_id is null) as sr_user_id_null,
  (select count(*) from server_registrations sr join licenses l on l.id = sr.license_id
     where sr.user_id is distinct from l.user_id) as sr_owner_mismatch,
  (select count(*) from feed_subscriptions
     where server_registration_id is null and status <> 'lapsed'
       and (ends_at > now() or ends_at is null)) as fs_no_server_live,
  (select v from tmp_0088_counts where k = 'fs_no_server_lapsed_now') as fs_no_server_lapsed_now,
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
