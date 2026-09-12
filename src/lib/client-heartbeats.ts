import { pool } from "./db";

/**
 * Persistence for /v1/hb, the desktop client's listen-only heartbeat (migration 0085).
 *
 * Grain is one row per (license_key, hwid), upserted -- not one row per beat. At 20
 * beats/hr/tab a per-beat log grows without bound for no extra signal.
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
 * Upsert this beat. Every telemetry column is overwritten with THIS beat's value, including
 * with null when the beat didn't carry the field -- the row describes what was reported at
 * last_seen, so coalescing an older value forward would misdate it (0085's header).
 */
export async function recordHeartbeat(hb: HeartbeatRecord): Promise<void> {
  await pool.query(
    `insert into client_heartbeats
       (license_key, hwid, license_id, user_id, client_version, d1, d2, d3, sp, exe_hash, ip, raw)
     values ($1, $2, $3, $4, $5, $6, $7, $8, $9::jsonb, $10, $11, $12::jsonb)
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
       last_seen = now(),
       beat_count = client_heartbeats.beat_count + 1`,
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
    ]
  );
}
