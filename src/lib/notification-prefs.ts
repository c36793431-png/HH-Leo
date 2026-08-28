import { pool } from "./db";

/** Bus thread provider-notification-prefs-2026-08-29. One key per event row on the
 * Notifications page (src/app/feed/dashboard/notifications/page.tsx) -- keep this list and
 * that page's rows in lockstep; a key here with no row, or a row with no key, is a bug. */
export const NOTIFICATION_EVENT_KEYS = [
  "new_signup",
  "trial_requested",
  "paid_subscription",
  "trial_expired",
  "tick_gap",
  "uptime_below_threshold",
  "latency_drift",
  "payout_sent",
  "tier_review_decision",
  "daily_digest",
] as const;

export type NotificationEventKey = (typeof NOTIFICATION_EVENT_KEYS)[number];

type PrefMap = Record<NotificationEventKey, boolean>;

function defaultPrefs(): PrefMap {
  return Object.fromEntries(NOTIFICATION_EVENT_KEYS.map((k) => [k, true])) as PrefMap;
}

/** 42P01 = undefined_table -- migration 0070 hasn't landed on this database yet. Every
 * function here treats that exactly like a missing row: enabled. Never let a pre-migration
 * database turn a read into a crash or a send path into a hard failure. */
function isMissingTable(err: unknown): boolean {
  return typeof err === "object" && err !== null && (err as { code?: string }).code === "42P01";
}

/** Full key->enabled map for rendering the Notifications page, defaulting anything absent
 * (missing row, or the table not existing yet) to enabled -- see 0070's migration comment. */
export async function getNotificationPrefs(userId: string): Promise<PrefMap> {
  const prefs = defaultPrefs();
  try {
    const result = await pool.query<{ event_key: string; enabled: boolean }>(
      `select event_key, enabled from provider_notification_prefs where user_id = $1`,
      [userId]
    );
    for (const row of result.rows) {
      if ((NOTIFICATION_EVENT_KEYS as readonly string[]).includes(row.event_key)) {
        prefs[row.event_key as NotificationEventKey] = row.enabled;
      }
    }
    return prefs;
  } catch (err) {
    if (isMissingTable(err)) return prefs;
    throw err;
  }
}

/** Toggle handler. Pre-migration this throws a clear, user-facing error instead of a raw
 * SQL error -- there's nowhere yet to persist the change, and pretending otherwise would
 * be the exact "toggle nobody reads" bug this table exists to fix, just moved to the write
 * side instead of the read side. */
export async function setNotificationPref(userId: string, eventKey: NotificationEventKey, enabled: boolean): Promise<void> {
  try {
    await pool.query(
      `insert into provider_notification_prefs (user_id, event_key, enabled)
       values ($1, $2, $3)
       on conflict (user_id, event_key) do update set enabled = excluded.enabled, updated_at = now()`,
      [userId, eventKey, enabled]
    );
  } catch (err) {
    if (isMissingTable(err)) {
      throw new Error("Notification preferences can't be saved yet -- the migration hasn't landed on this database.");
    }
    throw err;
  }
}

/** For send paths to consult before dispatching. Same default-enabled rule as
 * getNotificationPrefs, so a send path wired to this degrades to "send" (today's actual
 * behavior) rather than "silently drop everything" if it runs before 0070 is applied. */
export async function isNotificationEnabled(userId: string, eventKey: NotificationEventKey): Promise<boolean> {
  try {
    const result = await pool.query<{ enabled: boolean }>(
      `select enabled from provider_notification_prefs where user_id = $1 and event_key = $2`,
      [userId, eventKey]
    );
    return result.rows[0]?.enabled ?? true;
  } catch (err) {
    if (isMissingTable(err)) return true;
    throw err;
  }
}
