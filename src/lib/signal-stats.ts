/** The numbers on /admin/signals, from signal_calls rows (Axiom signals dashboard S3; plan
 * docs/specs/axiom-signals-dashboard-plan.md section 5 at 6f3af9d, :341-401). Pure: no database, no clock; the
 * page's one read query (src/lib/signal-calls.ts, S4) supplies the rows and the page supplies now.
 *
 * Only shared columns are read (C2 m67410), plus senderLabel = meta->>'source', which labels rows and keys no
 * number (fable N5 m67474, plan :350-353).
 *
 * Every row lands in exactly one of right / wrong / flat / neutral / pending / unscoredAfterClose / unpriced:
 * - neutral by direction first, so it is in none of the three after it (fable m67483 carve-out);
 * - an up/down row with an outcome is that outcome;
 * - an up/down row with no outcome is the A2 partition (my A2, ACCEPTED fable m67483; plan :358-363):
 *   exitTs + grace >= now -> pending; else P3 (receivedAt < exitTs) -> unscoredAfterClose; else -> unpriced.
 * P3, the live / backfilled split and the "after close" lead-time bucket all key on the SAME comparison,
 * receivedAt vs exitTs (m67446 call 5, kept m67483; plan :364-366). */

/** fable G5 m67417, value marcus m67424 (plan :386-391). */
export const UNSCORED_AFTER_CLOSE_GRACE_MS = 2 * 60 * 60 * 1000;
/** fable G5 m67417, value marcus m67424 (plan :392-396). */
export const LEAD_WITHIN_WINDOW_MS = 15 * 60 * 1000;
/** Under this many scored calls a pair row is tagged n<10 and its percentages muted (plan :374). */
export const SMALL_SAMPLE_SCORED = 10;

/** The four lead-time rows, in page order (fable P4 m67410; half-open edges my call 5, CONFIRMED m67474). */
export const LEAD_BUCKETS = ["beforeOpen", "within15Min", "laterInWindow", "afterClose"] as const;
export type LeadBucket = (typeof LEAD_BUCKETS)[number];

export interface SignalStatsRow {
  symbol: string;
  /** YYYY-MM-DD. */
  sessionDate: string;
  direction: "up" | "down" | "neutral";
  entryTs: Date;
  exitTs: Date;
  receivedAt: Date;
  entryPxAt: Date | null;
  outcome: "right" | "wrong" | "flat" | null;
  /** signal_calls.move as Postgres prints a numeric: "-8.00", "15.000000". null until scored. */
  move: string | null;
  /** meta->>'source': the ingest only lets "card" or "backfill" in (plan :238-242). */
  senderLabel: "card" | "backfill" | null;
}

export interface SignalTally {
  calls: number;
  right: number;
  wrong: number;
  flat: number;
  neutral: number;
  pending: number;
  unscoredAfterClose: number;
  unpriced: number;
  /** right * 100 / (right + wrong); flats, neutrals and every unscored row are outside it (plan :379). */
  hitPct: number | null;
  /** Live rows (receivedAt < exitTs) with entryPxAt >= exitTs, scored or not; orthogonal to the partition
   * (fable D1 m67474, plan :367-368). */
  entryPricedAfterClose: number;
  labels: { card: number; backfill: number; none: number };
}

export interface SignalDirectionSplit {
  right: number;
  wrong: number;
  flat: number;
  hitPct: number | null;
}

export interface SignalPairStats extends SignalTally {
  symbol: string;
  /** right + wrong + flat. */
  scored: number;
  /** scored < SMALL_SAMPLE_SCORED. */
  small: boolean;
  /** Sum of move over the scored rows, in the pair's unit: the net if every call was followed. */
  netMove: number;
  avgRight: number | null;
  avgWrong: number | null;
  up: SignalDirectionSplit;
  down: SignalDirectionSplit;
  /** One point per sessionDate with a scored row of this pair, in date order. Per pair, never summed across
   * pairs: the units differ (plan :375-377). */
  cumulativeNet: { date: string; net: number }[];
}

export interface SignalStats {
  headline: SignalTally & { firstDate: string | null; lastDate: string | null };
  leadTime: Record<LeadBucket, SignalTally>;
  /** Lead-time rows 1-3: receivedAt < exitTs. */
  live: SignalTally;
  /** Lead-time row 4: receivedAt >= exitTs. */
  backfilled: SignalTally;
  /** By symbol, A to Z. */
  pairs: SignalPairStats[];
  /** One point per sessionDate with a scored row, all pairs, in date order. */
  cumulativeHit: { date: string; right: number; wrong: number; hitPct: number | null }[];
}

type Slot = "right" | "wrong" | "flat" | "neutral" | "pending" | "unscoredAfterClose" | "unpriced";

const isLive = (r: SignalStatsRow) => r.receivedAt.getTime() < r.exitTs.getTime();

function slot(r: SignalStatsRow, now: Date): Slot {
  if (r.direction === "neutral") return "neutral";
  if (r.outcome !== null) return r.outcome;
  if (r.exitTs.getTime() + UNSCORED_AFTER_CLOSE_GRACE_MS >= now.getTime()) return "pending";
  return isLive(r) ? "unscoredAfterClose" : "unpriced";
}

export function leadBucket(r: Pick<SignalStatsRow, "entryTs" | "exitTs" | "receivedAt">): LeadBucket {
  const t = r.receivedAt.getTime();
  if (t < r.entryTs.getTime()) return "beforeOpen";
  if (t < r.entryTs.getTime() + LEAD_WITHIN_WINDOW_MS) return "within15Min";
  if (t < r.exitTs.getTime()) return "laterInWindow";
  return "afterClose";
}

const hitPct = (right: number, wrong: number) => (right + wrong ? (right * 100) / (right + wrong) : null);

/** A numeric's text as an integer count of millionths, exactly ("-8.00" -> -8000000), so sums never carry a
 * float error. move has at most 6 dp (unit * 1e6 is a power of ten, signal-ingest scoreMove). */
export function moveMicros(s: string): number {
  const m = /^(-?)(\d+)(?:\.(\d{1,6}))?$/.exec(s);
  if (!m) throw new Error(`move is not a decimal with at most 6 dp: ${s}`);
  const n = Number(m[2]) * 1_000_000 + Number((m[3] ?? "").padEnd(6, "0"));
  return m[1] ? -n : n;
}

export function tally(rows: readonly SignalStatsRow[], now: Date): SignalTally {
  const t: SignalTally = {
    calls: rows.length,
    right: 0,
    wrong: 0,
    flat: 0,
    neutral: 0,
    pending: 0,
    unscoredAfterClose: 0,
    unpriced: 0,
    hitPct: null,
    entryPricedAfterClose: 0,
    labels: { card: 0, backfill: 0, none: 0 },
  };
  for (const r of rows) {
    t[slot(r, now)]++;
    if (isLive(r) && r.entryPxAt && r.entryPxAt.getTime() >= r.exitTs.getTime()) t.entryPricedAfterClose++;
    t.labels[r.senderLabel ?? "none"]++;
  }
  t.hitPct = hitPct(t.right, t.wrong);
  return t;
}

function split(rows: readonly SignalStatsRow[]): SignalDirectionSplit {
  const s = { right: 0, wrong: 0, flat: 0 };
  for (const r of rows) if (r.outcome) s[r.outcome]++;
  return { ...s, hitPct: hitPct(s.right, s.wrong) };
}

/** micros summed, then one division, so 2 x 16.4 averages to the double nearest 16.4. */
const avg = (micros: number[]) => (micros.length ? micros.reduce((a, b) => a + b, 0) / (micros.length * 1_000_000) : null);

const byDate = (a: SignalStatsRow, b: SignalStatsRow) => (a.sessionDate < b.sessionDate ? -1 : a.sessionDate > b.sessionDate ? 1 : 0);

function pairStats(symbol: string, rows: readonly SignalStatsRow[], now: Date): SignalPairStats {
  const t = tally(rows, now);
  const scoredRows = rows.filter((r) => r.outcome !== null).sort(byDate);
  const micros = (o: string) => scoredRows.filter((r) => r.outcome === o).map((r) => moveMicros(r.move!));
  const cumulativeNet: { date: string; net: number }[] = [];
  let net = 0;
  for (const r of scoredRows) {
    net += moveMicros(r.move!);
    const point = { date: r.sessionDate, net: net / 1_000_000 };
    if (cumulativeNet.at(-1)?.date === r.sessionDate) cumulativeNet[cumulativeNet.length - 1] = point;
    else cumulativeNet.push(point);
  }
  const scored = t.right + t.wrong + t.flat;
  return {
    ...t,
    symbol,
    scored,
    small: scored < SMALL_SAMPLE_SCORED,
    netMove: net / 1_000_000,
    avgRight: avg(micros("right")),
    avgWrong: avg(micros("wrong")),
    up: split(rows.filter((r) => r.direction === "up")),
    down: split(rows.filter((r) => r.direction === "down")),
    cumulativeNet,
  };
}

export function signalStats(rows: readonly SignalStatsRow[], now: Date): SignalStats {
  const dates = rows.map((r) => r.sessionDate).sort();
  const inBucket = (b: LeadBucket) => rows.filter((r) => leadBucket(r) === b);
  const symbols = [...new Set(rows.map((r) => r.symbol))].sort();

  const cumulativeHit: SignalStats["cumulativeHit"] = [];
  let right = 0;
  let wrong = 0;
  for (const r of rows.filter((x) => x.outcome !== null).sort(byDate)) {
    if (r.outcome === "right") right++;
    if (r.outcome === "wrong") wrong++;
    const point = { date: r.sessionDate, right, wrong, hitPct: hitPct(right, wrong) };
    if (cumulativeHit.at(-1)?.date === r.sessionDate) cumulativeHit[cumulativeHit.length - 1] = point;
    else cumulativeHit.push(point);
  }

  return {
    headline: { ...tally(rows, now), firstDate: dates[0] ?? null, lastDate: dates.at(-1) ?? null },
    leadTime: Object.fromEntries(LEAD_BUCKETS.map((b) => [b, tally(inBucket(b), now)])) as Record<LeadBucket, SignalTally>,
    live: tally(rows.filter(isLive), now),
    backfilled: tally(rows.filter((r) => !isLive(r)), now),
    pairs: symbols.map((s) => pairStats(s, rows.filter((r) => r.symbol === s), now)),
    cumulativeHit,
  };
}
