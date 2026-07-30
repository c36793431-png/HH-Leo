import { NextRequest, NextResponse } from "next/server";
import { pool } from "@/lib/db";
import { REFERRAL_CLAWBACK_DAYS } from "@/lib/referrals";

function authorized(req: NextRequest): boolean {
  const secret = process.env.CRON_SECRET;
  if (!secret) return false;
  return req.headers.get("authorization") === `Bearer ${secret}`;
}

/**
 * Daily Vercel Cron sweep: flips referral_earnings past the 14-day clawback window from
 * pending to cleared. Idempotent by construction — the WHERE clause only ever matches rows
 * still in 'pending', so re-running the same day is a no-op for already-cleared rows.
 */
export async function GET(req: NextRequest) {
  if (!authorized(req)) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const result = await pool.query(
    `update referral_earnings
     set status = 'cleared', cleared_at = now()
     where status = 'pending'
       and earned_at <= now() - interval '${REFERRAL_CLAWBACK_DAYS} days'
     returning id`
  );

  return NextResponse.json({ cleared: result.rowCount ?? 0 });
}
