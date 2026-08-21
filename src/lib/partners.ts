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

export interface PartnerDealRow {
  id: string;
  partnerId: string;
  clientUserId: string;
  clientEmail: string | null;
  grossUsd: number;
  partnerPct: number;
  coxwellPct: number;
  status: "active" | "completed" | "cancelled";
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
    createdAt: r.created_at,
    receivedUsd: Number(r.received_usd),
  };
}

const DEAL_SELECT = `
  select pd.id, pd.partner_id, pd.client_user_id, u.email as client_email,
         pd.gross_usd, pd.partner_pct, pd.coxwell_pct, pd.status, pd.created_at,
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

export interface DealPaymentRow {
  id: string;
  dealId: string;
  paymentId: string | null;
  amountUsd: number;
  receivedAt: Date;
  confirmedBy: string | null;
  notes: string | null;
}

interface DealPaymentDbRow {
  id: string;
  deal_id: string;
  payment_id: string | null;
  amount_usd: string;
  received_at: Date;
  confirmed_by: string | null;
  notes: string | null;
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
  };
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

/** Records a confirmed cash movement against a deal. Human-attested only — no channel/tx
 * tracking (per the 2026-08-21 correction). paymentId links it into the Finance ledger
 * when the admin has already logged a matching payments row; otherwise it's standalone. */
export async function recordDealPayment(input: {
  dealId: string;
  paymentId?: string | null;
  amountUsd: number;
  confirmedBy: string;
  notes?: string | null;
}): Promise<string> {
  const result = await pool.query<{ id: string }>(
    `insert into deal_payments (deal_id, payment_id, amount_usd, confirmed_by, notes)
     values ($1, $2, $3, $4, $5) returning id`,
    [input.dealId, input.paymentId ?? null, input.amountUsd, input.confirmedBy, input.notes ?? null]
  );
  return result.rows[0].id;
}
