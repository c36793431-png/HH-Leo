/** Feed-box EVENTS (migration 0115): Databento cuts and errors, bridge starts/stops, client connects/rejects, as the
 * box logged them. Plan m70008-10; rulings marcus m70015 (Q1-Q7), m70036 (databento_error); Fable PASS WITH STRIKES
 * m70029 (S1 provider scope needs a non-empty tier set, S2 an open cut is bounded on read); BUILD GO m70031.
 * Append + idempotent on (box, ts, kind), unlike /status's latest-snapshot rows. Events NEVER refresh freshness: the
 * box's clock stays status_reported_at (E5), so a quiet events stream proves nothing either way. */
import { pool } from "./db";
import { isoZ } from "./feed-status";
import type { AuthedBox } from "./feed-boxes";

export const EVENT_KINDS = [
  "databento_silent",
  "databento_error",
  "reconnect_ok",
  "bridge_start",
  "bridge_stop",
  "client_reject",
  "client_connect",
  "client_disconnect",
] as const;
export type EventKind = (typeof EVENT_KINDS)[number];

export const EVENTS_MAX_BYTES = 16 * 1024;
const MAX_EVENTS = 100;
/** The box clock may run this far ahead; anything older than retention is skipped, not stored. */
const AHEAD_MS = 60 * 1000;
export const RETENTION_MS = 30 * 24 * 60 * 60 * 1000;
export const MAX_DURATION_S = 86_400;
/** A closed code, never free text: no digits, dots or colons, so an IP, a login or a token can't ride along (Q2). */
const DETAIL_RE = /^[a-z_]{1,32}$/;

const TOP_KEYS = ["box", "events"];
const EVENT_KEYS = ["ts", "kind", "duration_s", "detail"];

export interface BoxEventIn {
  ts: Date;
  kind: EventKind;
  durationS: number | null;
  detail: string | null;
}
export interface IgnoredEvent {
  ts: string;
  kind: EventKind;
  reason: "ts more than 60 s ahead" | "ts older than 30 days";
}
/** What feed_boxes.events_ignored holds: the count and at most the first 50 (Fable m70044 condition 2), so a bulk
 * bad-clock POST can't park a near-16 KB blob on the box row. */
export const STORED_IGNORED_MAX = 50;
export interface StoredIgnored {
  count: number;
  first: IgnoredEvent[];
}

/** Strict, as parseStatusBody: only the listed keys, each checked; a bad shape anywhere is a whole-body 400. An event
 * whose ts is outside [now - 30 d, now + 60 s] is skipped and listed, not a 400 (v1's skip-and-list), so one bad clock
 * line doesn't drop a backlog. */
export function parseEventsBody(
  body: unknown,
  now: Date = new Date()
): { ok: true; box: string; events: BoxEventIn[]; ignored: IgnoredEvent[] } | { ok: false; error: string } {
  if (!body || typeof body !== "object" || Array.isArray(body)) return { ok: false, error: "body must be one JSON object" };
  const b = body as Record<string, unknown>;
  const extra = Object.keys(b).filter((k) => !TOP_KEYS.includes(k));
  if (extra.length) return { ok: false, error: `unknown field(s): ${extra.join(", ")}` };
  if (typeof b.box !== "string" || !b.box) return { ok: false, error: "box must be the box's name" };
  if (!Array.isArray(b.events) || b.events.length === 0) return { ok: false, error: "events must be a non-empty array" };
  if (b.events.length > MAX_EVENTS) return { ok: false, error: `at most ${MAX_EVENTS} events` };

  const events: BoxEventIn[] = [];
  const ignored: IgnoredEvent[] = [];
  for (const [i, raw] of b.events.entries()) {
    const at = `events[${i}]`;
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) return { ok: false, error: `${at} must be an object` };
    const e = raw as Record<string, unknown>;
    const eExtra = Object.keys(e).filter((k) => !EVENT_KEYS.includes(k));
    if (eExtra.length) return { ok: false, error: `${at}: unknown field(s): ${eExtra.join(", ")}` };
    const ts = isoZ(e.ts);
    if (!ts) return { ok: false, error: `${at}.ts must be an ISO timestamp ending in Z` };
    if (typeof e.kind !== "string" || !(EVENT_KINDS as readonly string[]).includes(e.kind)) {
      return { ok: false, error: `${at}.kind must be one of ${EVENT_KINDS.join(", ")}` };
    }
    const kind = e.kind as EventKind;
    let durationS: number | null = null;
    if (e.duration_s !== undefined && e.duration_s !== null) {
      if (kind !== "databento_silent") return { ok: false, error: `${at}: duration_s is only for databento_silent` };
      if (typeof e.duration_s !== "number" || !Number.isInteger(e.duration_s) || e.duration_s < 0 || e.duration_s > MAX_DURATION_S) {
        return { ok: false, error: `${at}.duration_s must be an integer 0-${MAX_DURATION_S}, or null` };
      }
      durationS = e.duration_s;
    }
    let detail: string | null = null;
    if (e.detail !== undefined && e.detail !== null) {
      if (typeof e.detail !== "string" || !DETAIL_RE.test(e.detail)) return { ok: false, error: `${at}.detail must match ${DETAIL_RE}, or null` };
      detail = e.detail;
    }
    if (ts.getTime() > now.getTime() + AHEAD_MS) ignored.push({ ts: e.ts as string, kind, reason: "ts more than 60 s ahead" });
    else if (ts.getTime() < now.getTime() - RETENTION_MS) ignored.push({ ts: e.ts as string, kind, reason: "ts older than 30 days" });
    else events.push({ ts, kind, durationS, detail });
  }
  return { ok: true, box: b.box, events, ignored };
}

/** One transaction. The box row is locked first and the rows go in (ts, kind) order, so a retry overlapping a slow
 * first POST queues instead of deadlocking on the pk (Fable m70029 N1). The box's rows older than 30 d are deleted
 * first (E4). On a pk conflict only an OPEN cut can change: duration_s is set when the stored one is null and the new
 * one isn't ("closed"); everything else changes nothing ("duplicate"), so a replay can't reopen or re-time a cut (E2).
 * A close keeps the open row's detail and received_at (N4). Two events of one kind at the same ts are one row (N2):
 * the box's log precision decides how close two can be. events_ignored is overwritten by EVERY accepted POST, a clean
 * one included (count 0), so it never shows an earlier POST's skips; same as status_ignored (N5, Fable m70044). */
export async function recordBoxEvents(
  box: AuthedBox,
  events: BoxEventIn[],
  ignored: IgnoredEvent[]
): Promise<{ stored: number; closed: number; duplicate: number; ignored: IgnoredEvent[] }> {
  const client = await pool.connect();
  try {
    await client.query("begin");
    await client.query(`select id from feed_boxes where id = $1 for update`, [box.id]);
    await client.query(`delete from feed_box_events where box_id = $1 and ts < now() - interval '30 days'`, [box.id]);
    const ordered = [...events].sort((a, b) => a.ts.getTime() - b.ts.getTime() || (a.kind < b.kind ? -1 : a.kind > b.kind ? 1 : 0));
    let stored = 0;
    let closed = 0;
    let duplicate = 0;
    for (const e of ordered) {
      const r = await client.query(
        `insert into feed_box_events (box_id, ts, kind, duration_s, detail, received_at)
         values ($1, $2, $3, $4, $5, now())
         on conflict (box_id, ts, kind) do update set duration_s = excluded.duration_s
          where feed_box_events.duration_s is null and excluded.duration_s is not null
         returning (xmax = 0) as inserted`,
        [box.id, e.ts, e.kind, e.durationS, e.detail]
      );
      const row = r.rows[0] as { inserted: boolean } | undefined;
      if (!row) duplicate++;
      else if (row.inserted) stored++;
      else closed++;
    }
    const kept: StoredIgnored = { count: ignored.length, first: ignored.slice(0, STORED_IGNORED_MAX) };
    await client.query(`update feed_boxes set events_ignored = $2::jsonb where id = $1`, [box.id, JSON.stringify(kept)]);
    await client.query("commit");
    return { stored, closed, duplicate, ignored };
  } catch (err) {
    await client.query("rollback").catch(() => {});
    throw err;
  } finally {
    client.release();
  }
}
