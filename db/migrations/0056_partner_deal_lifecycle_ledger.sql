-- Referral Partner programme P1 (bus thread leo-partner-surface-p1-implementation-2026-08-22,
-- design spec mockups/horizon-referral-partner/P1-spec.md). Adds the columns the new
-- partner-dashboard / proposal-form / admin-approval-queue surfaces need on top of the
-- 0045 schema, additively — no existing column is dropped or renamed.
--
-- LIFECYCLE DECISION: the spec asks for a decoupled lifecycle (proposed -> approved ->
-- active -> closed) separate from partner_deals.status (active|completed|cancelled).
-- We REPURPOSE `status` as the lifecycle column instead of adding a parallel one: every
-- existing read path (listDealsForPartner, listAllDeals, recordAutoPartnerPayment's
-- `where status = 'active'` lookup, proxy.ts's active-partner check) already filters on
-- 'active' meaning exactly the same thing under the new vocabulary (a deal that's live and
-- accruing), so widening the check constraint is a no-op for those queries. Adding a second
-- lifecycle column instead would leave two sources of truth that could drift. 'completed' is
-- retired in favour of 'closed' (backfilled below); 'cancelled' is kept as-is for
-- declined/withdrawn proposals since the spec's approval-queue mockup has a Decline action
-- that isn't quite "closed" (a closed deal implies it was active first).
--
-- SETTLEMENT: modelled as derived, not stored. The admin-approval-queue and partner-dashboard
-- mockups both compute promised/partial/settled from gross_usd vs sum(deal_payments) for the
-- current cycle -- there is no separate "promised" ledger row (outstanding is a computed
-- remainder, not a DB row), so no new table is needed; src/lib/partners.ts derives it.
--
-- cadence: every deal (not just Aylrn's) now carries monthly | one_time per the locked
-- 2026-08-21 decision. Existing rows backfill to 'monthly' (matches the one real deal on
-- record) via the column default.
--
-- tiers[]: simple text[] per Leo's brief -- sold as one bundle/one price/one activation,
-- grant/revoke/meter stay per-tier elsewhere; this column is just the bundle's tier list for
-- display, not a new entitlements system.
alter table partner_deals
  add column cadence text not null default 'monthly' check (cadence in ('monthly', 'one_time')),
  add column tiers text[] not null default '{}',
  add column proposal_note text,
  add column activated_at timestamptz,
  add column closed_at timestamptz;

-- Widen the status/lifecycle check constraint. Postgres has no "alter check", so drop +
-- recreate under a new name.
alter table partner_deals drop constraint partner_deals_status_check;
alter table partner_deals
  add constraint partner_deals_status_check
  check (status in ('proposed', 'approved', 'active', 'closed', 'cancelled'));

-- Backfill: retire 'completed' in favour of 'closed' (see decision note above). No live rows
-- are expected to be 'completed' yet, but this is here in case any were entered manually.
update partner_deals set status = 'closed' where status = 'completed';

-- Backfill the one real deal on record (Legitcashmaker -> Aylrn, migration 0046) with the
-- seed values from mockups/horizon-referral-partner/seed-aylrn.json: cadence monthly (already
-- the default), the 3-tier bundle, and its actual activation date. Matched by partner handle +
-- client email rather than a hardcoded id, since ids aren't known ahead of a live DB paste.
update partner_deals pd
set tiers = array['ld-beta-56', 'ld-gamma-19', 'ld-delta-18'],
    activated_at = coalesce(pd.activated_at, timestamptz '2026-08-14 00:00:00+00')
from partners p, users u
where pd.partner_id = p.id
  and pd.client_user_id = u.id
  and lower(coalesce(p.handle, '')) like '%legitcashmaker%'
  and lower(u.email) = 'giang2000ln@gmail.com'
  and pd.status = 'active';

-- deal_payments: channel + evidence per the spec's data contract (portal is auto-reconciled;
-- bank/payoneer/crypto/other are manual/off-portal). The admin-approval-queue mockup's
-- actual copy (Marcus m22759, "dumb-simple", superseding an earlier per-channel-capture pass)
-- does NOT surface a channel picker or evidence upload in the P1 UI -- off-portal receipts are
-- just amount + date + one-click confirm. These columns are kept anyway because they're in the
-- locked data contract and cost nothing additively: the P1 off-portal recording action defaults
-- channel to 'other' and leaves evidence null, so the simplified UI's writes are valid without
-- forcing a redesign if a later phase (P2) adds channel capture back.
alter table deal_payments
  add column channel text not null default 'portal' check (channel in ('portal', 'bank', 'payoneer', 'crypto', 'other')),
  add column evidence text,
  add column cycle text;

-- Backfill the one real Aylrn payment: crypto $600, coxwell-confirmed 2026-08 -- matched by
-- deal + amount since exact row ids aren't known ahead of a live DB paste. seed-aylrn.json's
-- $100/$140 split was superseded by live production data (FOC16 pre-flight found a single
-- $600 USDT row) and does not reflect what actually landed. evidence is left NULL rather than
-- a fabricated reference id -- no real Stripe/receipt reference was available to this
-- migration; FOC16/coxwell should attach the actual evidence reference for this row after
-- paste if one exists.
update deal_payments dp
set channel = 'crypto', cycle = '2026-08'
from partner_deals pd, partners p, users u
where dp.deal_id = pd.id and pd.partner_id = p.id and pd.client_user_id = u.id
  and lower(coalesce(p.handle, '')) like '%legitcashmaker%'
  and lower(u.email) = 'giang2000ln@gmail.com'
  and dp.amount_usd = 600;

insert into schema_migrations (version, name) values
  ('0056', '0056_partner_deal_lifecycle_ledger.sql')
on conflict (version) do nothing;
