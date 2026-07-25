import { NextRequest, NextResponse } from "next/server";
import { verifyLicenseKey } from "@/lib/licenses";
import { checkValidateRateLimit } from "@/lib/rate-limit";
import { httpsViolation, clientIp } from "@/lib/client-endpoints";
import { signResponse, signingConfigured } from "@/lib/response-signing";

/**
 * /v1/validate — desktop-client activation call.
 * Flow (Axiom probe): client prompts for key → saves license.dat → POST here.
 * Request body (FROZEN, from probe): { licensekey, hardwareid, currentversion }.
 *
 * SCAFFOLD STATUS: request plumbing, rate-limiting, HTTPS enforcement, key lookup and
 * response signing are real. The response *schema* is a placeholder — Axiom did not
 * dump what the shipped client parses from a 200 (may be status-code-only). Do not
 * treat the `data` shape below as the frozen contract until that lands. HWID binding
 * is stubbed: it needs the hardware_id column from migration 0003, which stays
 * UNAPPLIED until the field set is confirmed.
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

  // TODO(hwid-binding): once 0003 is applied and the algo/opaque-token decision is
  // final, bind first-seen hwid to the license and reject mismatches here:
  //   - on first activation: store licenses.hardware_id = hardwareId, activated_at = now()
  //   - on subsequent calls: if stored hardware_id != hardwareId -> 409 hwid_mismatch
  // The server treats hardwareId as an OPAQUE token (equality compare) — it does NOT
  // recompute the fingerprint, so the CPU/disk/MAC concat+hash algo is not needed here.
  void hardwareId;

  // TODO(frozen-schema): confirm with Axiom whether the client reads this body or only
  // the HTTP status. Placeholder shape below — NOT the frozen contract yet.
  const payload = {
    status: result.status,
    expires_at: result.expiresAt,
    server_time: null as string | null, // set at send time once schema confirmed
    version: currentVersion,
    _scaffold: true, // remove once contract is frozen
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
