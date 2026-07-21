import { NextRequest, NextResponse } from "next/server";
import { verifyLicenseKey } from "@/lib/licenses";
import { checkVerifyLicenseRateLimit } from "@/lib/rate-limit";

/** Phone-home endpoint the C# client bakes in — frozen contract, see spec §API endpoints. */
export async function POST(req: NextRequest) {
  let body: { license_key?: unknown };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "invalid json" }, { status: 400 });
  }

  const licenseKey = body.license_key;
  if (typeof licenseKey !== "string" || !licenseKey) {
    return NextResponse.json({ error: "license_key required" }, { status: 400 });
  }

  const ip = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? "unknown";
  const allowed = await checkVerifyLicenseRateLimit(licenseKey, ip);
  if (!allowed) {
    return NextResponse.json({ error: "rate limited" }, { status: 429 });
  }

  const result = await verifyLicenseKey(licenseKey);
  if (result.status === "not_found") {
    return NextResponse.json({ status: "not_found" }, { status: 404 });
  }

  return NextResponse.json({ status: result.status, expires_at: result.expiresAt });
}
