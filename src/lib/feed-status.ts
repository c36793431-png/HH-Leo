/** Feed status from a measuring box (FOC13's tommy4 monitor). Plan m64510-2; rulings marcus m64519 (Q1-Q5), m64531
 * (v1 renders on /admin only), m64552 (pk box + feed + symbol, worst-of badge, three sources); Fable m64547 S1-S3 and
 * m64565. The box POSTs the latest state per (feed, symbol); the portal stores the latest row only and computes
 * staleness here, on read, from its OWN receive clock. The box's sent_at only orders reports (S2).
 * Nothing here is shown on a provider card or /feed/dashboard/health in v1 (marcus m64531). */
import { pool } from "./db";
import { formatAbsoluteUtc } from "./format-time";
import type { AuthedBox } from "./feed-boxes";

export const FEED_STATES = ["up", "stale", "down", "closed", "not_measured"] as const;
export type ReportedState = (typeof FEED_STATES)[number];
export const STATUS_SOURCES = ["feedcompare", "bridge_ticks", "bridge_status"] as const;
export type StatusSource = (typeof STATUS_SOURCES)[number];

/** FOC13's thresholds on the box's whole report: fresh up to 2 min, then UNKNOWN, then "No report" after 10 min. */
export const STATUS_UNKNOWN_AFTER_MS = 2 * 60 * 1000;
export const STATUS_NO_REPORT_AFTER_MS = 10 * 60 * 1000;
/** sent_at / last_tick_utc may run this far ahead of the portal clock; a report older than 5 min is refused (S2). */
const AHEAD_MS = 60 * 1000;
const TOO_OLD_MS = 5 * 60 * 1000;
export const STATUS_MAX_BYTES = 16 * 1024;
const MAX_FEEDS = 32;
const MAX_TICKS_PER_MIN = 10_000_000;
const MAX_GAP_MS = 86_400_000;

const TIER_KEY_RE = /^[a-z0-9][a-z0-9-]{0,63}$/;
const SYMBOL_RE = /^[A-Z0-9._]{1,16}$/;
const VERSION_RE = /^[0-9]{1,4}(\.[0-9]{1,4}){0,2}$/;
/** ISO 8601 in UTC with a literal Z, the only form the box sends. */
const ISO_Z_RE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{1,6})?Z$/;

const TOP_KEYS = ["box", "sent_at", "collector", "feeds"];
const FEED_KEYS = ["feed_id", "symbol", "source", "state", "last_tick_utc", "ticks_per_min", "gap_p50_ms", "gap_p99_ms"];

export interface ReportedFeed {
  feedId: string;
  symbol: string;
  source: StatusSource;
  state: ReportedState;
  lastTickAt: Date | null;
  ticksPerMin: number | null;
  gapP50Ms: number | null;
  gapP99Ms: number | null;
}
export interface StatusReport {
  box: string;
  sentAt: Date;
  collector: { version: string; measuring: boolean };
  feeds: ReportedFeed[];
}

export const isoZ = (v: unknown): Date | null => (typeof v === "string" && ISO_Z_RE.test(v) && !Number.isNaN(Date.parse(v)) ? new Date(v) : null);

function intOrNull(v: unknown, max: number): { ok: true; n: number | null } | { ok: false } {
  if (v === undefined || v === null) return { ok: true, n: null };
  if (typeof v !== "number" || !Number.isInteger(v) || v < 0 || v > max) return { ok: false };
  return { ok: true, n: v };
}

/** Strict: only the listed keys, each checked. No free-text field exists, so an IP or a credential has nowhere to
 * ride along. A bad body shape is a whole-body 400; an unknown or out-of-set feed_id is the WRITE's business (it is
 * skipped and listed, so one mapping slip doesn't blank the other feeds). */
export function parseStatusBody(body: unknown, now: Date = new Date()): { ok: true; report: StatusReport } | { ok: false; error: string } {
  if (!body || typeof body !== "object" || Array.isArray(body)) return { ok: false, error: "body must be one JSON object" };
  const b = body as Record<string, unknown>;
  const extra = Object.keys(b).filter((k) => !TOP_KEYS.includes(k));
  if (extra.length) return { ok: false, error: `unknown field(s): ${extra.join(", ")}` };
  if (typeof b.box !== "string" || !b.box) return { ok: false, error: "box must be the box's name" };
  const sentAt = isoZ(b.sent_at);
  if (!sentAt) return { ok: false, error: "sent_at must be an ISO timestamp ending in Z" };
  if (sentAt.getTime() > now.getTime() + AHEAD_MS) return { ok: false, error: "sent_at is more than 60 s in the future" };
  if (sentAt.getTime() < now.getTime() - TOO_OLD_MS) return { ok: false, error: "report too old (sent_at more than 5 min ago)" };

  const c = b.collector;
  if (!c || typeof c !== "object" || Array.isArray(c)) return { ok: false, error: "collector must be {version, measuring}" };
  const cc = c as Record<string, unknown>;
  const cExtra = Object.keys(cc).filter((k) => k !== "version" && k !== "measuring");
  if (cExtra.length) return { ok: false, error: `unknown collector field(s): ${cExtra.join(", ")}` };
  if (typeof cc.version !== "string" || !VERSION_RE.test(cc.version)) return { ok: false, error: "collector.version must be like 0.1.0" };
  if (typeof cc.measuring !== "boolean") return { ok: false, error: "collector.measuring must be true or false" };
  const measuring = cc.measuring;

  if (!Array.isArray(b.feeds)) return { ok: false, error: "feeds must be an array" };
  if (b.feeds.length > MAX_FEEDS) return { ok: false, error: `at most ${MAX_FEEDS} feeds` };
  if (b.feeds.length === 0 && measuring) return { ok: false, error: "feeds may be empty only when collector.measuring is false" };

  const feeds: ReportedFeed[] = [];
  const seen = new Set<string>();
  for (const [i, raw] of b.feeds.entries()) {
    const at = `feeds[${i}]`;
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) return { ok: false, error: `${at} must be an object` };
    const f = raw as Record<string, unknown>;
    const fExtra = Object.keys(f).filter((k) => !FEED_KEYS.includes(k));
    if (fExtra.length) return { ok: false, error: `${at}: unknown field(s): ${fExtra.join(", ")}` };
    if (typeof f.feed_id !== "string" || !TIER_KEY_RE.test(f.feed_id)) return { ok: false, error: `${at}.feed_id must be a tier_key` };
    if (typeof f.symbol !== "string" || !SYMBOL_RE.test(f.symbol)) return { ok: false, error: `${at}.symbol must match ${SYMBOL_RE}` };
    if (typeof f.source !== "string" || !(STATUS_SOURCES as readonly string[]).includes(f.source)) {
      return { ok: false, error: `${at}.source must be one of ${STATUS_SOURCES.join(", ")}` };
    }
    if (typeof f.state !== "string" || !(FEED_STATES as readonly string[]).includes(f.state)) {
      return { ok: false, error: `${at}.state must be one of ${FEED_STATES.join(", ")}` };
    }
    const key = `${f.feed_id} ${f.symbol}`;
    if (seen.has(key)) return { ok: false, error: `${at}: (${f.feed_id}, ${f.symbol}) appears twice` };
    seen.add(key);
    const state = f.state as ReportedState;

    let lastTickAt: Date | null = null;
    if (f.last_tick_utc !== undefined && f.last_tick_utc !== null) {
      lastTickAt = isoZ(f.last_tick_utc);
      if (!lastTickAt) return { ok: false, error: `${at}.last_tick_utc must be an ISO timestamp ending in Z, or null` };
      if (lastTickAt.getTime() > now.getTime() + AHEAD_MS) return { ok: false, error: `${at}.last_tick_utc is more than 60 s in the future` };
    }
    const ticks = intOrNull(f.ticks_per_min, MAX_TICKS_PER_MIN);
    const p50 = intOrNull(f.gap_p50_ms, MAX_GAP_MS);
    const p99 = intOrNull(f.gap_p99_ms, MAX_GAP_MS);
    if (!ticks.ok) return { ok: false, error: `${at}.ticks_per_min must be an integer 0-${MAX_TICKS_PER_MIN}, or null` };
    if (!p50.ok || !p99.ok) return { ok: false, error: `${at}: gaps must be integer ms 0-${MAX_GAP_MS}, or null` };

    if (state === "up" && !lastTickAt) return { ok: false, error: `${at}: an 'up' feed needs last_tick_utc` };
    if (state === "not_measured" && (lastTickAt || ticks.n !== null || p50.n !== null || p99.n !== null)) {
      return { ok: false, error: `${at}: a 'not_measured' feed carries no last tick and no metrics` };
    }
    if (!measuring && state !== "not_measured") return { ok: false, error: `${at}: collector.measuring is false, so every feed must be not_measured` };
    feeds.push({ feedId: f.feed_id, symbol: f.symbol, source: f.source as StatusSource, state, lastTickAt, ticksPerMin: ticks.n, gapP50Ms: p50.n, gapP99Ms: p99.n });
  }
  return { ok: true, report: { box: b.box, sentAt, collector: { version: cc.version, measuring }, feeds } };
}

export interface IgnoredFeed {
  feed_id: string;
  symbol: string;
  reason: "unknown feed_id" | "not in this box's status set";
}

/** One transaction, one clock: the box row is locked first, so two reports queue instead of interleaving. A report
 * whose sent_at is not newer than the box's last accepted one changes NOTHING (rows, box stamp, ignored list) and
 * answers superseded:true: a retry isn't a client error (S2). Every row and the box stamp take the transaction's
 * now(), so "in the last report" is exact equality of received_at and status_reported_at (S3). */
export async function recordStatusReport(
  box: AuthedBox,
  report: StatusReport
): Promise<{ stored: number; ignored: IgnoredFeed[]; superseded: boolean }> {
  const client = await pool.connect();
  try {
    await client.query("begin");
    const cur = await client.query(`select status_sent_at from feed_boxes where id = $1 for update`, [box.id]);
    const prev = (cur.rows[0] as { status_sent_at: Date | null } | undefined)?.status_sent_at ?? null;

    const keys = [...new Set(report.feeds.map((f) => f.feedId))];
    const known = await client.query(
      `select ft.tier_key, ft.id, st.box_id is not null as in_set
         from feed_tiers ft
         left join feed_box_status_tiers st on st.feed_tier_id = ft.id and st.box_id = $1
        where ft.tier_key = any($2::text[])`,
      [box.id, keys]
    );
    const byKey = new Map((known.rows as { tier_key: string; id: string; in_set: boolean }[]).map((r) => [r.tier_key, r]));
    const ignored: IgnoredFeed[] = [];
    const accepted: (ReportedFeed & { tierId: string })[] = [];
    for (const f of report.feeds) {
      const t = byKey.get(f.feedId);
      if (!t) ignored.push({ feed_id: f.feedId, symbol: f.symbol, reason: "unknown feed_id" });
      else if (!t.in_set) ignored.push({ feed_id: f.feedId, symbol: f.symbol, reason: "not in this box's status set" });
      else accepted.push({ ...f, tierId: t.id });
    }

    if (prev && new Date(prev).getTime() >= report.sentAt.getTime()) {
      await client.query("commit");
      return { stored: 0, ignored, superseded: true };
    }

    let stored = 0;
    for (const f of accepted) {
      const r = await client.query(
        `insert into feed_status_latest
           (box_id, feed_tier_id, symbol, source, state, last_tick_at, ticks_per_min, gap_p50_ms, gap_p99_ms, box_sent_at, received_at)
         values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, now())
         on conflict (box_id, feed_tier_id, symbol) do update
            set source = excluded.source, state = excluded.state, last_tick_at = excluded.last_tick_at,
                ticks_per_min = excluded.ticks_per_min, gap_p50_ms = excluded.gap_p50_ms, gap_p99_ms = excluded.gap_p99_ms,
                box_sent_at = excluded.box_sent_at, received_at = excluded.received_at
          where feed_status_latest.box_sent_at < excluded.box_sent_at
         returning 1`,
        [box.id, f.tierId, f.symbol, f.source, f.state, f.lastTickAt, f.ticksPerMin, f.gapP50Ms, f.gapP99Ms, report.sentAt]
      );
      stored += r.rows.length;
    }
    await client.query(
      `update feed_boxes
          set status_reported_at = now(), status_sent_at = $2, status_measuring = $3, status_collector_version = $4,
              status_ignored = $5::jsonb
        where id = $1`,
      [box.id, report.sentAt, report.collector.measuring, report.collector.version, JSON.stringify(ignored)]
    );
    await client.query("commit");
    return { stored, ignored, superseded: false };
  } catch (err) {
    await client.query("rollback").catch(() => {});
    throw err;
  } finally {
    client.release();
  }
}

// ---------- what the admin sees ----------

export type EffectiveKind = ReportedState | "unknown" | "no_report" | "not_in_last_report" | "collector_stopped";
export interface EffectiveState {
  kind: EffectiveKind;
  label: string;
  detail: string;
}

const REPORTED_LABEL: Record<ReportedState, string> = {
  up: "Up",
  stale: "Stale",
  down: "Down",
  closed: "Closed (schedule)",
  not_measured: "Not measured",
};

/** One row's state as of `now`. The box's whole report is the clock (FOC13's thresholds), never the box's sent_at:
 * <= 2 min the row's reported state; then "Unknown"; after 10 min "No report" (red), never "Down" for silence (Q1).
 * While the box is fresh, a row its last report didn't carry is "Not in last report" (S3), except when the collector
 * said it is stopped: then every row is "not measured (collector stopped)" (Fable m64565 note 1). */
export function effectiveFeedState(
  row: { state: ReportedState; receivedAt: Date },
  box: { statusReportedAt: Date | null; measuring: boolean | null },
  now: Date = new Date()
): EffectiveState {
  const last = box.statusReportedAt;
  if (!last) return { kind: "no_report", label: "No report", detail: "the box has never reported" };
  const age = now.getTime() - last.getTime();
  if (age > STATUS_NO_REPORT_AFTER_MS) return { kind: "no_report", label: "No report", detail: `no report since ${formatAbsoluteUtc(last)}` };
  if (age > STATUS_UNKNOWN_AFTER_MS) return { kind: "unknown", label: "Unknown", detail: `no recent report, last ${formatAbsoluteUtc(last)}` };
  if (box.measuring === false) return { kind: "collector_stopped", label: "not measured (collector stopped)", detail: "FeedCompare not running" };
  if (row.receivedAt.getTime() < last.getTime()) {
    return { kind: "not_in_last_report", label: "Not in last report", detail: `last reported ${formatAbsoluteUtc(row.receivedAt)}` };
  }
  return { kind: row.state, label: REPORTED_LABEL[row.state], detail: "" };
}

/** The whole box on the same clock as effectiveFeedState: "fresh" only while its last status report is <= 2 min old.
 * Events never feed this (E5, plan m70008): a box that only sends events reads "No report". */
export function boxFreshness(statusReportedAt: Date | null, now: Date = new Date()): { kind: "fresh" | "unknown" | "no_report"; since: Date | null } {
  if (!statusReportedAt) return { kind: "no_report", since: null };
  const age = now.getTime() - statusReportedAt.getTime();
  if (age > STATUS_NO_REPORT_AFTER_MS) return { kind: "no_report", since: statusReportedAt };
  if (age > STATUS_UNKNOWN_AFTER_MS) return { kind: "unknown", since: statusReportedAt };
  return { kind: "fresh", since: statusReportedAt };
}

/** marcus m64552: down > stale > not_measured > up. The derived states sit in that order too: "No report" with down,
 * "Unknown" and "Not in last report" with stale, "collector stopped" with not_measured. */
const RANK: Record<Exclude<EffectiveKind, "closed">, number> = {
  no_report: 4,
  down: 4,
  unknown: 3,
  not_in_last_report: 3,
  stale: 3,
  collector_stopped: 2,
  not_measured: 2,
  up: 1,
};

/** The feed's badge = the worst of its symbol rows, each computed first by effectiveFeedState. "closed" only when
 * EVERY row is closed; otherwise the closed rows don't count. No rows at all = "no_rows" (Not measured yet). */
export function feedBadge(states: EffectiveState[]): EffectiveState | { kind: "no_rows"; label: string; detail: string } {
  if (states.length === 0) return { kind: "no_rows", label: "Not measured yet", detail: "" };
  const open = states.filter((s) => s.kind !== "closed");
  if (open.length === 0) return states[0];
  return open.reduce((w, s) => (RANK[s.kind as keyof typeof RANK] > RANK[w.kind as keyof typeof RANK] ? s : w));
}

export interface StatusRowView {
  symbol: string;
  source: StatusSource;
  reported: ReportedState;
  lastTickAt: Date | null;
  ticksPerMin: number | null;
  gapP50Ms: number | null;
  gapP99Ms: number | null;
  receivedAt: Date;
  effective: EffectiveState;
}
export interface StatusFeedView {
  tierKey: string;
  name: string;
  badge: ReturnType<typeof feedBadge>;
  rows: StatusRowView[];
}
export interface StatusBoxView {
  id: string;
  name: string;
  statusReportedAt: Date | null;
  measuring: boolean | null;
  collectorVersion: string | null;
  ignored: IgnoredFeed[];
  feeds: StatusFeedView[];
}

/** Every box with a status-tier set or an event in the last 30 d (0115, plan m70009 U1), each tier with its rows (or
 * none), effective states computed at `now`. */
export async function listFeedStatus(now: Date = new Date()): Promise<StatusBoxView[]> {
  const boxes = await pool.query(
    `select b.id, b.name, b.status_reported_at, b.status_measuring, b.status_collector_version, b.status_ignored
       from feed_boxes b
      where exists (select 1 from feed_box_status_tiers st where st.box_id = b.id)
         or exists (select 1 from feed_box_events e where e.box_id = b.id and e.ts >= $1::timestamptz - interval '30 days')
      order by b.name`,
    [now]
  );
  const tiers = await pool.query(
    `select st.box_id, ft.id, ft.tier_key, ft.name
       from feed_box_status_tiers st join feed_tiers ft on ft.id = st.feed_tier_id
      order by ft.tier_key`
  );
  const rows = await pool.query(
    `select box_id, feed_tier_id, symbol, source, state, last_tick_at, ticks_per_min, gap_p50_ms, gap_p99_ms, received_at
       from feed_status_latest
      order by symbol`
  );
  return (boxes.rows as Record<string, unknown>[]).map((b) => {
    const box = {
      statusReportedAt: (b.status_reported_at as Date | null) ? new Date(b.status_reported_at as Date) : null,
      measuring: (b.status_measuring as boolean | null) ?? null,
    };
    const ignoredRaw = typeof b.status_ignored === "string" ? JSON.parse(b.status_ignored) : b.status_ignored;
    const feeds = (tiers.rows as { box_id: string; id: string; tier_key: string; name: string }[])
      .filter((t) => t.box_id === b.id)
      .map((t) => {
        const mine = (rows.rows as Record<string, unknown>[])
          .filter((r) => r.box_id === b.id && r.feed_tier_id === t.id)
          .map((r) => {
            const receivedAt = new Date(r.received_at as Date);
            const reported = r.state as ReportedState;
            return {
              symbol: r.symbol as string,
              source: r.source as StatusSource,
              reported,
              lastTickAt: r.last_tick_at ? new Date(r.last_tick_at as Date) : null,
              ticksPerMin: (r.ticks_per_min as number | null) ?? null,
              gapP50Ms: (r.gap_p50_ms as number | null) ?? null,
              gapP99Ms: (r.gap_p99_ms as number | null) ?? null,
              receivedAt,
              effective: effectiveFeedState({ state: reported, receivedAt }, box, now),
            };
          });
        return { tierKey: t.tier_key, name: t.name, badge: feedBadge(mine.map((m) => m.effective)), rows: mine };
      });
    return {
      id: b.id as string,
      name: b.name as string,
      statusReportedAt: box.statusReportedAt,
      measuring: box.measuring,
      collectorVersion: (b.status_collector_version as string | null) ?? null,
      ignored: (ignoredRaw as IgnoredFeed[] | null) ?? [],
      feeds,
    };
  });
}

/** Boxes that apply client IPs: their allowlist poll proves the box is polling, NOT that ticks flow, so the admin
 * page shows it as "Box reporting · last poll X" and never as a feed state (FOC13 §4; plan §6). */
export async function listAllowlistBoxPolls(): Promise<{ name: string; lastSeenAt: Date | null }[]> {
  const r = await pool.query(
    `select b.name, b.last_seen_at from feed_boxes b
      where exists (select 1 from feed_box_tiers bt where bt.box_id = b.id)
      order by b.name`
  );
  return (r.rows as { name: string; last_seen_at: Date | null }[]).map((x) => ({ name: x.name, lastSeenAt: x.last_seen_at ? new Date(x.last_seen_at) : null }));
}
