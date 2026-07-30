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
  trial: number;
  team: number;
  deal: number;
  lapsed: number;
  admins: number;
}

/**
 * free/paid/trial/team/deal/lapsed/total scope to role='user' (real customers only). paid/
 * trial/team/deal come from the active license's tier column (trial|paid|team|deal, see
 * migrations 0012/0013). deal = bartered licenses (non-cash), tracked separately from paid
 * so the customer breakdown stays honest — it's not counted in payments/revenue. lapsed =
 * had a license before with none active now. free = never licensed. admins is a separate
 * tile — role='admin' accounts, independent of license status, so they never get lumped
 * into the customer counts.
 */
export async function getUserCounts(): Promise<UserCounts> {
  const result = await pool.query<{
    paid: string;
    trial: string;
    team: string;
    deal: string;
    lapsed: string;
    free: string;
    total: string;
    admins: string;
  }>(`
    with scoped as (
      select u.id,
             (
               select l.tier from licenses l
               where l.user_id = u.id and l.status = 'active' and l.expires_at > now()
               order by l.expires_at desc
               limit 1
             ) as active_tier,
             exists (select 1 from licenses l where l.user_id = u.id) as ever_licensed
      from users u
      where u.role = 'user'
    )
    select
      (select count(*) filter (where active_tier = 'paid') from scoped) as paid,
      (select count(*) filter (where active_tier = 'trial') from scoped) as trial,
      (select count(*) filter (where active_tier = 'team') from scoped) as team,
      (select count(*) filter (where active_tier = 'deal') from scoped) as deal,
      (select count(*) filter (where active_tier is null and ever_licensed) from scoped) as lapsed,
      (select count(*) filter (where active_tier is null and not ever_licensed) from scoped) as free,
      (select count(*) from scoped) as total,
      (select count(*) from users where role = 'admin') as admins
  `);
  const row = result.rows[0];
  return {
    total: Number(row?.total ?? 0),
    free: Number(row?.free ?? 0),
    paid: Number(row?.paid ?? 0),
    trial: Number(row?.trial ?? 0),
    team: Number(row?.team ?? 0),
    deal: Number(row?.deal ?? 0),
    lapsed: Number(row?.lapsed ?? 0),
    admins: Number(row?.admins ?? 0),
  };
}

export interface RecentSignupRow {
  userId: string;
  email: string | null;
  displayName: string | null;
  createdAt: Date;
  statusLabel: "Paid" | "Trial" | "Team" | "Deal" | "Lapsed" | "Free";
}

export async function getRecentSignups(limit = 10): Promise<RecentSignupRow[]> {
  const result = await pool.query<{
    id: string;
    email: string | null;
    display_name: string | null;
    created_at: Date;
    active_tier: string | null;
    ever_licensed: boolean;
  }>(
    `select u.id, u.email, u.display_name, u.created_at,
            (
              select l.tier from licenses l
              where l.user_id = u.id and l.status = 'active' and l.expires_at > now()
              order by l.expires_at desc
              limit 1
            ) as active_tier,
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
    statusLabel:
      r.active_tier === "paid"
        ? "Paid"
        : r.active_tier === "trial"
          ? "Trial"
          : r.active_tier === "team"
            ? "Team"
            : r.active_tier === "deal"
              ? "Deal"
              : r.ever_licensed
                ? "Lapsed"
                : "Free",
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
 * `mrr` is a crude proxy (this month's customer-sourced "in" payments), not a real
 * recurring-revenue figure. Flagged to marcus/coxwell rather than leaving it "not
 * tracked" now that the payments table backs gross/net for real.
 */
export interface RevenueStats {
  grossIn: number;
  totalOut: number;
  net: number;
  grossInThisMonth: number;
  totalOutThisMonth: number;
  netThisMonth: number;
  mrr: number;
}

export async function getRevenueStats(): Promise<RevenueStats> {
  const totals = await getPaymentTotals();
  return {
    grossIn: totals.grossIn,
    totalOut: totals.totalOut,
    net: totals.net,
    grossInThisMonth: totals.grossInThisMonth,
    totalOutThisMonth: totals.totalOutThisMonth,
    netThisMonth: totals.netThisMonth,
    mrr: totals.mrrProxy,
  };
}
