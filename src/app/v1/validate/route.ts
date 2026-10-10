import { NextRequest, NextResponse } from "next/server";
import { verifyLicenseKey } from "@/lib/licenses";
import { checkValidateRateLimit } from "@/lib/rate-limit";
import { httpsViolation, clientIp } from "@/lib/client-endpoints";
import { signResponse, signingConfigured } from "@/lib/response-signing";
import { captureConnectionIp } from "@/lib/server-registration";
import {
  HWID_MISMATCH_MESSAGE,
  MAX_HWID_LENGTH,
  hwidEnforced,
  isForeignHardwareId,
  recordValidateHardwareId,
} from "@/lib/license-hwid";

/**
 * /v1/validate — desktop-client activation call.
 * Flow (from client reverse-engineering): client prompts for key → saves license.dat → POST here.
 * Request body (FROZEN, from probe): { licensekey, hardwareid, currentversion }.
 *
 * STATUS: request plumbing, rate-limiting, HTTPS enforcement, key lookup, response
 * signing and the response schema are all real. The schema below is the contract the
 * rebuilt desktop client verifies against — see the RESPONSE CONTRACT note on the
 * payload. HWID binding (0099): an active licence binds to the first clean hardwareid and
 * every (licence, hwid) is recorded; refusing another PC is behind HWID_ENFORCE (off at ship).
 */
export async function POST(req: NextRequest) {
  const httpErr = httpsViolation(req);
  if (httpErr) return httpErr;

  let body: { licensekey?: unknown; hardwareid?: unknown; currentversion?: unknown };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "invalid json" }, { status: 400 });
  }

  const licenseKey = body.licensekey;
  const hardwareId = body.hardwareid;
  if (typeof licenseKey !== "string" || !licenseKey) {
    return NextResponse.json({ error: "licensekey required" }, { status: 400 });
  }
  if (typeof hardwareId !== "string" || !hardwareId) {
    return NextResponse.json({ error: "hardwareid required" }, { status: 400 });
  }
  if (hardwareId.length > MAX_HWID_LENGTH) {
    return NextResponse.json({ error: "hardwareid too long" }, { status: 400 });
  }
  // currentversion is informational for now; captured but not gated on.
  const currentVersion = typeof body.currentversion === "string" ? body.currentversion : null;

  const ip = clientIp(req);
  if (!(await checkValidateRateLimit(licenseKey, ip))) {
    return NextResponse.json({ error: "rate limited" }, { status: 429 });
  }

  const result = await verifyLicenseKey(licenseKey);
  if (result.status === "not_found") {
    return NextResponse.json({ status: "not_found" }, { status: 404 });
  }

  if (result.licenseId) {
    captureConnectionIp(result.licenseId, ip, "validate", `https://portal.horizonhft.com/admin/connections/${result.licenseId}`).catch(
      () => {}
    );
  }

  // One licence, one PC (0099, src/lib/license-hwid.ts). Active licences only: an expired or
  // revoked key never binds and writes no row. Every active validate binds first-seen (clean
  // values only) and records the (licence, hwid) pair; it is refused only under HWID_ENFORCE,
  // which is off at ship. A database error here is a 500, never a mismatch, so an outage can't
  // look like key sharing.
  let foreignPc = false;
  if (result.status === "active" && result.licenseId) {
    try {
      const boundHwid = await recordValidateHardwareId(
        result.licenseId,
        hardwareId,
        currentVersion ? currentVersion.slice(0, 64) : null,
        ip === "unknown" ? null : ip
      );
      foreignPc = isForeignHardwareId(boundHwid, hardwareId);
    } catch (err) {
      console.error("[v1/validate] hwid record failed", err);
      return NextResponse.json({ error: "internal error" }, { status: 500 });
    }
  }

  // RESPONSE CONTRACT (frozen 2026-07-26). The client verifies the Ed25519 signature
  // over canonicalize(data), then gates startup on data.status === "active".
  // NOTE: expired and revoked keys also return HTTP 200 — the status FIELD decides,
  // not the status code. Adding a field is backward-compatible; renaming or removing
  // one breaks every deployed client, since the signature covers the whole object.
  const payload = {
    status: result.status,
    expires_at: result.expiresAt ? result.expiresAt.toISOString() : null,
    server_time: new Date().toISOString(),
    version: currentVersion,
  };

  // A refusal is a SIGNED HTTP 200 with status "hwid_mismatch" plus `message`, nothing else
  // added. Never a 404 (every client build deletes the saved key on any 404) and never
  // "revoked"/"expired" (those halt a running session and a halted Grid basket loses its
  // TP/SL/trailing/DD). Clients 2.0.5-2.0.8 refuse it at startup as an unexpected status,
  // ignore `message`, and ignore it mid-session. The active payload never carries `message`.
  const verdict =
    foreignPc && hwidEnforced()
      ? { ...payload, status: "hwid_mismatch" as const, message: HWID_MISMATCH_MESSAGE }
      : payload;

  // Security finding #2: response must be signed so the client can verify offline.
  const signed = signResponse(verdict);
  if (!signed) {
    if (process.env.NODE_ENV === "production" && signingConfigured() === false) {
      // Fail closed in prod rather than serve an unsigned, MITM-forgeable response.
      return NextResponse.json({ error: "signing not configured" }, { status: 503 });
    }
    return NextResponse.json(verdict); // local dev without a key: unsigned
  }
  return NextResponse.json(signed);
}
