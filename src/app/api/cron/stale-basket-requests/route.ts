import { NextRequest, NextResponse } from "next/server";
import { runStaleBasketReminders } from "@/lib/client-reach";

/** Daily (Vercel Hobby crons run once a day; marcus m61862): one approvals-topic reminder per basket request still
 * 'new' after 24h (marcus m61849 part 5). Idempotent: reminded_at is claimed before the send, so a re-run or an
 * overlapping run never reminds twice. Same CRON_SECRET bearer check as the other cron routes. */
function authorized(req: NextRequest): boolean {
  const secret = process.env.CRON_SECRET;
  if (!secret) return false;
  return req.headers.get("authorization") === `Bearer ${secret}`;
}

export async function GET(req: NextRequest) {
  if (!authorized(req)) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const reminded = await runStaleBasketReminders();
  return NextResponse.json({ reminded });
}
