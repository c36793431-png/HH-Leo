import { NextRequest, NextResponse } from "next/server";
import { checkMigrationDrift } from "@/lib/migration-drift";
import { notifyMigrationDrift } from "@/lib/telemetry-sink";

function authorized(req: NextRequest): boolean {
  const secret = process.env.CRON_SECRET;
  if (!secret) return false;
  return req.headers.get("authorization") === `Bearer ${secret}`;
}

/** Daily drift check between db/migrations/*.sql and schema_migrations
 * (leo-migration-drift-check-2026-08-22, marcus). Also reachable as a health check by
 * hitting this route directly -- returns 500 if drift is detected so uptime monitoring
 * can alert on it too, not just the Telegram ping. */
export async function GET(req: NextRequest) {
  if (!authorized(req)) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const drift = await checkMigrationDrift();

  if (drift.missing.length > 0) {
    await notifyMigrationDrift(drift.missing).catch((err) => {
      console.error("migration-drift-check: notify failed", err);
    });
    return NextResponse.json(drift, { status: 500 });
  }

  return NextResponse.json(drift);
}
