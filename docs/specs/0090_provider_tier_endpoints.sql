-- NOT APPLIED. 0090_provider_tier_endpoints.sql -- DESIGN CANDIDATE, thread
-- provider-tier-endpoints-2026-09-24 (marcus m53770_mufsp7zo). Written by kai on branch
-- kai/tier-endpoints-design-2026-09-24 off origin/main e4edea2. Design: docs/specs/0090-tier-endpoints-design.md.
-- Lives under docs/specs/ until fable passes the design; moves to db/migrations/ with the code
-- branch. Companion rollback: docs/specs/0090_rollback.sql. coxwell applies; neither coder writes
-- to prod.
--
-- Number 0090: 0087 is reserved (feed_tiers connection fields, parked), 0088/0089 are on
-- kai/tighten-0087-2026-09-12 (not applied). If marcus renumbers, the only literals that change
-- are the two '0090' strings in step 0 and step 6.
--
-- WHAT IT DOES: adds two child tables, one per parent, holding N connection endpoints per
-- listing, and backfills one child row per parent row that has any of the four scalar
-- connection columns set. The four parent columns (provider_tier_proposals.protocol/
-- endpoint_host/endpoint_port/compid, 0061:21-24; provider_tiers.endpoint_host/endpoint_port,
-- 0060:23-24, protocol/compid, 0083:54-55) and provider_tiers.endpoint_verified (0060:25) are
-- NOT dropped and NOT written here. main auto-deploys and this file is applied out of band, so
-- at the apply instant the live code still writes them (confirmProposalRound at
-- src/lib/provider-tier-proposals.ts:483-539 and registerProviderTiers at
-- src/lib/provider-tiers.ts:321-336, both at e4edea2). The drop is 0091, after the code that
-- reads the child tables is live and a re-run of step 4 shows zero drift.
--
-- ORDER OF OPERATIONS (three instants):
--   (i)   this file, dry-run with `rollback;` in place of `commit;`, paste every notice, then the
--         real run; the two pastes must be equal except the now() line.
--   (ii)  the code branch merges. Between (i) and (ii) old code keeps writing the parent columns.
--   (iii) step 4 ALONE re-run once after the (ii) deploy. It is idempotent (`not exists`) and
--         self-contained. Expected notices: `backfill proposals: inserted 0`,
--         `backfill tiers: inserted 0`, `drift rows: 0`. A non-zero drift row is printed with
--         both sides and is resolved by hand, never by this script.
--   Then 0091 (not written): gate child == parent on every row, drop the five parent columns.
--
-- One transaction. Every DO block either raises (whole transaction aborts) or emits a notice.
--
-- SECOND ADDRESS FOR AN EXISTING LIVE TIER (The Pip Dealer, tier dff16179...): not in this file,
-- values not known to kai. Template for coxwell, after (i), to run by hand with real values:
--   insert into provider_tier_endpoints (tier_id, position, protocol, endpoint_host, endpoint_port, compid, notes)
--   values ('<tier uuid>', 1, '<protocol>', '<host>', '<port>', '<compid or null>', '<notes or null>');
-- position 1 because the backfill put the stored cTrader address at position 0.

begin;

-- 0. Ledger preflight. 0083 present (provider_tiers.protocol/compid exist, this file reads
--    them), 0090 absent. The run's now() is the first notice of the run.
do $$
begin
  raise notice 'run now(): %', now();
  if not exists (select 1 from schema_migrations where version = '0083') then
    raise exception '0090 preflight: 0083 not in schema_migrations';
  end if;
  if exists (select 1 from schema_migrations where version = '0090') then
    raise exception '0090 preflight: 0090 already in schema_migrations';
  end if;
end $$;

-- 1. Child of provider_tier_proposals. Append-only like its parent (0061 header: one row per
--    round, never updated in place), so an endpoint row is never updated either; a new round is
--    a new proposal row with its own endpoint rows.
--    position: 0-based display order, unique per parent.
--    identity index: the four values coalesced to '' so it holds on any Postgres version without
--    `nulls not distinct`. Two rows differing only in notes are one endpoint and are refused.
--    nonempty check: a row with none of the four set is not an endpoint; notes alone is refused.
create table if not exists provider_tier_proposal_endpoints (
  id            uuid primary key default gen_random_uuid(),
  proposal_id   uuid not null references provider_tier_proposals(id) on delete cascade,
  position      smallint not null,
  protocol      text,
  endpoint_host text,
  endpoint_port text,
  compid        text,
  notes         text,
  created_at    timestamptz not null default now(),
  constraint provider_tier_proposal_endpoints_position_key unique (proposal_id, position),
  constraint provider_tier_proposal_endpoints_position_check check (position >= 0),
  constraint provider_tier_proposal_endpoints_nonempty_check
    check (num_nonnulls(protocol, endpoint_host, endpoint_port, compid) > 0)
);

create unique index if not exists provider_tier_proposal_endpoints_identity_uidx
  on provider_tier_proposal_endpoints
  (proposal_id, coalesce(protocol, ''), coalesce(endpoint_host, ''), coalesce(endpoint_port, ''), coalesce(compid, ''));

-- 2. Child of provider_tiers. Same shape plus endpoint_verified, which is "a claim about this
--    tier's specific endpoint_host:endpoint_port, not about the row" (src/lib/provider-tiers.ts:117-118
--    at e4edea2) and so belongs on the endpoint row, one claim per address.
create table if not exists provider_tier_endpoints (
  id                uuid primary key default gen_random_uuid(),
  tier_id           uuid not null references provider_tiers(id) on delete cascade,
  position          smallint not null,
  protocol          text,
  endpoint_host     text,
  endpoint_port     text,
  compid            text,
  notes             text,
  endpoint_verified boolean not null default false,
  created_at        timestamptz not null default now(),
  constraint provider_tier_endpoints_position_key unique (tier_id, position),
  constraint provider_tier_endpoints_position_check check (position >= 0),
  constraint provider_tier_endpoints_nonempty_check
    check (num_nonnulls(protocol, endpoint_host, endpoint_port, compid) > 0)
);

create unique index if not exists provider_tier_endpoints_identity_uidx
  on provider_tier_endpoints
  (tier_id, coalesce(protocol, ''), coalesce(endpoint_host, ''), coalesce(endpoint_port, ''), coalesce(compid, ''));

-- 3. Census before the backfill, printed so the paste shows what step 4 is about to do.
--    verified_no_address: provider_tiers rows with endpoint_verified = true and none of the four
--    set. They get no child row and the flag is not carried (it claims nothing without an
--    address). Counted and printed, not aborted. Expected 0.
do $$
declare
  p_src int; p_child int; t_src int; t_child int; t_vna int;
begin
  select count(*) into p_src from provider_tier_proposals
    where num_nonnulls(protocol, endpoint_host, endpoint_port, compid) > 0;
  select count(*) into p_child from provider_tier_proposal_endpoints;
  select count(*) into t_src from provider_tiers
    where num_nonnulls(protocol, endpoint_host, endpoint_port, compid) > 0;
  select count(*) into t_child from provider_tier_endpoints;
  select count(*) into t_vna from provider_tiers
    where endpoint_verified and num_nonnulls(protocol, endpoint_host, endpoint_port, compid) = 0;
  raise notice 'census before: proposals with any scalar %, proposal child rows %; tiers with any scalar %, tier child rows %; verified_no_address %',
    p_src, p_child, t_src, t_child, t_vna;
end $$;

-- 4. Backfill. One child row at position 0 per parent row that has any of the four set and has
--    no child row yet. The four are copied verbatim (same declared type both sides, no cast,
--    no split); endpoint_verified is copied on the tier side. Idempotent by the `not exists`,
--    re-runnable alone at instant (iii).
--    drift rows (instant (iii) only, expected 0 at instant (i) by construction): tiers whose
--    parent scalars differ from their single position-0 child, i.e. a tier old code re-confirmed
--    in the (i)..(ii) window. Printed one notice per row with both sides; nothing is changed.
do $$
declare
  n int;
  r record;
  drift int := 0;
begin
  insert into provider_tier_proposal_endpoints
    (proposal_id, position, protocol, endpoint_host, endpoint_port, compid)
  select p.id, 0, p.protocol, p.endpoint_host, p.endpoint_port, p.compid
    from provider_tier_proposals p
   where num_nonnulls(p.protocol, p.endpoint_host, p.endpoint_port, p.compid) > 0
     and not exists (select 1 from provider_tier_proposal_endpoints e where e.proposal_id = p.id);
  get diagnostics n = row_count;
  raise notice 'backfill proposals: inserted %', n;

  insert into provider_tier_endpoints
    (tier_id, position, protocol, endpoint_host, endpoint_port, compid, endpoint_verified)
  select t.id, 0, t.protocol, t.endpoint_host, t.endpoint_port, t.compid, t.endpoint_verified
    from provider_tiers t
   where num_nonnulls(t.protocol, t.endpoint_host, t.endpoint_port, t.compid) > 0
     and not exists (select 1 from provider_tier_endpoints e where e.tier_id = t.id);
  get diagnostics n = row_count;
  raise notice 'backfill tiers: inserted %', n;

  for r in
    select t.id, t.confirmed_at,
           t.protocol as p_protocol, t.endpoint_host as p_host, t.endpoint_port as p_port, t.compid as p_compid,
           e.protocol as c_protocol, e.endpoint_host as c_host, e.endpoint_port as c_port, e.compid as c_compid
      from provider_tiers t
      join provider_tier_endpoints e on e.tier_id = t.id and e.position = 0
     where (select count(*) from provider_tier_endpoints e2 where e2.tier_id = t.id) = 1
       and (e.protocol is distinct from t.protocol
         or e.endpoint_host is distinct from t.endpoint_host
         or e.endpoint_port is distinct from t.endpoint_port
         or e.compid is distinct from t.compid)
     order by t.confirmed_at
  loop
    drift := drift + 1;
    raise notice 'drift row: tier % confirmed_at % parent (%, %, %, %) child (%, %, %, %)',
      r.id, r.confirmed_at, r.p_protocol, r.p_host, r.p_port, r.p_compid,
      r.c_protocol, r.c_host, r.c_port, r.c_compid;
  end loop;
  raise notice 'drift rows: %', drift;
end $$;

-- 5. Gate, instant (i) only (at instant (iii) run step 4 alone; after the code deploy the
--    parent is stale by design and this gate would wrongly abort). Every parent with any scalar
--    has a child; every position-0 child equals its parent on the four, and on endpoint_verified
--    for tiers. Raises on the first failure.
--    To see this gate fail once (design section 5, test 5): dry-run with step 4 commented out.
do $$
declare
  p_missing int; p_drift int; t_missing int; t_drift int;
begin
  select count(*) into p_missing from provider_tier_proposals p
   where num_nonnulls(p.protocol, p.endpoint_host, p.endpoint_port, p.compid) > 0
     and not exists (select 1 from provider_tier_proposal_endpoints e where e.proposal_id = p.id);
  if p_missing > 0 then
    raise exception '0090 gate: % proposals with scalars but no child row', p_missing;
  end if;

  select count(*) into p_drift from provider_tier_proposals p
    join provider_tier_proposal_endpoints e on e.proposal_id = p.id and e.position = 0
   where e.protocol is distinct from p.protocol
      or e.endpoint_host is distinct from p.endpoint_host
      or e.endpoint_port is distinct from p.endpoint_port
      or e.compid is distinct from p.compid;
  if p_drift > 0 then
    raise exception '0090 gate: % proposal position-0 child rows differ from parent', p_drift;
  end if;

  select count(*) into t_missing from provider_tiers t
   where num_nonnulls(t.protocol, t.endpoint_host, t.endpoint_port, t.compid) > 0
     and not exists (select 1 from provider_tier_endpoints e where e.tier_id = t.id);
  if t_missing > 0 then
    raise exception '0090 gate: % tiers with scalars but no child row', t_missing;
  end if;

  select count(*) into t_drift from provider_tiers t
    join provider_tier_endpoints e on e.tier_id = t.id and e.position = 0
   where e.protocol is distinct from t.protocol
      or e.endpoint_host is distinct from t.endpoint_host
      or e.endpoint_port is distinct from t.endpoint_port
      or e.compid is distinct from t.compid
      or e.endpoint_verified is distinct from t.endpoint_verified;
  if t_drift > 0 then
    raise exception '0090 gate: % tier position-0 child rows differ from parent', t_drift;
  end if;

  raise notice 'gate: proposals missing % drift %; tiers missing % drift %',
    p_missing, p_drift, t_missing, t_drift;
end $$;

-- 6. Ledger.
insert into schema_migrations (version, name) values
  ('0090', '0090_provider_tier_endpoints.sql')
on conflict (version) do nothing;

commit;
