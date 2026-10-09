import { NextRequest, NextResponse } from "next/server";
import { createHash, timingSafeEqual } from "crypto";
import { runAllowlistExpiry } from "@/lib/feed-boxes";

/** The allowlist expiry job (Fable m62433 item 3d). OFF: unless AUTOPROVISION_EXPIRY_ENABLED=true it only reports
 * what it would do and writes nothing. Deliberately NOT in vercel.json's crons; scheduling it is coxwell's call when
 * he turns it on. Same CRON_SECRET bearer as the other cron routes, compared timing-safe. */
function authorized(req: NextRequest): boolean {
  const secret = process.env.CRON_SECRET;
  if (!secret) return false;
  const h = (s: string) => createHash("sha256").update(s, "utf8").digest();
  return timingSafeEqual(h(req.headers.get("authorization") ?? ""), h(`Bearer ${secret}`));
}

export async function GET(req: NextRequest) {
  if (!authorized(req)) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const report = await runAllowlistExpiry();
  return NextResponse.json(report);
}
