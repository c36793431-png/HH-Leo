import { NextRequest, NextResponse } from "next/server";
import { runClientVersionAlert } from "@/lib/client-version-alert";

/** Daily (Hobby crons run once a day), after the 03:30 heartbeat flush: one note to coxwell listing clients on an
 * old Horizon build, or a "heartbeats stale" note when client_heartbeats has gone quiet. Same CRON_SECRET bearer
 * check as the other cron routes. A failed send answers 502 so the cron run shows as failed. */
function authorized(req: NextRequest): boolean {
  const secret = process.env.CRON_SECRET;
  if (!secret) return false;
  return req.headers.get("authorization") === `Bearer ${secret}`;
}

export async function GET(req: NextRequest) {
  if (!authorized(req)) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  try {
    return NextResponse.json(await runClientVersionAlert());
  } catch (err) {
    console.error("client-version-alert failed", err instanceof Error ? err.message : err);
    return NextResponse.json({ error: "alert failed" }, { status: 502 });
  }
}
