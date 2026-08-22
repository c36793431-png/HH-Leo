import { pool } from "./db";

/** Partner Referral Programme (bus thread leo-partner-referral-programme-build-2026-08-21).
 * Manually-onboarded partners (e.g. Legitcashmaker) with individually-negotiated gross
 * deals — distinct from the self-serve, %-of-payment referral_earnings system in
 * referrals.ts. Net-settle totals are computed here as a query over partner_deals +
 * deal_payments, never a stored column, so nothing can drift out of sync. */

export interface PartnerRow {
  id: string;
  name: string;
  handle: string | null;
  email: string | null;
  userId: string | null;
  status: "active" | "inactive";
  createdAt: Date;
}

/** Lifecycle (P1, mockups/horizon-referral-partner/P1-spec.md): repurposes the original
 * status column (see migration 0056) instead of adding a parallel column. 'completed' from
 * the original 0045 schema is retired in favour of 'closed'. */
export type DealLifecycle = "proposed" | "approved" | "active" | "closed" | "cancelled";

/** Settlement is derived per cycle (gross vs collected), never stored — see getDealCycle(). */
export type DealSettlement = "promised" | "partial" | "settled";

export interface PartnerDealRow {
  id: string;
  partnerId: string;
  clientUserId: string;
  clientEmail: string | null;
  grossUsd: number;
  partnerPct: number;
  coxwellPct: number;
  status: DealLifecycle;
  cadence: "monthly" | "one_time";
  tiers: string[];
  proposalNote: string | null;
  activatedAt: Date | null;
  closedAt: Date | null;
  createdAt: Date;
  receivedUsd: number;
}

interface PartnerDbRow {
  id: string;
  name: string;
  handle: string | null;
  email: string | null;
  user_id: string | null;
  status: PartnerRow["status"];
  created_at: Date;
}

function mapPartner(r: PartnerDbRow): PartnerRow {
  return {
    id: r.id,
    name: r.name,
    handle: r.handle,
    email: r.email,
    userId: r.user_id,
    status: r.status,
    createdAt: r.created_at,
  };
}

/** Looks up the partner record for a logged-in partner user, by users.id. */
export async function getPartnerByUserId(userId: string): Promise<PartnerRow | null> {
  const result = await pool.query<PartnerDbRow>("select * from partners where user_id = $1", [userId]);
  return result.rows[0] ? mapPartner(result.rows[0]) : null;
}

/** Resolves the single active partner's referral_code, for proxy.ts to auto-set the hz_ref
 * cookie on partner.horizonhft.com visits (subdomain-derives-partner attribution). Only
 * works while there's exactly one active partner — see proxy.ts PARTNER_HOST comment; once a
 * second partner is onboarded this needs a host->partner lookup instead of "the one active row". */
export async function getActivePartnerReferralCode(): Promise<string | null> {
  const result = await pool.query<{ referral_code: string | null }>(
    `select u.referral_code from partners p
     join users u on u.id = p.user_id
     where p.status = 'active'
     order by p.created_at asc
     limit 1`
  );
  return result.rows[0]?.referral_code ?? null;
}

/** Resolves a specific partner's own referral_code (via their linked users row), for the
 * "Your referral link" card on /partner/dashboard. Unlike getActivePartnerReferralCode()
 * this doesn't assume there's only one active partner. */
export async function getPartnerReferralCode(userId: string): Promise<string | null> {
  const result = await pool.query<{ referral_code: string | null }>(
    "select referral_code from users where id = $1",
    [userId]
  );
  return result.rows[0]?.referral_code ?? null;
}

/** Negotiated split for auto-created deals (item 5 of the leo-partner-subdomain-auth-model
 * bundle) — matches the partner_deals column defaults and the one real deal on record
 * (Legitcashmaker/aylrn, migration 0046). Revisit once partners can negotiate their own rate. */
const DEFAULT_PARTNER_PCT = 0.6;
const DEFAULT_COXWELL_PCT = 0.4;

/** Bridges a customer payment from a partner-referred user into partner_deals/deal_payments
 * instead of the flat-30% referral_earnings ledger, so partner-attributed revenue shows up on
 * /partner/dashboard and /admin/partners. Finds-or-creates one active deal per (partner,
 * client) pair and grows its gross_usd with each payment, so gross and received stay equal —
 * same invariant the migration 0046 backfill established for a manually-entered deal.
 * Idempotent per payment via deal_payments' unique(payment_id) (migration 0047). */
export async function recordAutoPartnerPayment(input: {
  partnerId: string;
  clientUserId: string;
  paymentId: string;
  amountUsd: number;
}): Promise<void> {
  const client = await pool.connect();
  try {
    await client.query("begin");
    const existing = await client.query<{ id: string }>(
      `select id from partner_deals where partner_id = $1 and client_user_id = $2 and status = 'active' for update`,
      [input.partnerId, input.clientUserId]
    );
    let dealId = existing.rows[0]?.id;
    if (dealId) {
      await client.query(`update partner_deals set gross_usd = gross_usd + $1 where id = $2`, [
        input.amountUsd,
        dealId,
      ]);
    } else {
      const created = await client.query<{ id: string }>(
        `insert into partner_deals (partner_id, client_user_id, gross_usd, partner_pct, coxwell_pct)
         values ($1, $2, $3, $4, $5) returning id`,
        [input.partnerId, input.clientUserId, input.amountUsd, DEFAULT_PARTNER_PCT, DEFAULT_COXWELL_PCT]
      );
      dealId = created.rows[0].id;
    }
    await client.query(
      `insert into deal_payments (deal_id, payment_id, amount_usd, confirmed_by, notes)
       values ($1, $2, $3, $4, $5)`,
      [
        dealId,
        input.paymentId,
        input.amountUsd,
        "auto:referral-attribution",
        "Auto-created from a customer payment via subdomain referral attribution",
      ]
    );
    await client.query("commit");
  } catch (err: unknown) {
    await client.query("rollback");
    if ((err as { code?: string })?.code === "23505") return; // already recorded for this payment
    throw err;
  } finally {
    client.release();
  }
}

export async function listPartners(): Promise<PartnerRow[]> {
  const result = await pool.query<PartnerDbRow>("select * from partners order by created_at desc");
  return result.rows.map(mapPartner);
}

interface PartnerDealDbRow {
  id: string;
  partner_id: string;
  client_user_id: string;
  client_email: string | null;
  gross_usd: string;
  partner_pct: string;
  coxwell_pct: string;
  status: PartnerDealRow["status"];
  cadence: PartnerDealRow["cadence"];
  tiers: string[] | null;
  proposal_note: string | null;
  activated_at: Date | null;
  closed_at: Date | null;
  created_at: Date;
  received_usd: string;
}

function mapDeal(r: PartnerDealDbRow): PartnerDealRow {
  return {
    id: r.id,
    partnerId: r.partner_id,
    clientUserId: r.client_user_id,
    clientEmail: r.client_email,
    grossUsd: Number(r.gross_usd),
    partnerPct: Number(r.partner_pct),
    coxwellPct: Number(r.coxwell_pct),
    status: r.status,
    cadence: r.cadence,
    tiers: r.tiers ?? [],
    proposalNote: r.proposal_note,
    activatedAt: r.activated_at,
    closedAt: r.closed_at,
    createdAt: r.created_at,
    receivedUsd: Number(r.received_usd),
  };
}

const DEAL_SELECT = `
  select pd.id, pd.partner_id, pd.client_user_id, u.email as client_email,
         pd.gross_usd, pd.partner_pct, pd.coxwell_pct, pd.status, pd.cadence, pd.tiers,
         pd.proposal_note, pd.activated_at, pd.closed_at, pd.created_at,
         coalesce((select sum(dp.amount_usd) from deal_payments dp where dp.deal_id = pd.id), 0) as received_usd
  from partner_deals pd
  join users u on u.id = pd.client_user_id
`;

/** All deals for one partner (partner-facing dashboard). */
export async function listDealsForPartner(partnerId: string): Promise<PartnerDealRow[]> {
  const result = await pool.query<PartnerDealDbRow>(
    `${DEAL_SELECT} where pd.partner_id = $1 order by pd.created_at desc`,
    [partnerId]
  );
  return result.rows.map(mapDeal);
}

/** Every deal across every partner (admin approval-queue / ledger). */
export async function listAllDeals(): Promise<PartnerDealRow[]> {
  const result = await pool.query<PartnerDealDbRow>(`${DEAL_SELECT} order by pd.created_at desc`);
  return result.rows.map(mapDeal);
}

export type DealPaymentChannel = "portal" | "bank" | "payoneer" | "crypto" | "other";

export interface DealPaymentRow {
  id: string;
  dealId: string;
  paymentId: string | null;
  amountUsd: number;
  receivedAt: Date;
  confirmedBy: string | null;
  notes: string | null;
  channel: DealPaymentChannel;
  evidence: string | null;
  cycle: string | null;
}

interface DealPaymentDbRow {
  id: string;
  deal_id: string;
  payment_id: string | null;
  amount_usd: string;
  received_at: Date;
  confirmed_by: string | null;
  notes: string | null;
  channel: DealPaymentChannel;
  evidence: string | null;
  cycle: string | null;
}

function mapDealPayment(r: DealPaymentDbRow): DealPaymentRow {
  return {
    id: r.id,
    dealId: r.deal_id,
    paymentId: r.payment_id,
    amountUsd: Number(r.amount_usd),
    receivedAt: r.received_at,
    confirmedBy: r.confirmed_by,
    notes: r.notes,
    channel: r.channel,
    evidence: r.evidence,
    cycle: r.cycle,
  };
}

/** Current cycle tag for a monthly deal, e.g. "2026-08" — one-time deals don't cycle. */
export function currentCycleTag(now: Date = new Date()): string {
  return `${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, "0")}`;
}

export interface DealCycle {
  cycle: string | null;
  gross: number;
  collected: number;
  outstanding: number;
  settlement: DealSettlement;
  payments: DealPaymentRow[];
}

/** Derives the current cycle's Gross/Collected/Outstanding + settlement state for a deal.
 * Settlement is never stored (see migration 0056's comment) — promised/partial/settled falls
 * straight out of gross_usd vs the sum of this cycle's deal_payments rows. Monthly deals scope
 * payments to the current calendar-month cycle tag; one_time deals use every payment on the
 * deal (cycle stays null/n-a) since there's only ever one settlement window. */
export function summarizeDealCycle(deal: PartnerDealRow, allPayments: DealPaymentRow[]): DealCycle {
  const cycle = deal.cadence === "monthly" ? currentCycleTag() : null;
  const payments =
    deal.cadence === "monthly" ? allPayments.filter((p) => p.cycle === cycle) : allPayments;
  const collected = payments.reduce((sum, p) => sum + p.amountUsd, 0);
  const gross = deal.grossUsd;
  const outstanding = Math.max(0, gross - collected);
  const settlement: DealSettlement = collected <= 0 ? "promised" : outstanding > 0 ? "partial" : "settled";
  return { cycle, gross, collected, outstanding, settlement, payments };
}

export async function listPaymentsForDeal(dealId: string): Promise<DealPaymentRow[]> {
  const result = await pool.query<DealPaymentDbRow>(
    "select * from deal_payments where deal_id = $1 order by received_at desc",
    [dealId]
  );
  return result.rows.map(mapDealPayment);
}

export interface CreatePartnerInput {
  name: string;
  handle?: string | null;
  email?: string | null;
  userId?: string | null;
}

export async function createPartner(input: CreatePartnerInput): Promise<string> {
  const result = await pool.query<{ id: string }>(
    `insert into partners (name, handle, email, user_id) values ($1, $2, $3, $4) returning id`,
    [input.name, input.handle ?? null, input.email ?? null, input.userId ?? null]
  );
  return result.rows[0].id;
}

export interface CreateDealInput {
  partnerId: string;
  clientUserId: string;
  grossUsd: number;
  partnerPct: number;
  coxwellPct: number;
}

export async function createDeal(input: CreateDealInput): Promise<string> {
  const result = await pool.query<{ id: string }>(
    `insert into partner_deals (partner_id, client_user_id, gross_usd, partner_pct, coxwell_pct)
     values ($1, $2, $3, $4, $5) returning id`,
    [input.partnerId, input.clientUserId, input.grossUsd, input.partnerPct, input.coxwellPct]
  );
  return result.rows[0].id;
}

/** Records a confirmed cash movement against a deal. Human-attested by default — the P1
 * admin-approval-queue mockup (Marcus m22759, "dumb-simple") only captures amount + date and
 * one-click-confirms, so channel/evidence are optional and default to 'other'/null; they exist
 * for the locked data contract (portal auto-reconciled vs off-portal manual) without forcing
 * the simplified UI to collect them. paymentId links it into the Finance ledger when the admin
 * has already logged a matching payments row; otherwise it's standalone. */
export async function recordDealPayment(input: {
  dealId: string;
  paymentId?: string | null;
  amountUsd: number;
  confirmedBy: string;
  notes?: string | null;
  channel?: DealPaymentChannel;
  evidence?: string | null;
  cycle?: string | null;
}): Promise<string> {
  const result = await pool.query<{ id: string }>(
    `insert into deal_payments (deal_id, payment_id, amount_usd, confirmed_by, notes, channel, evidence, cycle)
     values ($1, $2, $3, $4, $5, $6, $7, $8) returning id`,
    [
      input.dealId,
      input.paymentId ?? null,
      input.amountUsd,
      input.confirmedBy,
      input.notes ?? null,
      input.channel ?? "other",
      input.evidence ?? null,
      input.cycle ?? currentCycleTag(),
    ]
  );
  return result.rows[0].id;
}

/** Partner-initiated deal proposal (P1 new-proposal form) — lands as lifecycle 'proposed',
 * distinct from createDeal() which admin/partners.tsx uses to enter an already-agreed deal
 * straight in as 'active'. */
export interface CreateProposalInput {
  partnerId: string;
  clientUserId: string;
  grossUsd: number;
  partnerPct: number;
  cadence: "monthly" | "one_time";
  tiers: string[];
  note?: string | null;
}

export async function createProposal(input: CreateProposalInput): Promise<string> {
  const result = await pool.query<{ id: string }>(
    `insert into partner_deals
       (partner_id, client_user_id, gross_usd, partner_pct, coxwell_pct, status, cadence, tiers, proposal_note)
     values ($1, $2, $3, $4, $5, 'proposed', $6, $7, $8) returning id`,
    [
      input.partnerId,
      input.clientUserId,
      input.grossUsd,
      input.partnerPct,
      1 - input.partnerPct,
      input.cadence,
      input.tiers,
      input.note ?? null,
    ]
  );
  return result.rows[0].id;
}

/** Deals awaiting admin review (admin-approval-queue). */
export async function listProposedDeals(): Promise<PartnerDealRow[]> {
  const result = await pool.query<PartnerDealDbRow>(
    `${DEAL_SELECT} where pd.status = 'proposed' order by pd.created_at asc`
  );
  return result.rows.map(mapDeal);
}

/** Approve & activate — the P1 admin mockup collapses the spec's separate proposed->approved
 * and approved->active hops into a single button ("Approve & activate"), so this jumps
 * straight to 'active' and stamps activated_at. A distinct two-step approve-then-activate flow
 * is left for a later phase if Horizon ever needs a review-without-activating state. */
export async function approveAndActivateDeal(dealId: string): Promise<void> {
  await pool.query(
    `update partner_deals set status = 'active', activated_at = coalesce(activated_at, now()) where id = $1`,
    [dealId]
  );
}

export async function declineDeal(dealId: string): Promise<void> {
  await pool.query(`update partner_deals set status = 'cancelled' where id = $1`, [dealId]);
}

export async function closeDeal(dealId: string): Promise<void> {
  await pool.query(`update partner_deals set status = 'closed', closed_at = now() where id = $1`, [dealId]);
}

/** Looks up a users.id by email for the proposal form's client-matching step — mirrors
 * admin/partners/actions.ts's resolveUserIdByEmail, kept here too since the proposal form is a
 * partner (not admin) action and lives in a different actions.ts file. */
export async function findUserIdByEmail(email: string): Promise<string | null> {
  const result = await pool.query<{ id: string }>("select id from users where lower(email) = lower($1)", [email]);
  return result.rows[0]?.id ?? null;
}
