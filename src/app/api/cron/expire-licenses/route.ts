import { NextRequest, NextResponse } from "next/server";
import { pool } from "@/lib/db";
import { removeFromPaidGroup } from "@/lib/group-membership";
import { notifyUser } from "@/lib/notify";
import { getPortalConfig } from "@/lib/portal-config";

interface ExpiredRow {
  license_id: string;
  user_id: string;
  telegram_user_id: string | null;
  email: string | null;
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
    `select l.id as license_id, u.id as user_id, u.telegram_user_id, u.email
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
      processed++;
    } catch (err) {
      console.error("expire-licenses: failed processing license", row.license_id, err);
    }
  }

  return NextResponse.json({ processed, checked: expired.rowCount ?? 0 });
}
