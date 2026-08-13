import { NextRequest, NextResponse } from "next/server";
import { pool } from "@/lib/db";
import { removeFromPaidGroup } from "@/lib/group-membership";
import { notifyUser } from "@/lib/notify";
import { getPortalConfig } from "@/lib/portal-config";
import { notifyLicenseExpired, notifyLicenseExpiringSoon } from "@/lib/telemetry-sink";
import { pruneOldTradingAlerts } from "@/lib/trading-alerts";

interface ExpiredRow {
  license_id: string;
  license_key: string;
  user_id: string;
  telegram_user_id: string | null;
  email: string | null;
}

interface ExpiringSoonRow {
  license_id: string;
  license_key: string;
  user_id: string;
  email: string | null;
  expires_at: Date;
}

/** Daily "7 days out" heads-up to the coxwell sink — idempotent per (user_id, event_type,
 * calendar date) via the lifecycle_notifications table, since a license can sit in the
 * expiring window across several cron runs. */
async function notifyExpiringSoon(): Promise<number> {
  const expiringSoon = await pool.query<ExpiringSoonRow>(
    `select l.id as license_id, l.license_key, u.id as user_id, u.email, l.expires_at
     from licenses l
     join users u on u.id = l.user_id
     where l.status = 'active'
       and l.expires_at > now()
       and l.expires_at <= now() + interval '7 days'`
  );

  let notified = 0;
  for (const row of expiringSoon.rows) {
    try {
      const claim = await pool.query(
        `insert into lifecycle_notifications (user_id, event_type, event_date)
         values ($1, 'license_expiring_soon', current_date)
         on conflict (user_id, event_type, event_date) do nothing
         returning id`,
        [row.user_id]
      );
      if ((claim.rowCount ?? 0) === 0) continue; // already notified today

      await notifyLicenseExpiringSoon({
        email: row.email,
        licenseKey: row.license_key,
        expiresAt: row.expires_at,
      });
      notified++;
    } catch (err) {
      console.error("expire-licenses: failed notifying expiring-soon license", row.license_id, err);
    }
  }
  return notified;
}

function authorized(req: NextRequest): boolean {
  const secret = process.env.CRON_SECRET;
  if (!secret) return false;
  return req.headers.get("authorization") === `Bearer ${secret}`;
}

/**
 * Daily Vercel Cron sweep (spec Phase 4). Must be idempotent: a second run on the
 * same day must not re-kick or re-DM already-processed expiries — guarded by the
 * licenses.lifecycle_state marker, reset to null on renewal (see extendLicense).
 */
export async function GET(req: NextRequest) {
  if (!authorized(req)) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const expired = await pool.query<ExpiredRow>(
    `select l.id as license_id, l.license_key, u.id as user_id, u.telegram_user_id, u.email
     from licenses l
     join users u on u.id = l.user_id
     where l.status = 'active'
       and l.expires_at <= now()
       and (l.lifecycle_state is null or l.lifecycle_state != 'expired_processed')`
  );

  const config = await getPortalConfig();
  let processed = 0;

  for (const row of expired.rows) {
    try {
      if (row.telegram_user_id) {
        await removeFromPaidGroup(row.user_id, row.telegram_user_id);
      }
      await notifyUser(
        { telegramUserId: row.telegram_user_id, email: row.email },
        "Your Horizon HFT subscription has expired",
        `Your subscription has expired and Paid Users Group access has been removed. ` +
          `Renew any time — contact us on Telegram: ${config.telegramChannelUrl}`
      );
      await pool.query(
        `update licenses set lifecycle_state = 'expired_processed' where id = $1`,
        [row.license_id]
      );
      notifyLicenseExpired({
        email: row.email,
        licenseKey: row.license_key,
        expiredAt: new Date(),
      }).catch(() => {});
      processed++;
    } catch (err) {
      console.error("expire-licenses: failed processing license", row.license_id, err);
    }
  }

  const expiringSoonNotified = await notifyExpiringSoon().catch((err) => {
    console.error("expire-licenses: notifyExpiringSoon failed", err);
    return 0;
  });

  const alertsPruned = await pruneOldTradingAlerts().catch((err) => {
    console.error("expire-licenses: pruneOldTradingAlerts failed", err);
    return 0;
  });

  return NextResponse.json({ processed, checked: expired.rowCount ?? 0, expiringSoonNotified, alertsPruned });
}
