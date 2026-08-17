import { pool } from "./db";

export type PaymentDirection = "in" | "out";
export const PAYMENT_DIRECTIONS: PaymentDirection[] = ["in", "out"];

export type PaymentCategory =
  | "customer"
  | "partner"
  | "affiliate"
  | "feed_provider"
  | "infra"
  | "other"
  | "referral_payout";
export const PAYMENT_CATEGORIES: PaymentCategory[] = [
  "customer",
  "partner",
  "affiliate",
  "feed_provider",
  "infra",
  "other",
  "referral_payout",
];

export interface PaymentRow {
  id: string;
  receivedAt: Date;
  amountUsd: number;
  currency: string;
  direction: PaymentDirection;
  category: PaymentCategory;
  counterparty: string | null;
  userId: string | null;
  memo: string | null;
  createdBy: string | null;
  createdAt: Date;
  isTrial: boolean;
}

interface PaymentDbRow {
  id: string;
  received_at: Date;
  amount_usd: string;
  currency: string;
  direction: PaymentDirection;
  category: PaymentCategory;
  counterparty: string | null;
  user_id: string | null;
  memo: string | null;
  created_by: string | null;
  created_at: Date;
  is_trial: boolean;
}

function mapRow(r: PaymentDbRow): PaymentRow {
  return {
    id: r.id,
    receivedAt: r.received_at,
    amountUsd: Number(r.amount_usd),
    currency: r.currency,
    direction: r.direction,
    category: r.category,
    counterparty: r.counterparty,
    userId: r.user_id,
    memo: r.memo,
    createdBy: r.created_by,
    createdAt: r.created_at,
    isTrial: r.is_trial,
  };
}

export async function listPayments(limit = 200): Promise<PaymentRow[]> {
  const result = await pool.query<PaymentDbRow>(
    `select id, received_at, amount_usd, currency, direction, category, counterparty, user_id, memo, created_by, created_at, is_trial
     from payments
     order by received_at desc
     limit $1`,
    [limit]
  );
  return result.rows.map(mapRow);
}

/** Powers the Payments block on /admin/users/[id] — every payment tagged to this user_id. */
export async function listPaymentsForUser(userId: string, limit = 50): Promise<PaymentRow[]> {
  const result = await pool.query<PaymentDbRow>(
    `select id, received_at, amount_usd, currency, direction, category, counterparty, user_id, memo, created_by, created_at, is_trial
     from payments
     where user_id = $1
     order by received_at desc
     limit $2`,
    [userId, limit]
  );
  return result.rows.map(mapRow);
}

export interface PaymentTotals {
  grossIn: number;
  totalOut: number;
  net: number;
  grossInThisMonth: number;
  totalOutThisMonth: number;
  netThisMonth: number;
  /** proxy: this month's "in" payments from customers — no per-tier pricing exists for true MRR. */
  mrrProxy: number;
}

export async function getPaymentTotals(): Promise<PaymentTotals> {
  const result = await pool.query<{
    gross_in: string;
    total_out: string;
    gross_in_month: string;
    total_out_month: string;
    mrr_proxy: string;
  }>(`
    select
      coalesce(sum(amount_usd) filter (where direction = 'in' and not is_trial), 0) as gross_in,
      coalesce(sum(amount_usd) filter (where direction = 'out'), 0) as total_out,
      coalesce(sum(amount_usd) filter (where direction = 'in' and not is_trial and received_at >= date_trunc('month', now())), 0) as gross_in_month,
      coalesce(sum(amount_usd) filter (where direction = 'out' and received_at >= date_trunc('month', now())), 0) as total_out_month,
      coalesce(sum(amount_usd) filter (where direction = 'in' and not is_trial and category = 'customer' and received_at >= date_trunc('month', now())), 0) as mrr_proxy
    from payments
  `);
  const row = result.rows[0];
  const grossIn = Number(row?.gross_in ?? 0);
  const totalOut = Number(row?.total_out ?? 0);
  const grossInThisMonth = Number(row?.gross_in_month ?? 0);
  const totalOutThisMonth = Number(row?.total_out_month ?? 0);
  return {
    grossIn,
    totalOut,
    net: grossIn - totalOut,
    grossInThisMonth,
    totalOutThisMonth,
    netThisMonth: grossInThisMonth - totalOutThisMonth,
    mrrProxy: Number(row?.mrr_proxy ?? 0),
  };
}

export interface AddPaymentInput {
  receivedAt: Date;
  amountUsd: number;
  currency: string;
  direction: PaymentDirection;
  category: PaymentCategory;
  counterparty: string | null;
  userId: string | null;
  memo: string | null;
  createdBy: string | null;
}

export async function insertPayment(input: AddPaymentInput): Promise<string> {
  const result = await pool.query<{ id: string }>(
    `insert into payments (received_at, amount_usd, currency, direction, category, counterparty, user_id, memo, created_by)
     values ($1, $2, $3, $4, $5, $6, $7, $8, $9)
     returning id`,
    [
      input.receivedAt,
      input.amountUsd,
      input.currency,
      input.direction,
      input.category,
      input.counterparty,
      input.userId,
      input.memo,
      input.createdBy,
    ]
  );
  return result.rows[0].id;
}

export interface UpdatePaymentInput {
  amountUsd: number;
  currency: string;
  direction: PaymentDirection;
  category: PaymentCategory;
  counterparty: string | null;
  memo: string | null;
}

export async function updatePayment(id: string, input: UpdatePaymentInput): Promise<void> {
  await pool.query(
    `update payments
     set amount_usd = $2, currency = $3, direction = $4, category = $5, counterparty = $6, memo = $7
     where id = $1`,
    [id, input.amountUsd, input.currency, input.direction, input.category, input.counterparty, input.memo]
  );
}

export async function deletePayment(id: string): Promise<void> {
  await pool.query(`delete from payments where id = $1`, [id]);
}

/** Powers the counterparty <datalist> on the Add payment form when category=customer. */
export async function listUserEmailsForAutocomplete(limit = 500): Promise<string[]> {
  const result = await pool.query<{ email: string }>(
    `select email from users where role = 'user' and email is not null order by email limit $1`,
    [limit]
  );
  return result.rows.map((r) => r.email);
}
