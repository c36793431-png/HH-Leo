-- APPLIED IN PRODUCTION 2026-09-12 17:30Z (Neon, one transaction; coxwell approval); see merge 0a493be
-- 0086_marketplace_recut.sql -- phase 1 of 4 of the marketplace recut. Written by kai on
-- branch kai/marketplace-recut-migration-2026-09-12, thread kai-marketplace-feed-product-2026-09-12
-- (build spec m48548, survey m48546). Design: provisioning ledger v1.47/v1.48, SHAs 304c41a and
-- cc7f38b; coxwell decisions 2026-09-10 and 2026-09-12 (request-based marketplace, no checkout,
-- manual billing). Marcus applies this in prod after ledger review and coxwell approval; kai does
-- not touch prod. Companion rollback: db/migrations/0086_rollback.sql (not run automatically).
--
-- Migration number 0086: 0085 is client_heartbeats on Leo's branch (not in origin/main as of
-- 2026-09-12); this file does not collide with it.
--
-- WHAT THIS DOES, IN ORDER
--   0. Preflights (DO blocks, read-only, raise = whole transaction aborts):
--      A. every server_registrations row resolves to a licence with a non-null user_id
--      B. every feed_subscriptions row resolves to a licenses row (abort otherwise). A licence
--         with no server_registrations row is NOT fatal (ledger v1.52 named exception: the
--         0081 London-backfill clients, provisioned by the legacy tick with no registered
--         server, request_id NULL): counted here, left with server_registration_id NULL in
--         section 4, named in section 6. "At most one" server row per licence is structural
--         (0031 unique(license_id)); this checks the licence exists and counts the no-server set.
--      C. every feed_tier_requests row resolves to a server row, OR matches the ledger v1.54
--         skip predicate, which is written ONCE, in the temp table tmp_0086_skipped_requests
--         created immediately before C (inside the transaction): no server row AND status in
--         ('pending', 'rejected') AND, if pending, the bound licence's expires_at <= now() AND
--         zero feed_subscriptions rows cite the request by request_id. Skipped rows are named
--         in C and again in section 6, get no envelope in section 3, and are counted in the
--         summary (ftr_skipped); the same temp table feeds all four readers. Any other
--         no-server request row ABORTS C, named (id, requester, tier_key, status, created_at,
--         licence expires_at). Every tier_key must resolve to >= 1 feed_tiers row (directly,
--         or via the two package literals expanded inline); that abort is strict and covers
--         skipped rows too.
--      D. no live (server, tier) duplicate would violate the new business-key index
--   1. server_registrations: add user_id (backfilled from licenses.user_id); license_id nullable.
--   2. access_requests envelope + feed_tier_request_details + software_request_details.
--   3. Copy feed_tier_requests -> envelope + detail, EXCLUDING the rows in
--      tmp_0086_skipped_requests (ledger v1.54). Package literals expand to N envelopes
--      sharing one batch_id. Idempotent (deterministic ids, upsert on id, and the upsert never
--      overwrites an envelope already decided through the new code) so it can be re-run at the
--      phase 2 cutover to pick up rows the old code wrote in between. GATED: legacy rows with
--      >= 1 envelope = legacy_rows - skipped (skipped recomputed in-transaction from the temp
--      table), and envelopes = details. Then feed_subscriptions.access_request_id (nullable FK
--      to access_requests) is added and backfilled from request_id at tier grain, GATED: zero
--      unmapped where request_id is set.
--   4. feed_subscriptions: add server_registration_id (backfilled via licence -> server row;
--      stays NULL where the licence has no server row, noticed with a count that must equal
--      preflight B's), add ends_at (non-trial rows from the bound licence's expires_at, which
--      needs no server row, so the no-server rows are seeded too and the already-expired ones
--      also show in section 6's past-ends_at listing; trial rows from the trial's own
--      feed_tier_trials.trial_ends_at, else left NULL and named in section 6;
--      GATED: zero active rows with ends_at NULL), license_id nullable, new live business-key
--      index on (server_registration_id, feed_tier_id) created ALONGSIDE the 0081 one, drop
--      any composite FK to licenses(id, user_id) if one exists.
--   5. feed_allowlist_records -- the allowlist of record (what IP the provider was told, when).
--   6. Named listing (one notice line per row) of every live row whose ends_at is already
--      past, every trial row left with ends_at NULL, every row left with no server row, and
--      every legacy request row skipped under v1.54 (read from tmp_0086_skipped_requests),
--      the summary counts, then the schema_migrations row.
--
-- DEPLOY ORDER -- READ BEFORE APPLYING. Three live write paths do not know the new columns:
--     src/lib/server-registration.ts:158-185   insert ... on conflict (license_id)   (no user_id)
--     src/lib/feed-subscriptions.ts:272         insert into feed_subscriptions        (no server_registration_id)
--     src/lib/feed-subscriptions.ts:784         insert into feed_subscriptions        (no server_registration_id)
--   Because of that, this file reaches the ledger's target schema in TWO steps, the same
--   two-migrations-code-in-between order Fable set for 0079 -> code -> 0080:
--     (i)   this file: additive. user_id is backfilled to zero nulls and GATED;
--           server_registration_id is backfilled and GATED to "NULL only where the licence has
--           no server row" (preflight B's count); NOT NULL / the CHECK below are not yet
--           declared; the new live index sits beside the 0081 one; the 0031 unique(license_id)
--           CONSTRAINT is kept, not swapped for a partial index.
--     (ii)  code: phase 2 (kai, lib/access-requests.ts + approval path) and Leo's /account/servers
--           follow-up write user_id and server_registration_id on every insert.
--     (iii) tighten migration (number assigned by marcus after Leo's 0085 lands), applied once
--           (ii) is live. Target statements, so the end state is on record here:
--             alter table server_registrations alter column user_id set not null;
--             alter table feed_subscriptions add constraint feed_subscriptions_server_or_lapsed_chk
--               check (status = 'lapsed' or server_registration_id is not null);
--             drop index feed_subscriptions_license_feed_tier_live_uidx;
--             -- and, once phase 2 has cut every reader over: drop table feed_tier_requests
--             -- (feed_subscriptions.request_id drops with it, not here).
--           feed_subscriptions.server_registration_id is deliberately NOT `set not null` (ledger
--           v1.52): SET NOT NULL is column-wide and would fail on a lapsed row with NULL server
--           forever, so three dead licences would hold the tighten hostage. The tighten's
--           preflight lists every still-NULL server_registration_id row; live ones
--           (ends_at > now()) block the tighten until resolved; dead ones (ends_at <= now()) are
--           stored status='lapsed' inside the tighten transaction, which makes stored status
--           agree with computed, and the CHECK then holds. server_registrations.user_id keeps
--           `set not null` as above; both request-detail tables already declare NOT NULL on
--           their key columns in section 2 and keep it.
--           Legacy request rows skipped under ledger v1.54 (no envelope): the tighten's
--           preflight lists every legacy request row with no envelope (id, requester, tier,
--           status, created_at, licence expires_at). A pending one blocks the tighten until
--           coxwell's word disposes it; a rejected one drops with the table.
--           This list is NOT the file the tighten gets written from. The tighten file will:
--           re-run the section 1 and section 4 backfills and their gates (rows the old code
--           wrote between apply and (ii) have NULL user_id / server_registration_id), re-run
--           preflight D over the completed mapping, and only then SET NOT NULL on user_id, add
--           the CHECK, and drop the 0081 index. The 0031 unique(license_id) constraint is kept
--           as-is: a plain UNIQUE on a nullable column already permits any number of NULL
--           license_id rows (NULLS
--           DISTINCT is the Postgres default), so no partial-index swap is needed (ledger
--           v1.49). Declaring NOT NULL in THIS file would make the three inserts above fail
--           with not_null_violation from the moment of apply until (ii) deploys (server
--           registration form, admin direct grant, request approval). Two-step accepted, ledger
--           v1.49.
--
-- READ-ONLY, NOT LOCKED: feed_tier_requests stays writable at the DB level. The live request
-- form (feed-tier-requests.ts:109) and admin decision path (:164, :263) still write it until
-- phase 2 cuts over; a DB-level lock (trigger/REVOKE) would break both. "Read-only" is a code
-- rule from phase 2 onward: no NEW code writes it. Section 3 is re-runnable for exactly this
-- reason -- run it once more inside the phase 2 cutover, then the tighten migration drops it.
--
-- feed_tiers.provider_user_id is NOT the truth for provider ownership today (ledger section
-- 3.0, phase 2 routing item): it is nullable, on delete set null (0058), and the package
-- literals (ld-retail-package, ny-retail-package) have no feed_tiers row at all. Nothing in this
-- file reads it for routing. Provider ownership routing lands in phase 2.
--
-- ADDITIONS BEYOND THE SPEC'S COLUMN LIST, each flagged for Fable to strike or keep:
--   a. access_requests.legacy_feed_tier_request_id uuid (no FK, indexed): which
--      feed_tier_requests row an envelope was copied from. Needed so phase 2 can repoint
--      feed_subscriptions.request_id (FK to feed_tier_requests, 0078) row-by-row before the old
--      table is dropped. No FK on purpose so the later drop table needs no cascade.
--   b. access_requests.reason text: feed_tier_requests.reason is the ADMIN's decision reason
--      (written at feed-tier-requests.ts:164 alongside the status flip). Dropping it on copy
--      would lose the only stored reason for every past rejection.
--   c. software_request_details.product_id is text, not a FK: there is no software product
--      table in 0001-0084 and no product notion in src/ (grep product_id/productId: 0 hits).
--      Per Q7 a software product is a licence tier, so the value space is licenses.tier's
--      vocabulary ('trial','paid','team','deal', 0013) until a product table exists.
--   d. access_requests.status vocabulary is ('pending','approved','rejected'). The old
--      'provisioned' (0034) maps to 'approved' on copy; provisioning state now lives in
--      feed_allowlist_records, not the request status. Preflight C reports how many rows this
--      touches (notice, not abort).
--   e. feed_allowlist_records.ip is text, matching server_registrations.declared_ip (0031),
--      since equality against that column is the read that matters. inet would validate the
--      literal; say so and it is a one-word change.
--
-- WHAT THIS DOES NOT DO (phase 2+ or Fable's call):
--   - No cross-table check that an envelope of product_kind X has exactly one detail row of
--     kind X. Postgres cannot express it declaratively; phase 2 writes envelope + detail in one
--     transaction and the read side joins by kind.
--   - No DB-level uniqueness on pending (server, tier) requests: the envelope status and the
--     detail key live in different tables. "Collision with a live (server, tier) fails the
--     whole insert loudly" is enforced by phase 2 code against
--     feed_subscriptions_server_feed_tier_live_uidx inside the batch transaction.
--   - feed_subscriptions.request_id (FK to feed_tier_requests, 0078) is NOT dropped or
--     repointed here; it goes with the old table in the tighten. access_request_id (Q9, ruled
--     v1.49: add now, additive) sits beside it -- see section 3.
--   - server_registrations.license_id keeps `on delete cascade` (0031) in THIS file. The switch
--     to `on delete set null` (key-on-the-server: a deleted licence must not delete the server)
--     is in the tighten migration, ruled ledger v1.49 5(b).
--   - ends_at is copied for lapsed rows too (harmless: records the licence expiry the row was
--     last gated by). Liveness = status + ends_at > now() is phase 2's read-side change; the
--     gate here is NULL-ness on active rows, not futurity -- a live row whose licence (or
--     trial) has already expired gets a past ends_at, which is the truthful value, and
--     section 6 names every such row so coxwell sees them before the flip.
--
-- Expected result per statement is in the section comments. Every DO block either raises or
-- emits a `notice` line with its counts -- marcus, paste those lines into the thread.

begin;

-- ---------------------------------------------------------------------------------------
-- 0. PREFLIGHTS
-- ---------------------------------------------------------------------------------------

-- A. server_registrations -> licence -> user_id must resolve for every row (licenses.user_id
--    is nullable, on delete set null, 0001). Needed for section 1's backfill.
do $$
declare
  total integer;
  unresolved integer;
begin
  select count(*) into total from server_registrations;
  select count(*) into unresolved
  from server_registrations sr
  left join licenses l on l.id = sr.license_id
  where l.user_id is null;
  if unresolved != 0 then
    raise exception
      'preflight A: % of % server_registrations rows have no resolvable licence owner', unresolved, total;
  end if;
  raise notice 'preflight A ok: server_registrations total=% unresolved=0', total;
end $$;

-- B. feed_subscriptions -> licence must resolve for every row (a license_id with no licenses
--    row is a different defect and stays fatal). licence -> server_registrations row is NOT
--    required (ledger v1.52 named exception): a licence with no server row is counted here,
--    left NULL by section 4's backfill (which must report the same count) and named in
--    section 6. At most one server row per licence is structural (0031 unique(license_id)).
do $$
declare
  total integer;
  no_licence integer;
  no_server integer;
begin
  select count(*) into total from feed_subscriptions;
  select count(*) into no_licence
  from feed_subscriptions fs
  left join licenses l on l.id = fs.license_id
  where l.id is null;
  if no_licence != 0 then
    raise exception
      'preflight B: % of % feed_subscriptions rows have no licenses row for their license_id', no_licence, total;
  end if;
  select count(*) into no_server
  from feed_subscriptions fs
  left join server_registrations sr on sr.license_id = fs.license_id
  where sr.id is null;
  if no_server != 0 then
    raise notice
      'preflight B: % of % feed_subscriptions rows have no server row for their licence (named in section 6)', no_server, total;
  end if;
  raise notice 'preflight B ok: feed_subscriptions total=% no_licence=0 no_server=%', total, no_server;
end $$;

-- C0. The v1.54 skip predicate, written ONCE. A feed_tier_requests row with no server row is
--     SKIPPED (no envelope, named, counted) iff ALL of:
--       (1) status in ('pending', 'rejected');
--       (2) if status = 'pending', the bound licence's expires_at <= now();
--       (3) zero feed_subscriptions rows have request_id = that row's id.
--     Rationale on record (ledger v1.54): pending on a live licence = an open request a human
--     must chase or reject; approved/provisioned with no server = the vendor was told an IP
--     this database never held (Q25's class), never a skip. 'rejected' is inside the predicate
--     so rejecting the row via the admin action before the prod run cannot re-block C.
--     A pending row whose license_id resolves to no licenses row has a NULL expires_at, fails
--     (2), and therefore blocks. Preflight C, section 3, section 6 and the summary all read
--     this table; none restates the predicate. Temp table is on commit drop, inside the
--     transaction, so now() is the transaction's timestamp throughout.
-- Expected: SELECT <skipped count>.
create temp table tmp_0086_skipped_requests on commit drop as
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
  and not exists (select 1 from feed_subscriptions fs where fs.request_id = ftr.id);

-- C. feed_tier_requests: every row resolves to a server row or sits in
--    tmp_0086_skipped_requests (skipped, named below, continue); any other no-server row is
--    blocking (named below, abort). Every tier_key resolves to >= 1 feed_tiers row (directly,
--    or via the package literals -- same expansion as PACKAGE_TIER_KEYS at
--    src/lib/feed-tier-catalogue.ts:58-61, repeated here as SQL because a migration cannot
--    import TypeScript; if that map changes, this block AND section 3's join must change
--    too); that abort is strict and unchanged, skipped rows included. Source as of branch head:
--      "ld-retail-package": ["ld-beta-56", "ld-gamma-19", "ld-delta-18"]
--      "ny-retail-package": ["ny-fast", "ny-normal"]
--    The NY set was never on the provisioning ledger; it is taken from that source line only.
do $$
declare
  r record;
  total integer;
  skipped integer;
  blocking integer;
  no_tier integer;
  provisioned integer;
begin
  select count(*) into total from feed_tier_requests;

  select count(*) into skipped from tmp_0086_skipped_requests;

  select count(*) into blocking
  from feed_tier_requests ftr
  left join server_registrations sr on sr.license_id = ftr.license_id
  where sr.id is null
    and not exists (select 1 from tmp_0086_skipped_requests s where s.id = ftr.id);

  select count(*) into no_tier
  from feed_tier_requests ftr
  where not exists (
    select 1 from feed_tiers ft
    where ft.tier_key = ftr.tier_key
       or (ftr.tier_key = 'ld-retail-package' and ft.tier_key in ('ld-beta-56', 'ld-gamma-19', 'ld-delta-18'))
       or (ftr.tier_key = 'ny-retail-package' and ft.tier_key in ('ny-fast', 'ny-normal'))
  );

  select count(*) into provisioned from feed_tier_requests where status = 'provisioned';

  if skipped != 0 then
    for r in
      select s.id, s.requester, s.tier_key, s.status, s.created_at, s.licence_expires_at
      from tmp_0086_skipped_requests s
      order by s.requester, s.created_at, s.id
    loop
      raise notice 'preflight C skipped: id=% requester=% tier=% status=% created_at=% licence_expires_at=%',
        r.id, r.requester, r.tier_key, r.status, r.created_at, r.licence_expires_at;
    end loop;
    raise notice 'preflight C: % of % feed_tier_requests rows skipped under ledger v1.54 (listed above; no envelope; named again in section 6)',
      skipped, total;
  end if;

  if blocking != 0 then
    for r in
      select ftr.id, coalesce(u.email, u.display_name, u.id::text) as requester,
             ftr.tier_key, ftr.status, ftr.created_at, l.expires_at as licence_expires_at
      from feed_tier_requests ftr
      left join users u on u.id = ftr.user_id
      left join licenses l on l.id = ftr.license_id
      left join server_registrations sr on sr.license_id = ftr.license_id
      where sr.id is null
        and not exists (select 1 from tmp_0086_skipped_requests s where s.id = ftr.id)
      order by requester, ftr.created_at, ftr.id
    loop
      raise notice 'preflight C blocking: id=% requester=% tier=% status=% created_at=% licence_expires_at=%',
        r.id, r.requester, r.tier_key, r.status, r.created_at, r.licence_expires_at;
    end loop;
  end if;

  if blocking != 0 or no_tier != 0 then
    raise exception
      'preflight C: feed_tier_requests total=% skipped=% blocking (no server row, outside the v1.54 predicate)=% with unresolvable tier_key=%',
      total, skipped, blocking, no_tier;
  end if;
  raise notice 'preflight C ok: feed_tier_requests total=% skipped=% blocking=0 no_tier=0 provisioned_to_map=%',
    total, skipped, provisioned;
end $$;

-- D. The new live business key (server_registration_id, feed_tier_id) must have no duplicate
--    groups. Computed through the licence -> server mapping section 4 will write.
do $$
declare
  dup_groups integer;
begin
  select count(*) into dup_groups
  from (
    select sr.id as server_registration_id, fs.feed_tier_id
    from feed_subscriptions fs
    join server_registrations sr on sr.license_id = fs.license_id
    where fs.feed_tier_id is not null and fs.status in ('trial', 'active')
    group by sr.id, fs.feed_tier_id
    having count(*) > 1
  ) d;
  if dup_groups != 0 then
    raise exception 'preflight D: % live (server, tier) duplicate groups', dup_groups;
  end if;
  raise notice 'preflight D ok: live (server, tier) duplicate groups=0';
end $$;

-- ---------------------------------------------------------------------------------------
-- 1. server_registrations: key on the server, not the licence
-- ---------------------------------------------------------------------------------------

-- Expected: ALTER TABLE x2, UPDATE <total from preflight A>, notice, CREATE INDEX.
alter table server_registrations
  add column if not exists user_id uuid references users(id) on delete cascade;

-- updated_at deliberately untouched: it is shown as "last edited" in the admin panel and the
-- client did not edit anything.
update server_registrations sr
set user_id = l.user_id
from licenses l
where l.id = sr.license_id
  and sr.user_id is null;

do $$
declare
  unresolved integer;
begin
  select count(*) into unresolved from server_registrations where user_id is null;
  if unresolved != 0 then
    raise exception 'section 1: user_id backfill left % row(s) null', unresolved;
  end if;
  raise notice 'section 1 ok: server_registrations.user_id null rows=0';
end $$;

-- NOT NULL deferred to the tighten migration (see DEPLOY ORDER). unique(license_id) kept.
alter table server_registrations
  alter column license_id drop not null;

create index if not exists server_registrations_user_idx
  on server_registrations (user_id);

-- ---------------------------------------------------------------------------------------
-- 2. access_requests envelope + one detail table per product kind
-- ---------------------------------------------------------------------------------------

-- Expected: CREATE TABLE x3, CREATE INDEX x5.
create table if not exists access_requests (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references users(id) on delete cascade,
  product_kind text not null check (product_kind in ('feed_tier', 'software')),
  -- Grouping key only: the N rows one "Request Access" click produced. No batch status.
  batch_id uuid not null,
  status text not null default 'pending' check (status in ('pending', 'approved', 'rejected')),
  decision text check (decision in ('trial', 'paid')),
  ends_at timestamptz,
  invoice_ref text,
  reason text,
  decided_by uuid references users(id),
  decided_at timestamptz,
  legacy_feed_tier_request_id uuid,
  created_at timestamptz not null default now()
);

create index if not exists access_requests_user_idx
  on access_requests (user_id, created_at desc);
create index if not exists access_requests_status_idx
  on access_requests (status, created_at desc);
create index if not exists access_requests_batch_idx
  on access_requests (batch_id);
create index if not exists access_requests_legacy_idx
  on access_requests (legacy_feed_tier_request_id)
  where legacy_feed_tier_request_id is not null;

create table if not exists feed_tier_request_details (
  request_id uuid primary key references access_requests(id) on delete cascade,
  server_registration_id uuid not null references server_registrations(id),
  feed_tier_id uuid not null references feed_tiers(id)
);

create index if not exists feed_tier_request_details_server_tier_idx
  on feed_tier_request_details (server_registration_id, feed_tier_id);

create table if not exists software_request_details (
  request_id uuid primary key references access_requests(id) on delete cascade,
  product_id text not null
);

-- ---------------------------------------------------------------------------------------
-- 3. Copy feed_tier_requests -> envelope + detail (re-runnable at phase 2 cutover)
-- ---------------------------------------------------------------------------------------

-- Envelope id is deterministic: md5(legacy request id || tier id) cast to uuid, so a re-run
-- upserts the same rows. batch_id = the legacy request id (one legacy request = one batch;
-- a package request becomes N envelopes sharing it). Status/decision fields are refreshed on
-- conflict because the old table is the source of truth until cutover -- EXCEPT for an
-- envelope the NEW code has already decided (decided_at set through phase 2): the DO UPDATE
-- is guarded with WHERE access_requests.decided_at IS NULL so the cutover re-run cannot reset
-- a new-path decision back to the old table's pending. Free on first run (table is empty).
-- Old column map:
--   status 'provisioned' -> 'approved'; actioned_by -> decided_by; actioned_at -> decided_at;
--   reason -> reason; decision/ends_at/invoice_ref NULL (the old flow had no trial|paid step).
-- Two plain INSERTs off one temp table, not a data-modifying CTE: sub-statements in WITH share
-- one snapshot, so the detail rows' FK to envelopes inserted in the same statement is not
-- guaranteed to resolve on first run. Temp table is on commit drop.
-- Rows in tmp_0086_skipped_requests (ledger v1.54, predicate defined once before preflight C)
-- are excluded by anti-join: they get no envelope and no detail row.
-- Expected: SELECT <N> (temp), INSERT <N> (envelopes), INSERT <N> (details), notice.
create temp table tmp_0086_expanded on commit drop as
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
where not exists (select 1 from tmp_0086_skipped_requests s where s.id = ftr.id);

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
from tmp_0086_expanded e
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
from tmp_0086_expanded e
join server_registrations sr on sr.license_id = e.license_id
on conflict (request_id) do nothing;

-- GATE: every legacy row not skipped has >= 1 envelope and no skipped row has one, i.e. the
-- count of DISTINCT legacy ids carrying an envelope = legacy_rows - skipped (skipped recomputed
-- in-transaction from tmp_0086_skipped_requests). Distinct legacy ids, not envelope rows: a
-- package literal request is one legacy row with N envelopes, so envelope rows = legacy_rows
-- - skipped would abort on any package request. Plus envelopes = details.
do $$
declare
  legacy_rows integer;
  skipped integer;
  mapped_legacy integer;
  envelopes integer;
  details integer;
begin
  select count(*) into legacy_rows from feed_tier_requests;
  select count(*) into skipped from tmp_0086_skipped_requests;
  select count(distinct legacy_feed_tier_request_id) into mapped_legacy
  from access_requests where legacy_feed_tier_request_id is not null;
  select count(*) into envelopes from access_requests where legacy_feed_tier_request_id is not null;
  select count(*) into details
  from feed_tier_request_details d
  join access_requests a on a.id = d.request_id
  where a.legacy_feed_tier_request_id is not null;
  if envelopes != details then
    raise exception 'section 3: envelope/detail mismatch envelopes=% details=%', envelopes, details;
  end if;
  if mapped_legacy != legacy_rows - skipped then
    raise exception 'section 3: legacy rows with an envelope=% but legacy_rows - skipped = % - % = %',
      mapped_legacy, legacy_rows, skipped, legacy_rows - skipped;
  end if;
  raise notice 'section 3 ok: legacy_rows=% skipped=% legacy_rows_with_envelope=% envelopes=% details=%',
    legacy_rows, skipped, mapped_legacy, envelopes, details;
end $$;

-- feed_subscriptions.access_request_id (Q9, ruled v1.49): the grant identity on the new
-- envelope, at tier grain. Nullable now; phase 2 writes it on every approval. Backfilled where
-- request_id is set with the same deterministic envelope id as above,
-- md5(request_id || ':' || feed_tier_id)::uuid, joined to access_requests so a row whose
-- (request, tier) pair produced no envelope stays NULL and trips the gate instead of the FK.
-- request_id itself is not dropped here; it goes with feed_tier_requests in the tighten.
-- Expected: ALTER TABLE, UPDATE <rows with request_id set>, notice.
alter table feed_subscriptions
  add column if not exists access_request_id uuid references access_requests(id);

update feed_subscriptions fs
set access_request_id = a.id
from access_requests a
where fs.request_id is not null
  and fs.feed_tier_id is not null
  and a.id = md5(fs.request_id::text || ':' || fs.feed_tier_id::text)::uuid
  and fs.access_request_id is null;

-- GATE: zero unmapped where request_id is not null.
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
    raise exception
      'section 3 gate: % of % feed_subscriptions rows with request_id have no access_request_id', unmapped, with_request;
  end if;
  raise notice 'section 3 gate ok: feed_subscriptions with request_id=% unmapped=0', with_request;
end $$;

-- ---------------------------------------------------------------------------------------
-- 4. feed_subscriptions: server-keyed, licence-agnostic clock
-- ---------------------------------------------------------------------------------------

-- Expected: ALTER TABLE x3, UPDATE x3 (server_registration_id: <total minus no_server from
-- preflight B>; ends_at non-trial: <active+lapsed count>; ends_at trial: <trial rows with a trial row>,
-- 0 on prod as of 2026-09-12 01:07Z where status counts are active=35 lapsed=2 trial=0),
-- notice x2, CREATE INDEX, DO (drops a composite FK only if one exists; none in 0001-0084).
alter table feed_subscriptions
  add column if not exists server_registration_id uuid references server_registrations(id);

alter table feed_subscriptions
  add column if not exists ends_at timestamptz;

update feed_subscriptions fs
set server_registration_id = sr.id, updated_at = now()
from server_registrations sr
where sr.license_id = fs.license_id
  and fs.server_registration_id is null;

-- Rows whose licence has no server row stay NULL (ledger v1.52 named exception). The count
-- left NULL must equal the count of licences with no server row (the same set preflight B
-- reported); any other NULL means the backfill missed a row that does have a server, abort.
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
    raise exception 'section 4: server_registration_id backfill left % row(s) null but only % have no server row', left_null, no_server;
  end if;
  raise notice 'section 4 ok: feed_subscriptions.server_registration_id null rows=% (all with no server row; must equal preflight B; named in section 6)', left_null;
end $$;

-- ends_at for NON-trial rows := the bound licence's expires_at (coxwell may overwrite with
-- invoice dates later). Scoped to status <> 'trial' (v1.49 strike 3b): a trial row's clock is
-- the trial's own end, not the licence's -- seeding it from the licence would give an expired
-- trial on a live licence a future ends_at and pass it live after the flip.
update feed_subscriptions fs
set ends_at = l.expires_at, updated_at = now()
from licenses l
where l.id = fs.license_id
  and fs.status <> 'trial'
  and fs.ends_at is null;

-- ends_at for trial rows := feed_tier_trials.trial_ends_at (0036), joined the same way
-- EFFECTIVE_STATUS_SQL's trial branch does (feed-subscriptions.ts:118-124: subscriber_user_id
-- + the tier's tier_key; 0036 unique(user_id, tier_key) makes the match at most one). A trial
-- row with no feed_tier_trials row stays NULL and is NAMED in section 6, not aborted on.
-- Prod has trial=0 rows as of 2026-09-12 01:07Z; the scoping is written regardless.
update feed_subscriptions fs
set ends_at = ftt.trial_ends_at, updated_at = now()
from feed_tiers ft
join feed_tier_trials ftt on ftt.tier_key = ft.tier_key
where ft.id = fs.feed_tier_id
  and ftt.user_id = fs.subscriber_user_id
  and fs.status = 'trial'
  and fs.ends_at is null;

-- GATE (spec, m48548, scoped per 3b): zero ACTIVE rows with ends_at NULL or the migration
-- fails. Trial rows left NULL are counted here and listed by name in section 6.
do $$
declare
  active_null integer;
  trial_null integer;
begin
  select count(*) into active_null
  from feed_subscriptions
  where status = 'active' and ends_at is null;
  if active_null != 0 then
    raise exception 'section 4 gate: % active feed_subscriptions rows with ends_at NULL (expected 0)', active_null;
  end if;
  select count(*) into trial_null
  from feed_subscriptions
  where status = 'trial' and ends_at is null;
  raise notice 'section 4 gate ok: active rows with ends_at NULL=0; trial rows left with ends_at NULL=% (named in section 6)', trial_null;
end $$;

-- The check (status = 'lapsed' or server_registration_id is not null) is deferred to the
-- tighten migration (see DEPLOY ORDER); no NOT NULL on server_registration_id, ever.
alter table feed_subscriptions
  alter column license_id drop not null;

-- New live business key, created alongside feed_subscriptions_license_feed_tier_live_uidx
-- (0081 step 5). Cannot conflict: preflight D. The 0081 index is dropped in the tighten step.
create unique index if not exists feed_subscriptions_server_feed_tier_live_uidx
  on feed_subscriptions (server_registration_id, feed_tier_id)
  where feed_tier_id is not null and status in ('trial', 'active');

-- Composite FK feed_subscriptions -> licenses(id, user_id): none exists in migrations
-- 0001-0084 (only the single-column license_id FK from 0081). Dropped here only if one was
-- added out-of-band; the notice says which case applied.
do $$
declare
  fk record;
  dropped integer := 0;
begin
  for fk in
    select c.conname
    from pg_constraint c
    where c.conrelid = 'feed_subscriptions'::regclass
      and c.confrelid = 'licenses'::regclass
      and c.contype = 'f'
      and array_length(c.conkey, 1) > 1
  loop
    execute format('alter table feed_subscriptions drop constraint %I', fk.conname);
    dropped := dropped + 1;
    raise notice 'section 4: dropped composite FK %', fk.conname;
  end loop;
  raise notice 'section 4: composite FKs to licenses dropped=%', dropped;
end $$;

-- ---------------------------------------------------------------------------------------
-- 5. feed_allowlist_records: what IP the provider was told to allow, and when
-- ---------------------------------------------------------------------------------------

-- Written on approval (phase 2). revoked_at NULL = the provider has not been told to remove it.
-- Expected: CREATE TABLE, CREATE INDEX.
create table if not exists feed_allowlist_records (
  server_registration_id uuid not null references server_registrations(id),
  feed_tier_id uuid not null references feed_tiers(id),
  ip text not null,
  told_at timestamptz not null default now(),
  revoked_at timestamptz,
  primary key (server_registration_id, feed_tier_id, told_at)
);

create index if not exists feed_allowlist_records_open_idx
  on feed_allowlist_records (server_registration_id, feed_tier_id)
  where revoked_at is null;

-- ---------------------------------------------------------------------------------------
-- 6. Named listing for coxwell, post-migration counts, then the ledger row
-- ---------------------------------------------------------------------------------------

-- Every live row (status trial|active) whose seeded ends_at is already in the past, one
-- notice line each: id, subscriber, tier, status, ends_at. These are the rows phase 2's
-- read-side flip (liveness = status + ends_at > now()) will start reading as lapsed. coxwell
-- must see the names before the flip (v1.47 (b), v1.49 strike 3a); a count is not a name.
-- Then every trial row left with ends_at NULL (no feed_tier_trials row matched), same shape.
-- Then every row left with server_registration_id NULL (licence with no server row, ledger
-- v1.52 named exception), same shape, ordered by subscriber then tier; its count must equal
-- the summary's fs_no_server and preflight B's / section 4's count. A no-server row whose
-- licence has already expired appears in BOTH the past-ends_at and the no-server listing.
-- Then every legacy request row skipped under ledger v1.54, read from
-- tmp_0086_skipped_requests (id, requester, tier, status, created_at, licence expires_at),
-- ordered by requester then created_at then id; its count must equal preflight C's skipped,
-- section 3's skipped and the summary's ftr_skipped.
-- marcus: paste every '0086 past ends_at:', '0086 trial ends_at NULL:', '0086 no server:' and
-- '0086 request skipped:' line into the thread.
do $$
declare
  r record;
  past_rows integer := 0;
  null_trial_rows integer := 0;
  no_server_rows integer := 0;
  skipped_rows integer := 0;
begin
  for r in
    select fs.id, coalesce(u.email, u.display_name, u.id::text) as subscriber,
           ft.tier_key, fs.status, fs.ends_at
    from feed_subscriptions fs
    join users u on u.id = fs.subscriber_user_id
    left join feed_tiers ft on ft.id = fs.feed_tier_id
    where fs.status in ('trial', 'active') and fs.ends_at <= now()
    order by fs.ends_at, fs.id
  loop
    past_rows := past_rows + 1;
    raise notice '0086 past ends_at: id=% subscriber=% tier=% status=% ends_at=%',
      r.id, r.subscriber, coalesce(r.tier_key, '(provider_tier)'), r.status, r.ends_at;
  end loop;
  raise notice '0086 past ends_at: % live row(s) listed above', past_rows;

  for r in
    select fs.id, coalesce(u.email, u.display_name, u.id::text) as subscriber,
           ft.tier_key, fs.status
    from feed_subscriptions fs
    join users u on u.id = fs.subscriber_user_id
    left join feed_tiers ft on ft.id = fs.feed_tier_id
    where fs.status = 'trial' and fs.ends_at is null
    order by fs.id
  loop
    null_trial_rows := null_trial_rows + 1;
    raise notice '0086 trial ends_at NULL: id=% subscriber=% tier=% status=% (no feed_tier_trials row)',
      r.id, r.subscriber, coalesce(r.tier_key, '(provider_tier)'), r.status;
  end loop;
  raise notice '0086 trial ends_at NULL: % trial row(s) listed above', null_trial_rows;

  for r in
    select fs.id, coalesce(u.email, u.display_name, u.id::text) as subscriber,
           ft.tier_key, fs.status, fs.ends_at
    from feed_subscriptions fs
    join users u on u.id = fs.subscriber_user_id
    left join feed_tiers ft on ft.id = fs.feed_tier_id
    where fs.server_registration_id is null
    order by subscriber, ft.tier_key, fs.id
  loop
    no_server_rows := no_server_rows + 1;
    raise notice '0086 no server: id=% subscriber=% tier=% status=% ends_at=%',
      r.id, r.subscriber, coalesce(r.tier_key, '(provider_tier)'), r.status, r.ends_at;
  end loop;
  raise notice '0086 no server: % row(s) listed above', no_server_rows;

  for r in
    select s.id, s.requester, s.tier_key, s.status, s.created_at, s.licence_expires_at
    from tmp_0086_skipped_requests s
    order by s.requester, s.created_at, s.id
  loop
    skipped_rows := skipped_rows + 1;
    raise notice '0086 request skipped: id=% requester=% tier=% status=% created_at=% licence_expires_at=%',
      r.id, r.requester, r.tier_key, r.status, r.created_at, r.licence_expires_at;
  end loop;
  raise notice '0086 request skipped: % row(s) listed above', skipped_rows;
end $$;

select
  (select count(*) from server_registrations where user_id is null) as sr_user_id_null,
  (select count(*) from feed_subscriptions where server_registration_id is null) as fs_no_server,
  (select count(*) from feed_subscriptions where status = 'active' and ends_at is null) as fs_active_ends_at_null,
  (select count(*) from feed_subscriptions where status = 'trial' and ends_at is null) as fs_trial_ends_at_null,
  (select count(*) from feed_subscriptions where status in ('trial', 'active') and ends_at <= now()) as fs_live_ends_at_past,
  (select count(*) from feed_subscriptions where request_id is not null and access_request_id is null) as fs_request_unmapped,
  (select count(*) from access_requests) as access_requests_rows,
  (select count(*) from feed_tier_request_details) as feed_tier_detail_rows,
  (select count(*) from feed_tier_requests) as legacy_request_rows,
  (select count(*) from tmp_0086_skipped_requests) as ftr_skipped;

insert into schema_migrations (version, name) values
  ('0086', '0086_marketplace_recut.sql')
on conflict (version) do nothing;

commit;
