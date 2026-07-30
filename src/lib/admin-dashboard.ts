import { pool } from "./db";
import { getPaymentTotals } from "./payments";

/**
 * All counts/lists here scope to role='user' (matches listClients' convention) —
 * the single admin account isn't a business metric.
 */

export interface UserCounts {
  total: number;
  free: number;
  paid: number;
  lapsed: number;
}

/** free = never had a license row; paid = has one active now; lapsed = had one before, none active now. */
export async function getUserCounts(): Promise<UserCounts> {
  const result = await pool.query<{ paid: string; lapsed: string; free: string; total: string }>(`
    with scoped as (
      select u.id,
             exists (
               select 1 from licenses l where l.user_id = u.id and l.status = 'active' and l.expires_at > now()
             ) as is_paid,
             exists (select 1 from licenses l where l.user_id = u.id) as ever_licensed
      from users u
      where u.role = 'user'
    )
    select
      count(*) filter (where is_paid) as paid,
      count(*) filter (where not is_paid and ever_licensed) as lapsed,
      count(*) filter (where not ever_licensed) as free,
      count(*) as total
    from scoped
  `);
  const row = result.rows[0];
  return {
    total: Number(row?.total ?? 0),
    free: Number(row?.free ?? 0),
    paid: Number(row?.paid ?? 0),
    lapsed: Number(row?.lapsed ?? 0),
  };
}

export interface RecentSignupRow {
  userId: string;
  email: string | null;
  displayName: string | null;
  createdAt: Date;
  statusLabel: "Paid" | "Lapsed" | "Free";
}

export async function getRecentSignups(limit = 10): Promise<RecentSignupRow[]> {
  const result = await pool.query<{
    id: string;
    email: string | null;
    display_name: string | null;
    created_at: Date;
    is_paid: boolean;
    ever_licensed: boolean;
  }>(
    `select u.id, u.email, u.display_name, u.created_at,
            exists (
              select 1 from licenses l where l.user_id = u.id and l.status = 'active' and l.expires_at > now()
            ) as is_paid,
            exists (select 1 from licenses l where l.user_id = u.id) as ever_licensed
     from users u
     where u.role = 'user'
     order by u.created_at desc
     limit $1`,
    [limit]
  );
  return result.rows.map((r) => ({
    userId: r.id,
    email: r.email,
    displayName: r.display_name,
    createdAt: r.created_at,
    statusLabel: r.is_paid ? "Paid" : r.ever_licensed ? "Lapsed" : "Free",
  }));
}

export interface LicenseActivityRow {
  type: "issued" | "revoked" | "expired";
  licenseKey: string | null;
  userEmail: string | null;
  actorEmail: string | null;
  at: Date;
}

const ISSUE_ACTION_TYPES = ["issue_license", "admin_users_issue_license"];
const REVOKE_ACTION_TYPES = ["revoke_license", "admin_licenses_revoke", "admin_users_revoke"];

/** Union of admin-driven issue/revoke events (admin_actions) and cron-driven natural
 * expiries (licenses.lifecycle_state), newest first. Cron expiry has no admin_actions
 * row since it's not an admin-initiated action. */
export async function getRecentLicenseActivity(limit = 10): Promise<LicenseActivityRow[]> {
  const result = await pool.query<{
    type: "issued" | "revoked" | "expired";
    license_key: string | null;
    user_email: string | null;
    actor_email: string | null;
    at: Date;
  }>(
    `(
      select
        case when a.action_type = any($1) then 'issued' else 'revoked' end as type,
        l.license_key, tu.email as user_email, au.email as actor_email, a.created_at as at
      from admin_actions a
      left join licenses l on l.id = a.target_license_id
      left join users tu on tu.id = a.target_user_id
      left join users au on au.id = a.admin_user_id
      where a.action_type = any($1) or a.action_type = any($2)
    )
    union all
    (
      select 'expired' as type, l.license_key, u.email as user_email, null as actor_email, l.expires_at as at
      from licenses l
      left join users u on u.id = l.user_id
      where l.lifecycle_state = 'expired_processed'
    )
    order by at desc
    limit $3`,
    [ISSUE_ACTION_TYPES, REVOKE_ACTION_TYPES, limit]
  );
  return result.rows.map((r) => ({
    type: r.type,
    licenseKey: r.license_key,
    userEmail: r.user_email,
    actorEmail: r.actor_email,
    at: r.at,
  }));
}

export interface SignupsPerDay {
  date: string;
  count: number;
}

/** Day buckets in UTC for the sparkline — zero-filled so gaps render as empty bars, not missing days. */
export async function getSignupsPerDay(days = 30): Promise<SignupsPerDay[]> {
  const result = await pool.query<{ date: string; count: string }>(
    `select to_char(d.day, 'YYYY-MM-DD') as date, count(u.id) as count
     from generate_series(
       date_trunc('day', now()) - ($1::int - 1) * interval '1 day',
       date_trunc('day', now()),
       interval '1 day'
     ) as d(day)
     left join users u
       on u.role = 'user' and date_trunc('day', u.created_at) = d.day
     group by d.day
     order by d.day asc`,
    [days]
  );
  return result.rows.map((r) => ({ date: r.date, count: Number(r.count) }));
}

/**
 * No per-tier pricing/subscription schema exists, so true MRR isn't computable —
 * `mrr` is a crude proxy (this month's customer-sourced payments), not a real
 * recurring-revenue figure. Flagged to marcus/coxwell rather than leaving it "not
 * tracked" now that the payments table backs totalAllTime/totalThisMonth for real.
 */
export interface RevenueStats {
  totalAllTime: number;
  totalThisMonth: number;
  mrr: number;
}

export async function getRevenueStats(): Promise<RevenueStats> {
  const totals = await getPaymentTotals();
  return {
    totalAllTime: totals.allTime,
    totalThisMonth: totals.thisMonth,
    mrr: totals.bySourceTypeThisMonth.customer,
  };
}
