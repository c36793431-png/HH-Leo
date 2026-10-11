import { NextRequest, NextResponse } from "next/server";
import { authenticateBox } from "@/lib/feed-boxes";
import { parseStatusBody, recordStatusReport, STATUS_MAX_BYTES } from "@/lib/feed-status";

/** POST: the latest state of each feed this box measures (feed-status.ts; plan m64510-2, Fable m64547 S1-S3, marcus
 * m64552). Production only, per-box bearer token (the allowlist's), application/json up to 16 KB. 200 {ok, stored,
 * ignored, superseded}: unknown or out-of-set feed ids are skipped and listed; an older report than the last accepted
 * one is superseded and changes nothing. */
export async function POST(req: NextRequest) {
  const auth = await authenticateBox(req.headers);
  if ("status" in auth) return NextResponse.json({ error: auth.error }, { status: auth.status });
  if (!/^application\/json(;|$)/i.test(req.headers.get("content-type") ?? "")) {
    return NextResponse.json({ error: "content-type must be application/json" }, { status: 415 });
  }
  if (Number(req.headers.get("content-length") ?? 0) > STATUS_MAX_BYTES) return NextResponse.json({ error: "body over 16 KB" }, { status: 413 });
  const text = await req.text();
  if (Buffer.byteLength(text, "utf8") > STATUS_MAX_BYTES) return NextResponse.json({ error: "body over 16 KB" }, { status: 413 });
  let body: unknown;
  try {
    body = JSON.parse(text);
  } catch {
    return NextResponse.json({ error: "body must be JSON" }, { status: 400 });
  }
  const parsed = parseStatusBody(body);
  if (!parsed.ok) return NextResponse.json({ error: parsed.error }, { status: 400 });
  // A token copied onto the wrong box shows up here, not as another box's feeds.
  if (parsed.report.box !== auth.box.name) return NextResponse.json({ error: "box does not match this token's box" }, { status: 400 });
  const out = await recordStatusReport(auth.box, parsed.report);
  return NextResponse.json({ ok: true, ...out });
}
