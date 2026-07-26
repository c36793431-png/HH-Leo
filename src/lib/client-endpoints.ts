import { NextRequest, NextResponse } from "next/server";

/**
 * Shared guards for the desktop-client endpoints (/v1/validate, /v1/hb).
 *
 * Security finding #1: the legacy license server ran over http:// and was trivially
 * MITM-able. The replacement must be HTTPS-only. On Vercel every request already
 * terminates TLS at the edge, but we defend in depth: reject anything that reached us
 * as plain http (x-forwarded-proto), so a misconfigured proxy can't silently downgrade.
 */
export function httpsViolation(req: NextRequest): NextResponse | null {
  // Only enforce in production — local `next dev` is http://localhost.
  if (process.env.NODE_ENV !== "production") return null;
  const proto = req.headers.get("x-forwarded-proto");
  if (proto && proto.split(",")[0].trim() !== "https") {
    return NextResponse.json({ error: "https required" }, { status: 400 });
  }
  return null;
}

/** First hop in x-forwarded-for, or "unknown" — matches the convention in verify-license. */
export function clientIp(req: NextRequest): string {
  return req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? "unknown";
}
