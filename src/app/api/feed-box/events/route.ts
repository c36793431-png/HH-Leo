import { NextRequest, NextResponse } from "next/server";
import { authenticateBox } from "@/lib/feed-boxes";
import { EVENTS_MAX_BYTES, parseEventsBody, recordBoxEvents } from "@/lib/feed-box-events";

/** POST: what the box's bridge logged (feed-box-events.ts; plan m70008-10, marcus m70015 Q1 + m70036, Fable m70029).
 * Same gates as /status: production only, the box's bearer token, application/json up to 16 KB, box = the token's.
 * Not folded into /status: that refuses a report older than 5 min, and events must take a backlog. 200 {ok, stored,
 * closed, duplicate, ignored}: "closed" = an open cut got its duration; "duplicate" = a row already there, unchanged
 * (a retry, a replay, or a close whose detail differs from the open row's: the open row's detail and received_at are
 * kept, N4). Two events of one kind at one ts are one row (N2), so the box's log precision bounds that. An event
 * outside [now - 30 d, now + 60 s] is skipped and listed in ignored (and shown on /admin/feed-health). */
export async function POST(req: NextRequest) {
  const auth = await authenticateBox(req.headers);
  if ("status" in auth) return NextResponse.json({ error: auth.error }, { status: auth.status });
  if (!/^application\/json(;|$)/i.test(req.headers.get("content-type") ?? "")) {
    return NextResponse.json({ error: "content-type must be application/json" }, { status: 415 });
  }
  if (Number(req.headers.get("content-length") ?? 0) > EVENTS_MAX_BYTES) return NextResponse.json({ error: "body over 16 KB" }, { status: 413 });
  const text = await req.text();
  if (Buffer.byteLength(text, "utf8") > EVENTS_MAX_BYTES) return NextResponse.json({ error: "body over 16 KB" }, { status: 413 });
  let body: unknown;
  try {
    body = JSON.parse(text);
  } catch {
    return NextResponse.json({ error: "body must be JSON" }, { status: 400 });
  }
  const parsed = parseEventsBody(body);
  if (!parsed.ok) return NextResponse.json({ error: parsed.error }, { status: 400 });
  if (parsed.box !== auth.box.name) return NextResponse.json({ error: "box does not match this token's box" }, { status: 400 });
  const out = await recordBoxEvents(auth.box, parsed.events, parsed.ignored);
  return NextResponse.json({ ok: true, ...out });
}
