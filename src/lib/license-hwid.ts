import { pool } from "@/lib/db";

/**
 * One licence, one PC: PHASE 1, observe-only (0099; plan m63391/m63392/m63418, Fable m63552, GO m63554).
 *
 * The hardwareid is an OPAQUE token computed by the client (first 32 hex chars of a SHA-256 over CPU id, disk 0 serial
 * and the first IP-enabled MAC, uppercase). The server never recomputes, trims or case-folds it: equality only.
 *
 * Enforcement is HWID_ENFORCE, an env var, OFF at ship. Env vars are snapshotted per deployment, so:
 *   ON  = set HWID_ENFORCE=1, then redeploy the same sha.
 *   OFF = unset it, then redeploy; or Instant Rollback to a deployment made before it was set.
 * Only an exact "1" or "true" enforces, so a typo leaves refusal off.
 */

/** Same cap as /v1/hb's MAX_ID_LENGTH. The client sends 32 hex chars or HWID-ERROR-<MachineName>. */
export const MAX_HWID_LENGTH = 256;

/** The client's WMI total-failure fallback. Never binds, and never refused on a bound key (marcus m63419, option i). */
export const HWID_ERROR_PREFIX = "HWID-ERROR-";

/** Printable ASCII only (Fable C3): it is inside the signed body, and both canonicalisers must emit it byte-identically. */
export const HWID_MISMATCH_MESSAGE = "This licence is active on another PC. Contact support to move it.";

export function hwidEnforced(): boolean {
  const value = process.env.HWID_ENFORCE;
  return value === "1" || value === "true";
}

/**
 * Called by /v1/validate after verifyLicenseKey, for ACTIVE licences only. In one statement: binds the licence to
 * `hwid` if it is unbound and `hwid` is a clean value, and upserts the (licence, hwid) row in license_hwid_seen.
 * Returns the licence's bound hwid AFTER the bind (null = still unbound).
 *
 * The UPDATE touches the row even when it is already bound so that RETURNING reads the latest committed binding:
 * if two PCs validate an unbound key at once, the second waits on the row lock, re-evaluates the CASE against the
 * first one's committed row and returns the winner's hwid, so exactly one binds and the other sees a mismatch.
 * Throws on any database error; the caller answers 500, never a mismatch.
 */
export async function recordValidateHardwareId(
  licenseId: string,
  hwid: string,
  version: string | null,
  ip: string | null
): Promise<string | null> {
  const bindable = !hwid.startsWith(HWID_ERROR_PREFIX);
  const result = await pool.query<{ hardware_id: string | null }>(
    `with bound as (
       update licenses set
         hardware_id = case when hardware_id is null and $5 then $2 else hardware_id end,
         hardware_bound_at = case when hardware_id is null and $5 then now() else hardware_bound_at end,
         activated_at = case when hardware_id is null and $5 then coalesce(activated_at, now()) else activated_at end
       where id = $1
       returning hardware_id
     ), seen as (
       insert into license_hwid_seen (license_id, hwid, last_version, last_ip)
       values ($1, $2, $3, $4)
       on conflict (license_id, hwid) do update set
         last_seen = now(),
         hits = license_hwid_seen.hits + 1,
         last_version = excluded.last_version,
         last_ip = excluded.last_ip
     )
     select hardware_id from bound`,
    [licenseId, hwid, version, ip, bindable]
  );
  return result.rows[0]?.hardware_id ?? null;
}

/** True only when ANOTHER PC holds the binding and `hwid` is a clean fingerprint. */
export function isForeignHardwareId(boundHwid: string | null, hwid: string): boolean {
  return boundHwid !== null && boundHwid !== hwid && !hwid.startsWith(HWID_ERROR_PREFIX);
}

/**
 * Admin "Reset PC": clears hardware_id and hardware_bound_at, keeps activated_at and every license_hwid_seen row.
 * Returns the hwid that was bound, or null if the licence was not bound (nothing written). The next clean validate
 * binds whichever PC sends it.
 */
export async function resetLicenseHardwareId(licenseId: string): Promise<string | null> {
  const result = await pool.query<{ previous_hardware_id: string }>(
    `update licenses l set hardware_id = null, hardware_bound_at = null
     from (select id, hardware_id from licenses where id = $1 and hardware_id is not null for update) old
     where l.id = old.id
     returning old.hardware_id as previous_hardware_id`,
    [licenseId]
  );
  return result.rows[0]?.previous_hardware_id ?? null;
}
