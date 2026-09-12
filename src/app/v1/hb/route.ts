import { NextRequest, NextResponse } from "next/server";
import { checkHeartbeatRateLimit } from "@/lib/rate-limit";
import { httpsViolation, clientIp } from "@/lib/client-endpoints";
import { captureConnectionIp } from "@/lib/server-registration";
import { recordHeartbeat, resolveLicenseKey } from "@/lib/client-heartbeats";

/**
 * /v1/hb — desktop-client heartbeat. LISTEN-ONLY.
 *
 * Every shipped client v2.0.2–v2.0.5 POSTs this (one POST per open trading tab, 45s
 * warm-up then every 180s) and the portal has never had the route, so it has been 404ing
 * for real licensed customers. coxwell's ruling (via FOC12, 21:02Z 2026-09-11): the portal
 * accepts the beat, records it, and returns 204 with an empty body — never an `adj`, never
 * any instruction. The remote price-adjust lever the withheld scaffold contemplated
 * (f8d1dcd on feat/v1-client-license-endpoints) is NOT being built; FOC12 removes the
 * client-side `adj` parse in v2.0.6 independently. Nothing here changes trading behaviour.
 *
 * Request body, per FOC12's read of TradingTabInstance.cs:
 *   { "lk": licensekey, "hid": hwid, "d1", "d2", "d3", "sp", "eh", "v": version }
 * Note lk/hid/v — NOT the key/hwid/version in f8d1dcd's docstring, which is stale.
 * d1..d3 are debugger flags, sp the names of any reversing/proxy tools the client saw
 * running, eh its own exe hash. This is anti-tamper telemetry: we store it and act on
 * nothing. No rule, gate or alert reads these columns.
 *
 * NO ORACLE: an unknown, expired or revoked key gets the same 204 as a good one. The
 * response must not let an attacker probe key validity, which is exactly what the
 * withheld scaffold's 403-on-inactive did. The only non-204 answers are shape verdicts
 * (malformed JSON, missing lk/hid), the production HTTPS guard, and the rate-limit 429 —
 * none of which read the key, so none of them say anything about it.
 *
 * UNAUTHENTICATED, and deliberately so — listen-only means there is nothing to protect on
 * the way out. There is no shared secret and no response signing: response-signing.ts is
 * untouched, and a signature over an empty 204 would protect nothing. The client ignores
 * the response entirely (never checks status, swallows all errors), so no status code we
 * pick here can change its behaviour.
 *
 * Writes go to client_heartbeats (migration 0085), upserted one row per
 * (license_key, hwid) — see that file's header for the grain and null semantics.
 */

// lk/hid are opaque client-supplied identifiers; cap them so a hostile caller can't use
// an unauthenticated endpoint to push megabyte rows. Real values are far under these.
const MAX_ID_LENGTH = 256;
const MAX_VERSION_LENGTH = 64;
const MAX_HASH_LENGTH = 256;
const MAX_SP_BYTES = 4000;
const MAX_RAW_BYTES = 8000;

/** 204 with a genuinely empty body — NextResponse.json(null) would send "null". */
function noContent(): NextResponse {
  return new NextResponse(null, { status: 204 });
}

function optionalString(value: unknown, max: number): string | null {
  return typeof value === "string" && value.length > 0 ? value.slice(0, max) : null;
}

/**
 * Tri-state on purpose. A beat that didn't carry d2 records NULL, not false — false is a
 * claim ("no debugger was attached") we have no evidence for. Non-boolean shapes are
 * accepted because no beat has ever reached a server: the JSON shape is FOC12's reading of
 * the C#, not observed traffic, so a bool serialised as 1 or "true" still lands correctly.
 */
function optionalBool(value: unknown): boolean | null {
  if (typeof value === "boolean") return value;
  if (typeof value === "number") return value !== 0;
  if (typeof value === "string") {
    const normalized = value.trim().toLowerCase();
    if (normalized === "true" || normalized === "1") return true;
    if (normalized === "false" || normalized === "0") return false;
  }
  return null;
}

/**
 * Serialise for a jsonb column, or null if it won't fit. Over-cap stores NULL rather than
 * a truncated string: half a JSON document is not parseable jsonb, and a silently clipped
 * value would read as a complete one.
 */
function optionalJson(value: unknown, maxBytes: number): string | null {
  if (value === undefined || value === null) return null;
  try {
    const json = JSON.stringify(value);
    if (typeof json !== "string" || json.length > maxBytes) return null;
    return json;
  } catch {
    return null; // circular or otherwise unserialisable — not worth failing the beat over
  }
}

export async function POST(req: NextRequest) {
  const httpErr = httpsViolation(req);
  if (httpErr) return httpErr;

  let body: Record<string, unknown>;
  try {
    const parsed: unknown = await req.json();
    // Reject arrays and JSON scalars too: `[1,2]` parses, but body.lk on it is undefined,
    // which would otherwise fall through to the missing-lk branch with a misleading error.
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      return NextResponse.json({ error: "invalid json" }, { status: 400 });
    }
    body = parsed as Record<string, unknown>;
  } catch {
    return NextResponse.json({ error: "invalid json" }, { status: 400 });
  }

  // lk and hid are the row's grain — a beat without them has nothing to upsert on. This
  // 400 is a shape verdict, not a key verdict: it says nothing about whether the key
  // exists, so it doesn't reopen the oracle the 204 closes.
  const licenseKey = optionalString(body.lk, MAX_ID_LENGTH);
  const hwid = optionalString(body.hid, MAX_ID_LENGTH);
  if (!licenseKey || !hwid) {
    return NextResponse.json({ error: "lk and hid required" }, { status: 400 });
  }

  const ip = clientIp(req);

  // Over the cap: drop the beat and answer 429 (marcus's ruling, 2026-09-11). The client
  // ignores the response either way, so the status can't change its behaviour — the point
  // is that a dropped beat shows up in platform logs instead of hiding behind a 204. It
  // doesn't reopen the oracle: the limiter counts the supplied string and the IP without
  // ever looking the key up, so an unknown key throttles exactly like a live one.
  if (!(await checkHeartbeatRateLimit(licenseKey, ip))) {
    return NextResponse.json({ error: "rate limited" }, { status: 429 });
  }

  try {
    // Resolve BEFORE recording: license_id is null only when the key genuinely matched
    // nothing (0085's header), so a failed lookup must not be written as a null — it
    // would be a false statement about the key. If this throws, the beat isn't recorded.
    const resolved = await resolveLicenseKey(licenseKey);

    await recordHeartbeat({
      licenseKey,
      hwid,
      licenseId: resolved?.licenseId ?? null,
      userId: resolved?.userId ?? null,
      clientVersion: optionalString(body.v, MAX_VERSION_LENGTH),
      d1: optionalBool(body.d1),
      d2: optionalBool(body.d2),
      d3: optionalBool(body.d3),
      sp: optionalJson(body.sp, MAX_SP_BYTES),
      exeHash: optionalString(body.eh, MAX_HASH_LENGTH),
      // clientIp() returns the literal "unknown" with no x-forwarded-for; store NULL
      // rather than that sentinel, so "we don't know" doesn't read as an address.
      ip: ip === "unknown" ? null : ip,
      raw: optionalJson(body, MAX_RAW_BYTES),
    });

    // FOC12's ask, coxwell approved with the bundle: beats feed the IP-tracking table too,
    // the same hookup /v1/validate has. Only possible for a resolved key — connection_ips
    // .license_id is NOT NULL with an FK (0031). captureConnectionIp dedupes against the
    // latest row, so a beat on an unchanged IP is one cheap select and writes nothing.
    //
    // Awaited, unlike /v1/validate's fire-and-forget: un-awaited work after the response
    // isn't guaranteed to run on serverless, and a silently-skipped hookup is the failure
    // mode we're trying to close. The client is on a 180s timer and never reads the
    // response, so the added latency costs nothing.
    if (resolved) {
      await captureConnectionIp(
        resolved.licenseId,
        ip,
        "heartbeat",
        `https://portal.horizonhft.com/admin/connections/${resolved.licenseId}`
      );
    }
  } catch (err) {
    // Listen-only: there is nothing to tell the client, and a 500 would only add noise to
    // a caller that discards it. Log so the failure is visible in platform logs.
    console.error("/v1/hb: failed to record heartbeat", err);
  }

  return noContent();
}
