import { NextRequest, NextResponse } from "next/server";
import { verifyLicenseKey } from "@/lib/licenses";
import { checkHeartbeatRateLimit } from "@/lib/rate-limit";
import { httpsViolation, clientIp } from "@/lib/client-endpoints";
import { signResponse, signingConfigured } from "@/lib/response-signing";
import { forwardHeartbeat } from "@/lib/telemetry-sink";

/**
 * /v1/hb — desktop-client heartbeat. Called from TradingTabInstance.cs:592.
 * Request body (FROZEN, from probe): { key, hwid, version, d1, d2, d3, sp, eh }.
 *
 * IMPORTANT — this is a CONTROL channel, not just telemetry. Axiom found the response
 * carries a "calibration adjustment" the client APPLIES to live trading behavior. That
 * makes response authenticity non-negotiable: a forged/MITM'd heartbeat response could
 * steer a live HFT client. So this route:
 *   1. authenticates the caller (key must resolve to an active license), and
 *   2. SIGNS its response (finding #2), and fails closed in prod if it can't.
 *
 * SCAFFOLD STATUS: auth, rate-limiting, HTTPS enforcement, telemetry forwarding and
 * signing are real. The calibration-adjustment response *schema* is a placeholder —
 * Axiom did not dump it. Do not treat the `data` shape as frozen until it lands.
 */
export async function POST(req: NextRequest) {
  const httpErr = httpsViolation(req);
  if (httpErr) return httpErr;

  let body: {
    key?: unknown;
    hwid?: unknown;
    version?: unknown;
    d1?: unknown;
    d2?: unknown;
    d3?: unknown;
    sp?: unknown;
    eh?: unknown;
  };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "invalid json" }, { status: 400 });
  }

  const key = body.key;
  const hwid = body.hwid;
  if (typeof key !== "string" || !key) {
    return NextResponse.json({ error: "key required" }, { status: 400 });
  }
  if (typeof hwid !== "string" || !hwid) {
    return NextResponse.json({ error: "hwid required" }, { status: 400 });
  }

  const ip = clientIp(req);
  if (!(await checkHeartbeatRateLimit(key, ip))) {
    return NextResponse.json({ error: "rate limited" }, { status: 429 });
  }

  // Auth: only an active license may heartbeat. This is the control-channel gate —
  // don't hand a calibration payload to an unknown/expired/revoked caller.
  const license = await verifyLicenseKey(key);
  if (license.status !== "active") {
    return NextResponse.json({ status: license.status }, { status: 403 });
  }

  // TODO(hwid-binding): once 0003 is applied, reject a heartbeat whose hwid doesn't
  // match the license's bound hardware_id (opaque equality compare, see /v1/validate).

  // Telemetry up: forward to the server-side sink (Telegram). Best-effort, non-blocking.
  const version = typeof body.version === "string" ? body.version : undefined;
  await forwardHeartbeat({
    key,
    hwid,
    version,
    d1: body.d1,
    d2: body.d2,
    d3: body.d3,
    sp: body.sp,
    eh: body.eh,
    ip,
  });

  // TODO(frozen-schema): replace with the real calibration-adjustment payload once
  // Axiom dumps it, AND confirm what computes it (operator config vs derived from
  // d1/d2/d3/sp/eh). Placeholder below — NOT the frozen contract.
  const payload = {
    calibration: null as unknown, // real adjustment object goes here
    expires_at: license.expiresAt,
    server_time: null as string | null,
    _scaffold: true,
  };

  // Control channel => response MUST be signed. Fail closed in prod if we can't sign.
  const signed = signResponse(payload);
  if (!signed) {
    if (process.env.NODE_ENV === "production" && signingConfigured() === false) {
      return NextResponse.json({ error: "signing not configured" }, { status: 503 });
    }
    return NextResponse.json(payload); // local dev without a key: unsigned
  }
  return NextResponse.json(signed);
}
