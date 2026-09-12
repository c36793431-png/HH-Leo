import { pool } from "./db";

/**
 * Persistence for /v1/hb, the desktop client's listen-only heartbeat (migration 0085).
 *
 * Grain is one row per (license_key, hwid), upserted -- not one row per beat. At 20
 * beats/hr/tab a per-beat log grows without bound for no extra signal.
 *
 * NOTHING HERE RUNS ON A BEAT. Since marcus's redesign ruling (2026-09-11) the beat path is
 * Redis-only (src/lib/heartbeat-buffer.ts) and every function in this file is called from the
 * /api/cron/flush-heartbeats sweep, at most 48 times a day, so Neon's compute can suspend
 * between runs. Putting any of this back on the request path re-opens the compute gun.
 */

export interface HeartbeatRecord {
  licenseKey: string;
  hwid: string;
  licenseId: string | null;
  userId: string | null;
  clientVersion: string | null;
  d1: boolean | null;
  d2: boolean | null;
  d3: boolean | null;
  /** Already JSON-serialised, or null. Shape unobserved -- see 0085's header. */
  sp: string | null;
  exeHash: string | null;
  ip: string | null;
  /** Already JSON-serialised body of this beat, or null when it exceeded the cap. */
  raw: string | null;
  /** Beats buffered since the last flush. Added to beat_count, not assigned. */
  beats: number;
  /** When the newest buffered beat arrived -- becomes last_seen. NOT now(): the row must
   * date the beat, not the sweep that happened to drain it up to 30 minutes later. */
  lastSeen: Date;
  /** When this (key, hwid) first beat. Used only on insert; never overwrites an existing row. */
  firstSeen: Date;
}

export interface ResolvedLicense {
  licenseId: string;
  userId: string | null;
}

/**
 * license_key -> id/user_id. Deliberately NOT verifyLicenseKey(): that writes
 * licenses.last_verified_at on every call, which at 20 beats/hr/tab would both hammer a hot
 * table and silently redefine "last verified" to mean "last heartbeat" on every admin surface
 * that reads it. A heartbeat is not a validation. Status is not checked here either -- an
 * expired or revoked key still records, the row is telemetry, not an entitlement.
 */
export async function resolveLicenseKey(licenseKey: string): Promise<ResolvedLicense | null> {
  const result = await pool.query<{ id: string; user_id: string | null }>(
    `select id, user_id from licenses where license_key = $1`,
    [licenseKey]
  );
  const row = result.rows[0];
  return row ? { licenseId: row.id, userId: row.user_id } : null;
}

/**
 * Upsert one (key, hwid)'s buffered window. ONE statement per key per flush run.
 *
 * 0085's semantics are unchanged by the buffering: every telemetry column is overwritten with
 * the NEWEST buffered beat's value, including with null when that beat didn't carry the field
 * -- the row describes what was reported at last_seen, so coalescing an older value forward
 * would misdate it (0085's header). The buffer preserves that by rewriting every field on
 * every beat, so "the latest beat" is exactly what the hash holds.
 *
 * beat_count accumulates (+= the buffered count) rather than incrementing by one, and
 * last_seen/first_seen come from the buffer rather than now(), so a 30-minute flush window is
 * invisible in the stored row apart from when it was physically written.
 */
export async function upsertBufferedHeartbeat(hb: HeartbeatRecord): Promise<void> {
  await pool.query(
    `insert into client_heartbeats
       (license_key, hwid, license_id, user_id, client_version, d1, d2, d3, sp, exe_hash, ip, raw,
        first_seen, last_seen, beat_count)
     values ($1, $2, $3, $4, $5, $6, $7, $8, $9::jsonb, $10, $11, $12::jsonb, $13, $14, $15)
     on conflict (license_key, hwid) do update set
       license_id = excluded.license_id,
       user_id = excluded.user_id,
       client_version = excluded.client_version,
       d1 = excluded.d1,
       d2 = excluded.d2,
       d3 = excluded.d3,
       sp = excluded.sp,
       exe_hash = excluded.exe_hash,
       ip = excluded.ip,
       raw = excluded.raw,
       -- first_seen is deliberately NOT updated: the existing row already holds the earlier one.
       last_seen = excluded.last_seen,
       beat_count = client_heartbeats.beat_count + excluded.beat_count`,
    [
      hb.licenseKey,
      hb.hwid,
      hb.licenseId,
      hb.userId,
      hb.clientVersion,
      hb.d1,
      hb.d2,
      hb.d3,
      hb.sp,
      hb.exeHash,
      hb.ip,
      hb.raw,
      hb.firstSeen,
      hb.lastSeen,
      hb.beats,
    ]
  );
}
