import { pool } from "@/lib/db";

/**
 * One licence, one PC: PHASE 1, observe-only (0099; plan m63391/m63392/m63418, Fable m63552, GO m63554).
 *
 * The hardwareid is an OPAQUE token computed by the client (first 32 hex chars of a SHA-256 over CPU id, disk 0 serial
 * and the first IP-enabled MAC, uppercase). The server never recomputes, trims or case-folds it: equality only.
 * 2.0.9+ also sends hardwareid2 (hid2) and hwdegraded; 0111 binds one hid2 per licence, rules below.
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

/**
 * 2.0.9+ (0111, HWID wire contract v1 + Fable m67568 S2/S3/C1). hardwareid2 = hid2, SHA-256('hid2|MachineGuid|SMBIOS
 * UUID')[:32] uppercase; hwdegraded = which identity sources failed. Both are optional and ABSENT when the key is not
 * sent. A value that fails its shape check is treated as ABSENT, never a 400: a 400 blocks the client's startup.
 */
const HWID2_SHAPE = /^[0-9A-F]{32}$/;
const MAX_HWDEGRADED_LENGTH = 32;
const HWDEGRADED_TOKENS = new Set(["cpu", "disk", "mac", "guid", "uuid"]);
/** The sources the hid is computed from. If one failed, the hid sent is a fallback value (Fable S3). */
const HID_SOURCES = ["cpu", "disk", "mac"];

export function parseHardwareId2(value: unknown): string | null {
  return typeof value === "string" && HWID2_SHAPE.test(value) ? value : null;
}

export function parseHwDegraded(value: unknown): string | null {
  if (typeof value !== "string" || value.length === 0 || value.length > MAX_HWDEGRADED_LENGTH) return null;
  return value.split(",").every((token) => HWDEGRADED_TOKENS.has(token)) ? value : null;
}

/** What one validate says about the PC it came from: the hid as sent, plus the parsed 2.0.9 fields. */
export type ValidateIdentity = { hwid: string; hwid2: string | null; hwdegraded: string | null };

/** The licence's bindings after the bind statement. null = unbound. */
export type BoundIdentity = { hardwareId: string | null; hardwareId2: string | null };

/**
 * True when the hid sent is not this PC's real fingerprint: the HWID-ERROR- value, or hwdegraded names cpu, disk or
 * mac. Such a hid never binds and is never refused (Fable S3, extends marcus m63419 (i) to the 2.0.9 fallback hid).
 */
export function isFallbackHardwareId(identity: ValidateIdentity): boolean {
  if (identity.hwid.startsWith(HWID_ERROR_PREFIX)) return true;
  const failed = identity.hwdegraded?.split(",") ?? [];
  return HID_SOURCES.some((source) => failed.includes(source));
}

/** Printable ASCII only (Fable C3): it is inside the signed body, and both canonicalisers must emit it byte-identically. */
export const HWID_MISMATCH_MESSAGE = "This licence is active on another PC. Contact support to move it.";

export function hwidEnforced(): boolean {
  const value = process.env.HWID_ENFORCE;
  return value === "1" || value === "true";
}

/** $2 = hid, $5 = hid is not a fallback, $6 = hid2 or null. Both read the row as it was before the statement. */
const BIND_HID = `(hardware_id is null and $5::boolean and (hardware_id2 is null or hardware_id2 = $6::text))`;
const BIND_HID2 = `(hardware_id2 is null and $6::text is not null and (hardware_id is null or hardware_id = $2))`;

/**
 * Called by /v1/validate after verifyLicenseKey, for ACTIVE licences only. In one statement (Fable C2): binds the
 * hid and the hid2, each at most once, and upserts the (licence, hwid) row in license_hwid_seen with what this
 * request carried. Returns the licence's bindings AFTER the bind.
 *
 * Every CASE reads the row as it was before this statement. The hid binds when it is unbound, the hid is not a
 * fallback, and the licence has no hid2 or this request carries the bound one. The hid2 binds when it is unbound, the
 * request carries one, and the licence has no hid or this request's hid IS the bound one (Fable S2): a sharer's
 * 2.0.9 on another PC never binds the hid2, so turning enforcement on can't lock the owner out of their own key. The
 * hid's guard is the mirror of S2, so a PC refused on the hid2 can't take the hid either.
 *
 * The UPDATE touches the row even when it is already bound so that RETURNING reads the latest committed binding:
 * if two PCs validate an unbound key at once, the second waits on the row lock, re-evaluates the CASEs against the
 * first one's committed row and returns the winner's values, so exactly one binds and the other sees a mismatch.
 * Throws on any database error; the caller answers 500, never a mismatch.
 */
export async function recordValidateHardwareId(
  licenseId: string,
  identity: ValidateIdentity,
  version: string | null,
  ip: string | null
): Promise<BoundIdentity> {
  const result = await pool.query<{ hardware_id: string | null; hardware_id2: string | null }>(
    `with bound as (
       update licenses set
         hardware_id = case when ${BIND_HID} then $2 else hardware_id end,
         hardware_bound_at = case when ${BIND_HID} then now() else hardware_bound_at end,
         hardware_id2 = case when ${BIND_HID2} then $6 else hardware_id2 end,
         hardware_id2_bound_at = case when ${BIND_HID2} then now() else hardware_id2_bound_at end,
         activated_at = case when ${BIND_HID} or ${BIND_HID2} then coalesce(activated_at, now()) else activated_at end
       where id = $1
       returning hardware_id, hardware_id2
     ), seen as (
       insert into license_hwid_seen (license_id, hwid, last_version, last_ip, last_hwid2, last_hwdegraded)
       values ($1, $2, $3, $4, $6, $7)
       on conflict (license_id, hwid) do update set
         last_seen = now(),
         hits = license_hwid_seen.hits + 1,
         last_version = excluded.last_version,
         last_ip = excluded.last_ip,
         last_hwid2 = excluded.last_hwid2,
         last_hwdegraded = excluded.last_hwdegraded
     )
     select hardware_id, hardware_id2 from bound`,
    [licenseId, identity.hwid, version, ip, !isFallbackHardwareId(identity), identity.hwid2, identity.hwdegraded]
  );
  const row = result.rows[0];
  return { hardwareId: row?.hardware_id ?? null, hardwareId2: row?.hardware_id2 ?? null };
}

/**
 * True only when ANOTHER PC holds the binding. Order (contract v1 3.3 + Fable S3):
 *   3.3a both sides have a hid2: it alone decides; the hid is ignored (it is still recorded in seen).
 *   S3   otherwise a fallback hid is never refused.
 *   3.3b otherwise the hid decides, as for 2.0.8 clients: refused only when a different hid is bound.
 */
export function isForeignPc(bound: BoundIdentity, identity: ValidateIdentity): boolean {
  if (identity.hwid2 !== null && bound.hardwareId2 !== null) return identity.hwid2 !== bound.hardwareId2;
  if (isFallbackHardwareId(identity)) return false;
  return bound.hardwareId !== null && bound.hardwareId !== identity.hwid;
}

/**
 * Admin "Reset PC": clears hardware_id and hardware_id2 with their bound_at stamps, keeps activated_at and every
 * license_hwid_seen row. Returns what was bound, or null if neither was (nothing written). The next validate binds
 * whichever PC sends it.
 */
export async function resetLicenseHardwareId(licenseId: string): Promise<BoundIdentity | null> {
  const result = await pool.query<{ previous_hardware_id: string | null; previous_hardware_id2: string | null }>(
    `update licenses l set hardware_id = null, hardware_bound_at = null, hardware_id2 = null, hardware_id2_bound_at = null
     from (select id, hardware_id, hardware_id2 from licenses
           where id = $1 and (hardware_id is not null or hardware_id2 is not null) for update) old
     where l.id = old.id
     returning old.hardware_id as previous_hardware_id, old.hardware_id2 as previous_hardware_id2`,
    [licenseId]
  );
  const row = result.rows[0];
  return row ? { hardwareId: row.previous_hardware_id, hardwareId2: row.previous_hardware_id2 } : null;
}
