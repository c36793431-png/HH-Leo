import { NextRequest, NextResponse } from "next/server";
import { verifyLicenseKey } from "@/lib/licenses";
import { checkValidateRateLimit } from "@/lib/rate-limit";
import { httpsViolation, clientIp } from "@/lib/client-endpoints";
import { signResponse, signingConfigured } from "@/lib/response-signing";
import { captureConnectionIp } from "@/lib/server-registration";

/**
 * /v1/validate — desktop-client activation call.
 * Flow (from client reverse-engineering): client prompts for key → saves license.dat → POST here.
 * Request body (FROZEN, from probe): { licensekey, hardwareid, currentversion }.
 *
 * STATUS: request plumbing, rate-limiting, HTTPS enforcement, key lookup, response
 * signing and the response schema are all real. The schema below is the contract the
 * rebuilt desktop client verifies against — see the RESPONSE CONTRACT note on the
 * payload. HWID binding is still stubbed: the hardware_id column now exists (migration
 * 0004), but first-seen binding and mismatch rejection are not implemented yet.
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

  // TODO(hwid-binding): the hardware_id column exists as of migration 0004. Once the
  // opaque-token decision is final, bind first-seen hwid and reject mismatches here:
  //   - on first activation: store licenses.hardware_id = hardwareId, activated_at = now()
  //   - on subsequent calls: if stored hardware_id != hardwareId -> 409 hwid_mismatch
  // The server treats hardwareId as an OPAQUE token (equality compare) — it does NOT
  // recompute the fingerprint, so the CPU/disk/MAC concat+hash algo is not needed here.
  void hardwareId;

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

  // Security finding #2: response must be signed so the client can verify offline.
  const signed = signResponse(payload);
  if (!signed) {
    if (process.env.NODE_ENV === "production" && signingConfigured() === false) {
      // Fail closed in prod rather than serve an unsigned, MITM-forgeable response.
      return NextResponse.json({ error: "signing not configured" }, { status: 503 });
    }
    return NextResponse.json(payload); // local dev without a key: unsigned
  }
  return NextResponse.json(signed);
}
