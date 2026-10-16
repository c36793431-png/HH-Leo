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
const DAY_MS = 24 * 60 * 60 * 1000;
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

// ---------- the read side ----------

export interface BoxEvent {
  ts: Date;
  kind: EventKind;
  durationS: number | null;
  detail: string | null;
}

/** The read cap per box (Fable m70234 N1): only the non-client kinds are read, and they alone feed resolveEvents, the
 * 24 h line and the events table. */
export const READ_CAP = 2000;
/** Never listed, only counted (marcus m70721): one flapping client logs ~60 rows/min (m70717), so a table of the newest
 * 50 of every kind covered ~50 s and pushed each cut off it, and READ_CAP rows of them span ~33 min, too few to count a
 * day from. So the 24 h counts are a SQL count over the same box ids. */
export const CLIENT_KINDS: EventKind[] = ["client_reject", "client_connect", "client_disconnect"];

export interface ClientCounts {
  connect: number;
  disconnect: number;
  reject: number;
}

export interface LoadedBoxEvents {
  /** Non-client events only. */
  events: BoxEvent[];
  ignored: StoredIgnored;
  /** Set when the read hit READ_CAP: the ts of its oldest row read. Rows before it weren't read. */
  truncatedBefore: Date | null;
  /** client_* events with ts in the last 24 h of `now` (the 24 h line's window). */
  clients24h: ClientCounts;
}

/** Each box's non-client events within 30 d of `now`, newest first (at most READ_CAP), its client_* counts for 24 h,
 * plus its last POST's skipped events. One query each. */
export async function loadBoxEvents(boxIds: string[], now: Date = new Date()): Promise<Map<string, LoadedBoxEvents>> {
  const out = new Map<string, LoadedBoxEvents>();
  if (boxIds.length === 0) return out;
  for (const id of boxIds) {
    out.set(id, { events: [], ignored: { count: 0, first: [] }, truncatedBefore: null, clients24h: { connect: 0, disconnect: 0, reject: 0 } });
  }
  const ev = await pool.query(
    `select e.box_id, e.ts, e.kind, e.duration_s, e.detail
       from unnest($1::uuid[]) as b(id)
      cross join lateral (
        select x.box_id, x.ts, x.kind, x.duration_s, x.detail from feed_box_events x
         where x.box_id = b.id and not (x.kind = any($3::text[])) and x.ts >= $2::timestamptz - interval '30 days'
         order by x.ts desc, x.kind
         limit $4) e
      order by e.box_id, e.ts desc, e.kind`,
    [boxIds, now, CLIENT_KINDS, READ_CAP]
  );
  const read = new Map<string, { n: number; oldest: Date }>();
  for (const r of ev.rows as Record<string, unknown>[]) {
    const c = read.get(r.box_id as string);
    read.set(r.box_id as string, { n: (c?.n ?? 0) + 1, oldest: new Date(r.ts as Date) });
    out.get(r.box_id as string)!.events.push({
      ts: new Date(r.ts as Date),
      kind: r.kind as EventKind,
      durationS: (r.duration_s as number | null) ?? null,
      detail: (r.detail as string | null) ?? null,
    });
  }
  const cl = await pool.query(
    `select box_id, kind, count(*)::int as n from feed_box_events
      where box_id = any($1::uuid[]) and kind = any($3::text[]) and ts >= $2::timestamptz - interval '24 hours'
      group by box_id, kind`,
    [boxIds, now, CLIENT_KINDS]
  );
  for (const r of cl.rows as { box_id: string; kind: EventKind; n: number }[]) {
    const c = out.get(r.box_id)!.clients24h;
    if (r.kind === "client_connect") c.connect = r.n;
    else if (r.kind === "client_disconnect") c.disconnect = r.n;
    else c.reject = r.n;
  }
  const ig = await pool.query(`select id, events_ignored from feed_boxes where id = any($1::uuid[])`, [boxIds]);
  for (const r of ig.rows as Record<string, unknown>[]) {
    const raw = typeof r.events_ignored === "string" ? JSON.parse(r.events_ignored) : r.events_ignored;
    out.get(r.id as string)!.ignored = (raw as StoredIgnored | null) ?? { count: 0, first: [] };
  }
  for (const [id, c] of read) if (c.n >= READ_CAP) out.get(id)!.truncatedBefore = c.oldest;
  return out;
}

/** An open cut (duration_s null) can lose its close for good: the sender restarts, the box is offline, the close POST
 * 5xxs. So on read (Fable m70029 S2): the first LATER reconnect_ok, bridge_start, bridge_stop or databento_silent for
 * the box ends it, "closed, duration unknown" (a sender that restarts mid-cut opens a second cut: only the newest stays
 * open, Fable m70044; a later cut that closed also means this one can't still be dark; once the bridge has stopped,
 * Databento silence is moot, Fable m70234 N2). Failing that, a status row reported up
 * with a tick after the cut's ts proves data flowed again: "cut not closed by the sender". Only a cut with neither
 * reads "dark now", capped at 86400 s (the 0115 CHECK). */
export type CutState = "closed" | "open" | "ended_unknown" | "not_closed";
const ENDS_A_CUT = new Set<EventKind>(["reconnect_ok", "bridge_start", "bridge_stop", "databento_silent"]);
export interface ResolvedEvent extends BoxEvent {
  cut: { state: CutState; seconds: number | null; capped: boolean; endedBy: { kind: EventKind; ts: Date } | null } | null;
}

export function resolveEvents(events: BoxEvent[], ctx: { latestUpTickAt: Date | null }, now: Date = new Date()): ResolvedEvent[] {
  return events.map((e) => {
    if (e.kind !== "databento_silent") return { ...e, cut: null };
    if (e.durationS !== null) return { ...e, cut: { state: "closed", seconds: e.durationS, capped: false, endedBy: null } };
    const later = events
      .filter((x) => ENDS_A_CUT.has(x.kind) && x.ts.getTime() > e.ts.getTime())
      .reduce<BoxEvent | null>((first, x) => (!first || x.ts.getTime() < first.ts.getTime() ? x : first), null);
    if (later) return { ...e, cut: { state: "ended_unknown", seconds: null, capped: false, endedBy: { kind: later.kind, ts: later.ts } } };
    if (ctx.latestUpTickAt && ctx.latestUpTickAt.getTime() > e.ts.getTime()) {
      return { ...e, cut: { state: "not_closed", seconds: null, capped: false, endedBy: null } };
    }
    const elapsed = Math.max(0, Math.floor((now.getTime() - e.ts.getTime()) / 1000));
    return { ...e, cut: { state: "open", seconds: Math.min(elapsed, MAX_DURATION_S), capped: elapsed > MAX_DURATION_S, endedBy: null } };
  });
}

export interface EventsSummary {
  /** Cuts that STARTED in the last 24 h (N7: a cut that began 24 h 1 min ago drops out whole). */
  cuts: number;
  /** Closed cuts' seconds + an open cut's seconds so far. Cuts ended without a duration don't count. */
  darkS: number;
  longestS: number | null;
  noDuration: number;
  errors: number;
  open: ResolvedEvent | null;
  /** The read cap (N1) reached into the last 24 h: the counts are a floor. */
  partial: boolean;
}

export function summarize24h(resolved: ResolvedEvent[], now: Date = new Date(), truncatedBefore: Date | null = null): EventsSummary {
  const from = now.getTime() - DAY_MS;
  const recent = resolved.filter((e) => e.ts.getTime() >= from);
  const cuts = recent.filter((e) => e.cut);
  const timed = cuts.filter((e) => e.cut!.seconds !== null).map((e) => e.cut!.seconds!);
  return {
    partial: truncatedBefore !== null && truncatedBefore.getTime() >= from,
    cuts: cuts.length,
    darkS: timed.reduce((s, n) => s + n, 0),
    longestS: timed.length ? Math.max(...timed) : null,
    noDuration: cuts.length - timed.length,
    errors: recent.filter((e) => e.kind === "databento_error").length,
    // Newest open cut, from all 30 d: a cut still open since yesterday is still dark now.
    open: resolved.find((e) => e.cut?.state === "open") ?? null,
  };
}

/** U3 + Fable m70029 S1: the boxes a provider may see = at least one tier on the box (apply ∪ status) AND every one of
 * them is that provider's. Box-level events (a cut, a reject) belong to the whole box, so "any tier mine" would show
 * one provider another's rejects on a mixed box; and "no tier differs" alone is vacuous for a tier-less box. */
export async function providerBoxIds(providerUserId: string): Promise<string[]> {
  const r = await pool.query(
    `with t as (
       select box_id, feed_tier_id from feed_box_tiers
       union
       select box_id, feed_tier_id from feed_box_status_tiers
     )
     select b.id from feed_boxes b
      where exists (select 1 from t where t.box_id = b.id)
        and not exists (
          select 1 from t join feed_tiers ft on ft.id = t.feed_tier_id
           where t.box_id = b.id and ft.provider_user_id is distinct from $1::uuid)
      order by b.name`,
    [providerUserId]
  );
  return (r.rows as { id: string }[]).map((x) => x.id);
}
