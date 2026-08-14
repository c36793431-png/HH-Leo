import { NextRequest, NextResponse } from "next/server";
import { pool } from "@/lib/db";
import { sendHftAlertMessage } from "@/lib/telegram-hft-alert-bot";
import { feedTierMeta } from "@/lib/feed-tier-catalogue";

interface TrialRow {
  id: string;
  telegram_user_id: string | null;
  tier_key: string;
  trial_ends_at: Date;
}

function authorized(req: NextRequest): boolean {
  const secret = process.env.CRON_SECRET;
  if (!secret) return false;
  return req.headers.get("authorization") === `Bearer ${secret}`;
}

async function sendReminders(): Promise<number> {
  const rows = await pool.query<TrialRow>(
    `select ftt.id, u.telegram_user_id, ftt.tier_key, ftt.trial_ends_at
     from feed_tier_trials ftt
     join users u on u.id = ftt.user_id
     where ftt.trial_status = 'active'
       and ftt.reminder_sent_at is null
       and ftt.trial_ends_at <= now() + interval '24 hours'
       and ftt.trial_ends_at > now()`
  );

  let sent = 0;
  for (const row of rows.rows) {
    try {
      const claim = await pool.query(
        `update feed_tier_trials set reminder_sent_at = now() where id = $1 and reminder_sent_at is null returning id`,
        [row.id]
      );
      if (!claim.rowCount) continue; // already claimed by a concurrent run
      if (row.telegram_user_id) {
        const tierName = feedTierMeta(row.tier_key)?.name ?? row.tier_key;
        await sendHftAlertMessage(
          row.telegram_user_id,
          `<b>⏰ Your ${tierName} trial ends in 24 hours</b>\nUpgrade to keep access after it ends.`
        ).catch(() => {});
      }
      sent++;
    } catch (err) {
      console.error("expire-trials: failed sending reminder", row.id, err);
    }
  }
  return sent;
}

async function expireTrials(): Promise<number> {
  const rows = await pool.query<TrialRow>(
    `select ftt.id, u.telegram_user_id, ftt.tier_key, ftt.trial_ends_at
     from feed_tier_trials ftt
     join users u on u.id = ftt.user_id
     where ftt.trial_status = 'active'
       and ftt.trial_ends_at <= now()`
  );

  let expired = 0;
  for (const row of rows.rows) {
    try {
      const claim = await pool.query(
        `update feed_tier_trials set trial_status = 'expired', ended_notified_at = now()
         where id = $1 and trial_status = 'active' returning id`,
        [row.id]
      );
      if (!claim.rowCount) continue;
      if (row.telegram_user_id) {
        const tierName = feedTierMeta(row.tier_key)?.name ?? row.tier_key;
        await sendHftAlertMessage(
          row.telegram_user_id,
          `<b>Trial ended · Upgrade to keep ${tierName} →</b>`
        ).catch(() => {});
      }
      expired++;
    } catch (err) {
      console.error("expire-trials: failed expiring trial", row.id, err);
    }
  }
  return expired;
}

/** Daily Vercel Cron sweep for the trial feature (marcus/coxwell, trial feature add-on,
 * horizon-portal-v2051-polish-2026-08-13). No auto-convert to paid (rule #5) -- this only
 * flips active -> expired and sends the two client DMs (24h-out reminder, trial-ended).
 * Idempotent per trial row via reminder_sent_at / the trial_status transition itself, so a
 * second run the same day is a no-op for rows already claimed. */
export async function GET(req: NextRequest) {
  if (!authorized(req)) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const remindersSent = await sendReminders().catch((err) => {
    console.error("expire-trials: sendReminders failed", err);
    return 0;
  });
  const expired = await expireTrials().catch((err) => {
    console.error("expire-trials: expireTrials failed", err);
    return 0;
  });

  return NextResponse.json({ remindersSent, expired });
}
