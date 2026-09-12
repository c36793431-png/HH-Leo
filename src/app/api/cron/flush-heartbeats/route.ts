import { NextRequest, NextResponse } from "next/server";
import { captureConnectionIp } from "@/lib/server-registration";
import { resolveLicenseKey, upsertBufferedHeartbeat } from "@/lib/client-heartbeats";
import { clearBeatCount, drainDirty, requeue, type DrainedBeat } from "@/lib/heartbeat-buffer";

function authorized(req: NextRequest): boolean {
  const secret = process.env.CRON_SECRET;
  if (!secret) return false;
  return req.headers.get("authorization") === `Bearer ${secret}`;
}

/** Per run. Bounds both the Upstash reads and the time this invocation can spend. */
const MAX_KEYS_PER_RUN = 500;

interface FlushSummary {
  keysFlushed: number;
  rowsWritten: number;
  ipsCaptured: number;
  requeued: number;
  skipped: number;
}

async function flushOne(beat: DrainedBeat): Promise<{ written: boolean; ipCaptured: boolean }> {
  // Resolved at FLUSH time, not beat time. license_id is null only when the key genuinely
  // matched nothing (0085's header), so a lookup that throws must not be written as a null —
  // that would be a false statement about the key. Letting it throw re-queues the key instead.
  const resolved = await resolveLicenseKey(beat.licenseKey);

  await upsertBufferedHeartbeat({
    licenseKey: beat.licenseKey,
    hwid: beat.hwid,
    licenseId: resolved?.licenseId ?? null,
    userId: resolved?.userId ?? null,
    clientVersion: beat.clientVersion,
    d1: beat.d1,
    d2: beat.d2,
    d3: beat.d3,
    sp: beat.sp,
    exeHash: beat.exeHash,
    ip: beat.ip,
    raw: beat.raw,
    beats: beat.beats,
    lastSeen: beat.lastSeen,
    firstSeen: beat.firstSeen,
  });

  // Only the counter is cleared, and only after the row is safely written. The rest of the
  // hash stays so the next beat still diffs against it.
  await clearBeatCount(beat.licenseKey, beat.hwid);

  // FOC12's ask, coxwell approved with the bundle: beats feed the IP-tracking table too, the
  // same hookup /v1/validate has. Only possible for a resolved key — connection_ips.license_id
  // is NOT NULL with an FK (0031).
  //
  // Once per key per run, on the buffered IP, instead of once per beat. That is what closes
  // the residue I flagged: captureConnectionIp windows the IP-MISMATCH alert to 24h for
  // source "heartbeat", but notifyCountryChange has no such window, so a client flapping
  // between two countries' egress addresses could re-alert every 180s. Evaluating geo at most
  // 48 times a day per key caps both alerts by construction, without a new alert-log table
  // (marcus: "your imprecision is acceptable").
  let ipCaptured = false;
  if (resolved && beat.ip) {
    try {
      await captureConnectionIp(
        resolved.licenseId,
        beat.ip,
        "heartbeat",
        `https://portal.horizonhft.com/admin/connections/${resolved.licenseId}`
      );
      ipCaptured = true;
    } catch (err) {
      // The heartbeat row is already durable; an IP-capture failure must not re-queue the key
      // and cause a second beat_count add on the retry.
      console.error("flush-heartbeats: captureConnectionIp failed", beat.member, err);
    }
  }

  return { written: true, ipCaptured };
}

/**
 * Drains the /v1/hb beat buffer into client_heartbeats (marcus's redesign ruling, 2026-09-11).
 *
 * Beats buffer in Upstash so that Postgres is off the request path entirely — Neon autosuspends
 * and ~560 beats/hr at ~3 queries each would keep the compute awake permanently. This sweep is
 * the only thing that writes the table: <= 48 runs/day, one upsert per active (key, hwid).
 *
 * SAFE TO RE-RUN, but not free to re-run blindly: beat_count ACCUMULATES, so a key must only be
 * flushed once per buffered window. That is why the counter is cleared per key immediately after
 * its own upsert, and why a key is re-queued only when its upsert did NOT happen.
 *
 * Until 0085 is applied the upsert throws 42P01 ("relation does not exist"), which is caught per
 * key, logged, and re-queued — so no beat is lost in the window between this merging and marcus
 * applying the migration.
 */
export async function GET(req: NextRequest) {
  if (!authorized(req)) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const summary: FlushSummary = { keysFlushed: 0, rowsWritten: 0, ipsCaptured: 0, requeued: 0, skipped: 0 };

  let drained: DrainedBeat[];
  try {
    drained = await drainDirty(MAX_KEYS_PER_RUN);
  } catch (err) {
    console.error("flush-heartbeats: could not drain the buffer", err);
    return NextResponse.json({ error: "drain failed" }, { status: 500 });
  }

  summary.keysFlushed = drained.length;
  const failed: string[] = [];

  for (const beat of drained) {
    try {
      const result = await flushOne(beat);
      if (result.written) summary.rowsWritten++;
      if (result.ipCaptured) summary.ipsCaptured++;
    } catch (err) {
      // Re-queue so nothing is lost; the next run retries this key with its counter intact.
      failed.push(beat.member);
      console.error("flush-heartbeats: failed flushing key", beat.member, err);
    }
  }

  if (failed.length > 0) {
    await requeue(failed);
    summary.requeued = failed.length;
  }
  summary.skipped = summary.keysFlushed - summary.rowsWritten - summary.requeued;

  // One line per run, per marcus's ask.
  console.log(
    `flush-heartbeats: keys=${summary.keysFlushed} rows=${summary.rowsWritten} ` +
      `ips=${summary.ipsCaptured} requeued=${summary.requeued} skipped=${summary.skipped}`
  );

  return NextResponse.json(summary);
}
