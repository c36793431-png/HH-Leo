import crypto from "crypto";
import { pool } from "./db";

export const REFERRAL_COOKIE = "hz_ref";
export const REFERRAL_COOKIE_MAX_AGE_DAYS = 30;
export const REFERRAL_RATE = 0.3;
export const REFERRAL_MIN_PAYOUT_USD = 50;
export const REFERRAL_CLAWBACK_DAYS = 14;

// Same no-ambiguity alphabet as license keys (no 0/O/1/I).
const CODE_ALPHABET = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";

function randomCodeSegment(length: number): string {
  const bytes = crypto.randomBytes(length);
  let out = "";
  for (let i = 0; i < length; i++) out += CODE_ALPHABET[bytes[i] % CODE_ALPHABET.length];
  return out;
}

export function generateReferralCode(): string {
  return `HFT-${randomCodeSegment(5)}`;
}

/** Assigns a referral_code if the user doesn't already have one — self-healing fallback for
 * the creation-time assignment in auth.ts, so a page read never has to handle a null code. */
export async function getOrCreateReferralCode(userId: string): Promise<string> {
  const existing = await pool.query<{ referral_code: string | null }>(
    "select referral_code from users where id = $1",
    [userId]
  );
  const current = existing.rows[0]?.referral_code;
  if (current) return current;

  for (let attempt = 0; attempt < 5; attempt++) {
    const code = generateReferralCode();
    try {
      const result = await pool.query<{ referral_code: string }>(
        `update users set referral_code = $1 where id = $2 returning referral_code`,
        [code, userId]
      );
      return result.rows[0].referral_code;
    } catch (err: unknown) {
      if ((err as { code?: string })?.code === "23505") continue; // code collision — retry
      throw err;
    }
  }
  throw new Error("getOrCreateReferralCode: failed to generate a unique code after 5 attempts");
}

/** Hooked from addPaymentAction after insertPayment: a 'customer'/'in' payment from a
 * referred user earns their referrer 30% of the payment amount, captured at time of earning
 * so a future rate change never rewrites history. unique(payment_id) on referral_earnings
 * makes this safe to call more than once for the same payment (no double-earning on retry). */
export async function maybeCreateReferralEarning(paymentId: string): Promise<void> {
  const payment = await pool.query<{
    id: string;
    amount_usd: string;
    direction: string;
    category: string;
    user_id: string | null;
  }>(
    "select id, amount_usd, direction, category, user_id from payments where id = $1",
    [paymentId]
  );
  const row = payment.rows[0];
  if (!row || row.direction !== "in" || row.category !== "customer" || !row.user_id) return;

  const referred = await pool.query<{ referred_by_user_id: string | null }>(
    "select referred_by_user_id from users where id = $1",
    [row.user_id]
  );
  const referrerId = referred.rows[0]?.referred_by_user_id;
  if (!referrerId || referrerId === row.user_id) return;

  const amountUsd = Number(row.amount_usd) * REFERRAL_RATE;
  try {
    await pool.query(
      `insert into referral_earnings (referrer_user_id, referred_user_id, payment_id, amount_usd, rate, status)
       values ($1, $2, $3, $4, $5, 'pending')`,
      [referrerId, row.user_id, row.id, amountUsd, REFERRAL_RATE]
    );
  } catch (err: unknown) {
    if ((err as { code?: string })?.code === "23505") return; // already recorded for this payment
    throw err;
  }
}

export interface ReferralEarningRow {
  id: string;
  referredUserId: string;
  referredEmail: string | null;
  amountUsd: number;
  status: "pending" | "cleared" | "clawback" | "paid";
  earnedAt: Date;
  clearedAt: Date | null;
  paidAt: Date | null;
}

export interface ReferredUserRow {
  userId: string;
  email: string | null;
  referredAt: Date;
  active: boolean;
  lifetimeEarnedUsd: number;
}

export interface UserReferralStats {
  referralCode: string;
  referralLink: string;
  totalReferred: number;
  activeReferrals: number;
  totalEarnedUsd: number;
  pendingUsd: number;
  clearedUsd: number;
  paidUsd: number;
  referrals: ReferredUserRow[];
  earnings: ReferralEarningRow[];
}

/** Active = same definition used everywhere else in the app (isPaidUser: licenses.status='active'
 * AND expires_at > now()). Default pending reply on the Wellington short-cycle
 * question raised internally — reversible one-line swap to a payment-recency
 * definition if Option B is preferred instead. */
export async function getUserReferralStats(userId: string, baseUrl: string): Promise<UserReferralStats> {
  const referralCode = await getOrCreateReferralCode(userId);

  const [referralsResult, earningsResult, totalsResult] = await Promise.all([
    pool.query<{
      user_id: string;
      email: string | null;
      referred_at: Date;
      active: boolean;
      lifetime_earned: string;
    }>(
      `select u.id as user_id, u.email, u.referred_at,
              exists(
                select 1 from licenses l
                where l.user_id = u.id and l.status = 'active' and l.expires_at > now()
              ) as active,
              coalesce(sum(re.amount_usd) filter (where re.status in ('cleared', 'paid')), 0) as lifetime_earned
       from users u
       left join referral_earnings re on re.referred_user_id = u.id and re.referrer_user_id = $1
       where u.referred_by_user_id = $1
       group by u.id, u.email, u.referred_at
       order by u.referred_at desc`,
      [userId]
    ),
    pool.query<{
      id: string;
      referred_user_id: string;
      referred_email: string | null;
      amount_usd: string;
      status: ReferralEarningRow["status"];
      earned_at: Date;
      cleared_at: Date | null;
      paid_at: Date | null;
    }>(
      `select re.id, re.referred_user_id, u.email as referred_email, re.amount_usd, re.status,
              re.earned_at, re.cleared_at, re.paid_at
       from referral_earnings re
       join users u on u.id = re.referred_user_id
       where re.referrer_user_id = $1
       order by re.earned_at desc
       limit 200`,
      [userId]
    ),
    pool.query<{ pending: string; cleared: string; paid: string }>(
      `select
         coalesce(sum(amount_usd) filter (where status = 'pending'), 0) as pending,
         coalesce(sum(amount_usd) filter (where status = 'cleared'), 0) as cleared,
         coalesce(sum(amount_usd) filter (where status = 'paid'), 0) as paid
       from referral_earnings
       where referrer_user_id = $1`,
      [userId]
    ),
  ]);

  const totals = totalsResult.rows[0] ?? { pending: "0", cleared: "0", paid: "0" };
  const pendingUsd = Number(totals.pending);
  const clearedUsd = Number(totals.cleared);
  const paidUsd = Number(totals.paid);

  return {
    referralCode,
    referralLink: `${baseUrl.replace(/\/$/, "")}/signup?ref=${referralCode}`,
    totalReferred: referralsResult.rowCount ?? 0,
    activeReferrals: referralsResult.rows.filter((r) => r.active).length,
    totalEarnedUsd: pendingUsd + clearedUsd + paidUsd,
    pendingUsd,
    clearedUsd,
    paidUsd,
    referrals: referralsResult.rows.map((r) => ({
      userId: r.user_id,
      email: r.email,
      referredAt: r.referred_at,
      active: r.active,
      lifetimeEarnedUsd: Number(r.lifetime_earned),
    })),
    earnings: earningsResult.rows.map((r) => ({
      id: r.id,
      referredUserId: r.referred_user_id,
      referredEmail: r.referred_email,
      amountUsd: Number(r.amount_usd),
      status: r.status,
      earnedAt: r.earned_at,
      clearedAt: r.cleared_at,
      paidAt: r.paid_at,
    })),
  };
}

export interface TopReferrerRow {
  referrerUserId: string;
  email: string | null;
  clearedUsd: number;
  pendingUsd: number;
  paidUsd: number;
  referralCount: number;
}

/** /admin/referrals top referrers table, ranked by cleared (payout-eligible) earnings. */
export async function listTopReferrers(limit = 50): Promise<TopReferrerRow[]> {
  const result = await pool.query<{
    referrer_user_id: string;
    email: string | null;
    cleared: string;
    pending: string;
    paid: string;
    referral_count: string;
  }>(
    `select u.id as referrer_user_id, u.email,
            coalesce(sum(re.amount_usd) filter (where re.status = 'cleared'), 0) as cleared,
            coalesce(sum(re.amount_usd) filter (where re.status = 'pending'), 0) as pending,
            coalesce(sum(re.amount_usd) filter (where re.status = 'paid'), 0) as paid,
            count(distinct re.referred_user_id) as referral_count
     from referral_earnings re
     join users u on u.id = re.referrer_user_id
     group by u.id, u.email
     order by cleared desc
     limit $1`,
    [limit]
  );
  return result.rows.map((r) => ({
    referrerUserId: r.referrer_user_id,
    email: r.email,
    clearedUsd: Number(r.cleared),
    pendingUsd: Number(r.pending),
    paidUsd: Number(r.paid),
    referralCount: Number(r.referral_count),
  }));
}

export interface PendingPayoutRow {
  referrerUserId: string;
  email: string | null;
  clearedUsd: number;
}

/** Referrers with >= $50 of cleared-but-unpaid earnings — the payout queue. */
export async function listPendingPayouts(): Promise<PendingPayoutRow[]> {
  const result = await pool.query<{ referrer_user_id: string; email: string | null; cleared: string }>(
    `select u.id as referrer_user_id, u.email, sum(re.amount_usd) as cleared
     from referral_earnings re
     join users u on u.id = re.referrer_user_id
     where re.status = 'cleared'
     group by u.id, u.email
     having sum(re.amount_usd) >= $1
     order by cleared desc`,
    [REFERRAL_MIN_PAYOUT_USD]
  );
  return result.rows.map((r) => ({
    referrerUserId: r.referrer_user_id,
    email: r.email,
    clearedUsd: Number(r.cleared),
  }));
}

export interface AdminReferralEarningRow {
  id: string;
  referrerUserId: string;
  referrerEmail: string | null;
  referredUserId: string;
  referredEmail: string | null;
  amountUsd: number;
  status: ReferralEarningRow["status"];
  earnedAt: Date;
  clearedAt: Date | null;
  paidAt: Date | null;
}

/** /admin/referrals full earnings log, optionally filtered by referrer or referred email substring. */
export async function listAllReferralEarnings(search?: string, limit = 300): Promise<AdminReferralEarningRow[]> {
  const params: unknown[] = [];
  let where = "";
  if (search) {
    params.push(`%${search}%`);
    where = `where ru.email ilike $1 or rf.email ilike $1`;
  }
  params.push(limit);

  const result = await pool.query<{
    id: string;
    referrer_user_id: string;
    referrer_email: string | null;
    referred_user_id: string;
    referred_email: string | null;
    amount_usd: string;
    status: ReferralEarningRow["status"];
    earned_at: Date;
    cleared_at: Date | null;
    paid_at: Date | null;
  }>(
    `select re.id, re.referrer_user_id, rf.email as referrer_email,
            re.referred_user_id, ru.email as referred_email,
            re.amount_usd, re.status, re.earned_at, re.cleared_at, re.paid_at
     from referral_earnings re
     join users rf on rf.id = re.referrer_user_id
     join users ru on ru.id = re.referred_user_id
     ${where}
     order by re.earned_at desc
     limit $${params.length}`,
    params
  );
  return result.rows.map((r) => ({
    id: r.id,
    referrerUserId: r.referrer_user_id,
    referrerEmail: r.referrer_email,
    referredUserId: r.referred_user_id,
    referredEmail: r.referred_email,
    amountUsd: Number(r.amount_usd),
    status: r.status,
    earnedAt: r.earned_at,
    clearedAt: r.cleared_at,
    paidAt: r.paid_at,
  }));
}

/** Manual clawback (no automated refund detection exists in the payments schema yet).
 * Only pending/cleared earnings can be clawed back; already-paid earnings need a
 * separate reversal, not modeled here. */
export async function clawbackEarning(earningId: string): Promise<void> {
  await pool.query(
    `update referral_earnings set status = 'clawback' where id = $1 and status in ('pending', 'cleared')`,
    [earningId]
  );
}

/** Marks every cleared earning for a referrer as paid, logging a matching `out` payment
 * (category=referral_payout) so Finance totals stay accurate. Returns the payout amount, or
 * null if there was nothing >= the $50 minimum to pay out. */
export async function markReferrerPaid(referrerUserId: string, adminEmail: string): Promise<number | null> {
  const client = await pool.connect();
  try {
    await client.query("begin");
    const clearedResult = await client.query<{ id: string; amount_usd: string }>(
      `select id, amount_usd from referral_earnings where referrer_user_id = $1 and status = 'cleared' for update`,
      [referrerUserId]
    );
    const total = clearedResult.rows.reduce((sum, r) => sum + Number(r.amount_usd), 0);
    if (total < REFERRAL_MIN_PAYOUT_USD || clearedResult.rowCount === 0) {
      await client.query("rollback");
      return null;
    }

    const referrer = await client.query<{ email: string | null }>("select email from users where id = $1", [
      referrerUserId,
    ]);

    const paymentResult = await client.query<{ id: string }>(
      `insert into payments (received_at, amount_usd, currency, direction, category, counterparty, user_id, memo, created_by)
       values (now(), $1, 'USD', 'out', 'referral_payout', $2, $3, $4, $5)
       returning id`,
      [
        total,
        referrer.rows[0]?.email ?? null,
        referrerUserId,
        `Referral payout — ${clearedResult.rowCount} cleared earning(s)`,
        adminEmail,
      ]
    );

    await client.query(
      `update referral_earnings set status = 'paid', paid_at = now()
       where id = any($1::uuid[])`,
      [clearedResult.rows.map((r) => r.id)]
    );

    await client.query("commit");
    void paymentResult;
    return total;
  } catch (err) {
    await client.query("rollback");
    throw err;
  } finally {
    client.release();
  }
}
