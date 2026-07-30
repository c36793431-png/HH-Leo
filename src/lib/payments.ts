import { pool } from "./db";

export type PaymentSourceType = "customer" | "partner" | "affiliate" | "other";
export const PAYMENT_SOURCE_TYPES: PaymentSourceType[] = ["customer", "partner", "affiliate", "other"];

export interface PaymentRow {
  id: string;
  receivedAt: Date;
  amountUsd: number;
  currency: string;
  sourceType: PaymentSourceType;
  counterparty: string | null;
  userId: string | null;
  memo: string | null;
  createdBy: string | null;
  createdAt: Date;
}

interface PaymentDbRow {
  id: string;
  received_at: Date;
  amount_usd: string;
  currency: string;
  source_type: PaymentSourceType;
  counterparty: string | null;
  user_id: string | null;
  memo: string | null;
  created_by: string | null;
  created_at: Date;
}

function mapRow(r: PaymentDbRow): PaymentRow {
  return {
    id: r.id,
    receivedAt: r.received_at,
    amountUsd: Number(r.amount_usd),
    currency: r.currency,
    sourceType: r.source_type,
    counterparty: r.counterparty,
    userId: r.user_id,
    memo: r.memo,
    createdBy: r.created_by,
    createdAt: r.created_at,
  };
}

export async function listPayments(limit = 200): Promise<PaymentRow[]> {
  const result = await pool.query<PaymentDbRow>(
    `select id, received_at, amount_usd, currency, source_type, counterparty, user_id, memo, created_by, created_at
     from payments
     order by received_at desc
     limit $1`,
    [limit]
  );
  return result.rows.map(mapRow);
}

export type SourceTypeTotals = Record<PaymentSourceType, number>;

export interface PaymentTotals {
  allTime: number;
  thisMonth: number;
  bySourceTypeAllTime: SourceTypeTotals;
  bySourceTypeThisMonth: SourceTypeTotals;
}

function emptyTotals(): SourceTypeTotals {
  return { customer: 0, partner: 0, affiliate: 0, other: 0 };
}

/** Grouped by source_type in one pass so the finance page's totals strip and the
 * dashboard's MRR proxy (this-month customer payments) share a single query. */
export async function getPaymentTotals(): Promise<PaymentTotals> {
  const result = await pool.query<{ source_type: PaymentSourceType; all_time: string; this_month: string }>(`
    select
      source_type,
      coalesce(sum(amount_usd), 0) as all_time,
      coalesce(sum(amount_usd) filter (where received_at >= date_trunc('month', now())), 0) as this_month
    from payments
    group by source_type
  `);

  const bySourceTypeAllTime = emptyTotals();
  const bySourceTypeThisMonth = emptyTotals();
  let allTime = 0;
  let thisMonth = 0;
  for (const row of result.rows) {
    const at = Number(row.all_time);
    const tm = Number(row.this_month);
    bySourceTypeAllTime[row.source_type] = at;
    bySourceTypeThisMonth[row.source_type] = tm;
    allTime += at;
    thisMonth += tm;
  }
  return { allTime, thisMonth, bySourceTypeAllTime, bySourceTypeThisMonth };
}

export interface AddPaymentInput {
  receivedAt: Date;
  amountUsd: number;
  currency: string;
  sourceType: PaymentSourceType;
  counterparty: string | null;
  userId: string | null;
  memo: string | null;
  createdBy: string | null;
}

export async function insertPayment(input: AddPaymentInput): Promise<string> {
  const result = await pool.query<{ id: string }>(
    `insert into payments (received_at, amount_usd, currency, source_type, counterparty, user_id, memo, created_by)
     values ($1, $2, $3, $4, $5, $6, $7, $8)
     returning id`,
    [
      input.receivedAt,
      input.amountUsd,
      input.currency,
      input.sourceType,
      input.counterparty,
      input.userId,
      input.memo,
      input.createdBy,
    ]
  );
  return result.rows[0].id;
}

/** Powers the counterparty <datalist> on the Add payment form. */
export async function listUserEmailsForAutocomplete(limit = 500): Promise<string[]> {
  const result = await pool.query<{ email: string }>(
    `select email from users where role = 'user' and email is not null order by email limit $1`,
    [limit]
  );
  return result.rows.map((r) => r.email);
}
