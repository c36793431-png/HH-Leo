import { NextRequest, NextResponse } from "next/server";
import { authenticateBox, parseAppliedBody, recordApplied } from "@/lib/feed-boxes";

/** POST: one write-back per record, {record_id, applied_at, result, reason?} (Fable m62433 item 1). Production
 * only, per-box bearer token; the record must be on this box's tiers. */
export async function POST(req: NextRequest) {
  const auth = await authenticateBox(req.headers);
  if ("status" in auth) return NextResponse.json({ error: auth.error }, { status: auth.status });
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "body must be JSON" }, { status: 400 });
  }
  const parsed = parseAppliedBody(body);
  if (!parsed.ok) return NextResponse.json({ error: parsed.error }, { status: 400 });
  const out = await recordApplied(auth.box, parsed);
  if (out.error) return NextResponse.json({ error: out.error }, { status: out.status });
  return NextResponse.json({ ok: true });
}
