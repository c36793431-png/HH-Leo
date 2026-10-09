import { NextRequest, NextResponse } from "next/server";
import { authenticateBox, buildSignedAllowlist } from "@/lib/feed-boxes";

/** GET: the signed effective-active allowlist for the calling box (feed-boxes.ts). Production only, per-box bearer
 * token. Never served unsigned: no signing key = 503. no-store so no proxy can hand the box a stale list. */
export async function GET(req: NextRequest) {
  const auth = await authenticateBox(req.headers);
  if ("status" in auth) return NextResponse.json({ error: auth.error }, { status: auth.status });
  const envelope = await buildSignedAllowlist(auth.box);
  if (!envelope) return NextResponse.json({ error: "signing not configured" }, { status: 503 });
  return NextResponse.json(envelope, { headers: { "cache-control": "no-store" } });
}
