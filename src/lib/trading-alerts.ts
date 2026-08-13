import { pool } from "./db";

export interface InsertTradingAlertArgs {
  userId: string;
  licenseId: string | null;
  alertType: string;
  message: string;
  symbol: string | null;
  pnl: string | null;
  strategy: string | null;
}

/** Fire-and-forget from /v1/hft-alert — persisted regardless of Telegram delivery
 * outcome (even not_linked users still see it on the portal Dashboard). */
export async function insertTradingAlert(args: InsertTradingAlertArgs): Promise<void> {
  await pool.query(
    `insert into trading_alerts (user_id, license_id, alert_type, message, symbol, pnl, strategy)
     values ($1, $2, $3, $4, $5, $6, $7)`,
    [args.userId, args.licenseId, args.alertType, args.message, args.symbol, args.pnl, args.strategy]
  );
}

export interface TradingAlertRow {
  id: string;
  alertType: string;
  message: string;
  symbol: string | null;
  pnl: string | null;
  strategy: string | null;
  licenseId: string | null;
  licenseKey: string | null;
  createdAt: Date;
}

/** Dashboard "Recent Alerts" panel + /alerts full-history page. Joins the (possibly
 * revoked/expired) license so historical alerts still show which key generated them. */
export async function getRecentAlertsForUser(userId: string, limit: number): Promise<TradingAlertRow[]> {
  const result = await pool.query(
    `select a.id, a.alert_type, a.message, a.symbol, a.pnl, a.strategy, a.license_id, a.created_at,
            l.license_key
     from trading_alerts a
     left join licenses l on l.id = a.license_id
     where a.user_id = $1
     order by a.created_at desc
     limit $2`,
    [userId, limit]
  );
  return result.rows.map((r) => ({
    id: r.id,
    alertType: r.alert_type,
    message: r.message,
    symbol: r.symbol,
    pnl: r.pnl,
    strategy: r.strategy,
    licenseId: r.license_id,
    licenseKey: r.license_key,
    createdAt: r.created_at,
  }));
}

/** How many distinct licenses this user's alert history spans — drives whether the
 * per-row license tag renders (skip it when everything came from the one license). */
export async function countDistinctAlertLicenses(userId: string): Promise<number> {
  const result = await pool.query<{ count: string }>(
    `select count(distinct license_id) as count from trading_alerts where user_id = $1 and license_id is not null`,
    [userId]
  );
  return Number(result.rows[0]?.count ?? 0);
}

const RETENTION_DAYS = 90;

/** Called from the daily expire-licenses cron — no dedicated cron entry for this alone. */
export async function pruneOldTradingAlerts(): Promise<number> {
  const result = await pool.query(
    `delete from trading_alerts where created_at < now() - interval '${RETENTION_DAYS} days'`
  );
  return result.rowCount ?? 0;
}
