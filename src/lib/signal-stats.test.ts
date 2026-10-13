/* Run: npx tsx --test src/lib/signal-stats.test.ts
 *
 * Axiom signals dashboard S3: src/lib/signal-stats.ts (marcus named GO m67588; plan
 * docs/specs/axiom-signals-dashboard-plan.md section 7's S3 list at 6f3af9d, :465-475, is the test contract).
 * Pure: no database, now is passed in. Pinned here:
 *  - a hand-built fixture of 14 calls over 3 pairs, every expected number written out below it: the headline, the
 *    four lead-time rows with card / backfill / none beside each, the live (rows 1-3) / backfilled (row 4)
 *    subtotals, per pair (up/down split, avg right/wrong, net move), the cumulative series in date order, flats
 *    and neutrals outside the hit % denominator, pending outside everything, a "card" row received after close
 *    shown in the after-close row;
 *  - the A2 partition at its edges: unscored after close at exit_ts + 2 h exactly and 1 ms either side; a
 *    backfilled up/down row past the grace is unpriced, inside it pending; a neutral row is only ever neutral;
 *    received_at = exit_ts - 1 ms is P3-eligible and live, received_at = exit_ts is neither;
 *  - entry priced after close at entry_px_at = exit_ts and 1 ms before;
 *  - each lead-time bucket at both of its edges;
 *  - the n<10 flag at 9 and 10 scored calls. */
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  LEAD_WITHIN_WINDOW_MS,
  SMALL_SAMPLE_SCORED,
  UNSCORED_AFTER_CLOSE_GRACE_MS,
  leadBucket,
  moveMicros,
  signalStats,
  tally,
  type SignalStatsRow,
  type SignalTally,
} from "./signal-stats";

const NOW = new Date("2026-10-13T12:00:00Z");
const HOUR = 60 * 60 * 1000;
const plus = (d: Date, ms: number) => new Date(d.getTime() + ms);

/** A row on Axiom's window, sessionDate 06:00Z -> 21:00Z. recv / entryAt are "HH:MM" on sessionDate or a full
 * ISO instant. entryPxAt defaults to receivedAt for a scored row (entry sent with the post) and null otherwise. */
function row(
  symbol: string,
  sessionDate: string,
  direction: SignalStatsRow["direction"],
  o: { recv: string; outcome?: SignalStatsRow["outcome"]; move?: string; label?: "card" | "backfill"; entryAt?: string | null }
): SignalStatsRow {
  const when = (s: string) => new Date(s.includes("T") ? s : `${sessionDate}T${s}:00Z`);
  const receivedAt = when(o.recv);
  return {
    symbol,
    sessionDate,
    direction,
    entryTs: new Date(`${sessionDate}T06:00:00Z`),
    exitTs: new Date(`${sessionDate}T21:00:00Z`),
    receivedAt,
    entryPxAt: o.entryAt === undefined ? (o.outcome ? receivedAt : null) : o.entryAt === null ? null : when(o.entryAt),
    outcome: o.outcome ?? null,
    move: o.move ?? null,
    senderLabel: o.label ?? null,
  };
}

const SLOTS = ["right", "wrong", "flat", "neutral", "pending", "unscoredAfterClose", "unpriced"] as const;
/** The slots a single row lands in: always exactly one. */
const slotsOf = (r: SignalStatsRow, now: Date) => {
  const t = tally([r], now);
  return SLOTS.filter((k) => t[k] === 1);
};

// NOW is 2026-10-13 12:00Z: the 10-13 session has not closed, every earlier one closed more than 2 h ago.
const FIXTURE: SignalStatsRow[] = [
  /* E1 */ row("EURUSD", "2026-10-05", "up", { recv: "05:50", outcome: "right", move: "12.50", label: "card" }),
  /* E2 */ row("EURUSD", "2026-10-06", "down", { recv: "06:10", outcome: "wrong", move: "-8.00", label: "card" }),
  /* E3 */ row("EURUSD", "2026-10-07", "up", { recv: "06:10", outcome: "flat", move: "3.20", label: "card" }),
  /* E4 */ row("EURUSD", "2026-10-08", "neutral", { recv: "06:10", label: "card" }),
  /* E5 */ row("EURUSD", "2026-10-09", "up", { recv: "2026-10-10T09:00:00Z", outcome: "right", move: "20.30", label: "backfill" }),
  /* E6 */ row("EURUSD", "2026-10-13", "up", { recv: "06:10", label: "card" }), // pending: session still open
  /* X1 */ row("XAUUSD", "2026-10-05", "down", { recv: "06:10", outcome: "right", move: "15.000000", label: "card" }),
  /* X2 */ row("XAUUSD", "2026-10-06", "up", { recv: "07:00", outcome: "wrong", move: "-6.500000" }),
  /* X3 */ row("XAUUSD", "2026-10-07", "up", { recv: "06:10", label: "card" }), // live, never scored: unscored after close
  /* X4 */ row("XAUUSD", "2026-10-08", "down", { recv: "2026-10-11T10:00:00Z", label: "backfill" }), // backfilled, no prices: unpriced
  /* X5 */ row("XAUUSD", "2026-10-12", "up", { recv: "06:05", outcome: "right", move: "4.000000", label: "card", entryAt: "21:30" }),
  /* U1 */ row("US30", "2026-10-05", "up", { recv: "2026-10-06T08:00:00Z", outcome: "wrong", move: "-40.000000", label: "card" }),
  /* U2 */ row("US30", "2026-10-06", "up", { recv: "05:30", outcome: "right", move: "55.000000" }),
  /* U3 */ row("US30", "2026-10-07", "neutral", { recv: "2026-10-09T08:00:00Z", label: "backfill" }),
];

test("fixture: every number written out by hand", () => {
  const s = signalStats(FIXTURE, NOW);

  // right E1 E5 X1 X5 U2; wrong E2 X2 U1; flat E3; neutral E4 U3; pending E6; unscored after close X3; unpriced X4.
  // hit % = 5 / (5 + 3): the flat, the neutrals and the three unscored rows are outside it.
  // entry priced after close: X5 only (live, entry_px_at 21:30Z). E5 and U1 have entry_px_at after close too,
  // but are not live. card E1-E4 E6 X1 X3 X5 U1; backfill E5 X4 U3; none X2 U2.
  assert.deepEqual(s.headline, {
    calls: 14, right: 5, wrong: 3, flat: 1, neutral: 2, pending: 1, unscoredAfterClose: 1, unpriced: 1, hitPct: 62.5,
    entryPricedAfterClose: 1, labels: { card: 9, backfill: 3, none: 2 }, firstDate: "2026-10-05", lastDate: "2026-10-13",
  });

  // before open: E1 (05:50), U2 (05:30).
  assert.deepEqual(s.leadTime.beforeOpen, {
    calls: 2, right: 2, wrong: 0, flat: 0, neutral: 0, pending: 0, unscoredAfterClose: 0, unpriced: 0, hitPct: 100,
    entryPricedAfterClose: 0, labels: { card: 1, backfill: 0, none: 1 },
  });
  // within 15 min: E2 E3 E4 E6 X1 X3 (06:10), X5 (06:05).
  assert.deepEqual(s.leadTime.within15Min, {
    calls: 7, right: 2, wrong: 1, flat: 1, neutral: 1, pending: 1, unscoredAfterClose: 1, unpriced: 0, hitPct: 200 / 3,
    entryPricedAfterClose: 1, labels: { card: 7, backfill: 0, none: 0 },
  });
  // later in window: X2 (07:00).
  assert.deepEqual(s.leadTime.laterInWindow, {
    calls: 1, right: 0, wrong: 1, flat: 0, neutral: 0, pending: 0, unscoredAfterClose: 0, unpriced: 0, hitPct: 0,
    entryPricedAfterClose: 0, labels: { card: 0, backfill: 0, none: 1 },
  });
  // after close: E5 X4 U1 U3. U1 is labelled "card" and still shows here, with its label (plan :353-354).
  const afterClose: SignalTally = {
    calls: 4, right: 1, wrong: 1, flat: 0, neutral: 1, pending: 0, unscoredAfterClose: 0, unpriced: 1, hitPct: 50,
    entryPricedAfterClose: 0, labels: { card: 1, backfill: 3, none: 0 },
  };
  assert.deepEqual(s.leadTime.afterClose, afterClose);
  assert.deepEqual(Object.keys(s.leadTime), ["beforeOpen", "within15Min", "laterInWindow", "afterClose"]);

  // live = rows 1-3 (10 calls); backfilled = row 4.
  assert.deepEqual(s.live, {
    calls: 10, right: 4, wrong: 2, flat: 1, neutral: 1, pending: 1, unscoredAfterClose: 1, unpriced: 0, hitPct: 200 / 3,
    entryPricedAfterClose: 1, labels: { card: 8, backfill: 0, none: 2 },
  });
  assert.deepEqual(s.backfilled, afterClose);

  // Per pair, A to Z. Moves: EURUSD 12.50 -8.00 3.20 20.30 pips; US30 -40 55 points; XAUUSD 15 -6.5 4 dollars.
  assert.deepEqual(s.pairs, [
    {
      calls: 6, right: 2, wrong: 1, flat: 1, neutral: 1, pending: 1, unscoredAfterClose: 0, unpriced: 0, hitPct: 200 / 3,
      entryPricedAfterClose: 0, labels: { card: 5, backfill: 1, none: 0 },
      symbol: "EURUSD", scored: 4, small: true,
      netMove: 28, // 12.50 - 8.00 + 3.20 + 20.30, the flat included
      avgRight: 16.4, // (12.50 + 20.30) / 2
      avgWrong: -8,
      up: { right: 2, wrong: 0, flat: 1, hitPct: 100 },
      down: { right: 0, wrong: 1, flat: 0, hitPct: 0 },
      cumulativeNet: [
        { date: "2026-10-05", net: 12.5 },
        { date: "2026-10-06", net: 4.5 },
        { date: "2026-10-07", net: 7.7 },
        { date: "2026-10-09", net: 28 },
      ],
    },
    {
      calls: 3, right: 1, wrong: 1, flat: 0, neutral: 1, pending: 0, unscoredAfterClose: 0, unpriced: 0, hitPct: 50,
      entryPricedAfterClose: 0, labels: { card: 1, backfill: 1, none: 1 },
      symbol: "US30", scored: 2, small: true,
      netMove: 15,
      avgRight: 55,
      avgWrong: -40,
      up: { right: 1, wrong: 1, flat: 0, hitPct: 50 },
      down: { right: 0, wrong: 0, flat: 0, hitPct: null },
      cumulativeNet: [
        { date: "2026-10-05", net: -40 },
        { date: "2026-10-06", net: 15 },
      ],
    },
    {
      calls: 5, right: 2, wrong: 1, flat: 0, neutral: 0, pending: 0, unscoredAfterClose: 1, unpriced: 1, hitPct: 200 / 3,
      entryPricedAfterClose: 1, labels: { card: 3, backfill: 1, none: 1 },
      symbol: "XAUUSD", scored: 3, small: true,
      netMove: 12.5,
      avgRight: 9.5, // (15 + 4) / 2
      avgWrong: -6.5,
      up: { right: 1, wrong: 1, flat: 0, hitPct: 50 },
      down: { right: 1, wrong: 0, flat: 0, hitPct: 100 },
      cumulativeNet: [
        { date: "2026-10-05", net: 15 },
        { date: "2026-10-06", net: 8.5 },
        { date: "2026-10-12", net: 12.5 },
      ],
    },
  ]);

  // One point per date with a scored row: 10-08 has only a neutral and an unpriced row, 10-13 only a pending
  // one, so neither is a point; 10-07 has only a flat, so it is a point with the rate unchanged.
  assert.deepEqual(s.cumulativeHit, [
    { date: "2026-10-05", right: 2, wrong: 1, hitPct: 200 / 3 },
    { date: "2026-10-06", right: 3, wrong: 3, hitPct: 50 },
    { date: "2026-10-07", right: 3, wrong: 3, hitPct: 50 },
    { date: "2026-10-09", right: 4, wrong: 3, hitPct: 400 / 7 },
    { date: "2026-10-12", right: 5, wrong: 3, hitPct: 62.5 },
  ]);

  // Every tally partitions its calls; input order does not matter.
  for (const t of [s.headline, ...Object.values(s.leadTime), s.live, s.backfilled, ...s.pairs]) {
    assert.equal(SLOTS.reduce((n, k) => n + t[k], 0), t.calls);
    assert.equal(t.labels.card + t.labels.backfill + t.labels.none, t.calls);
  }
  assert.deepEqual(signalStats([...FIXTURE].reverse(), NOW), s);
});

test("the A2 partition at the grace edge: exit_ts + 2 h exactly and 1 ms either side", () => {
  assert.equal(UNSCORED_AFTER_CLOSE_GRACE_MS, 2 * HOUR);
  const r = row("EURUSD", "2026-10-01", "up", { recv: "06:10" });
  const edge = plus(r.exitTs, UNSCORED_AFTER_CLOSE_GRACE_MS);
  assert.deepEqual(slotsOf(r, plus(edge, -1)), ["pending"]);
  assert.deepEqual(slotsOf(r, edge), ["pending"]);
  assert.deepEqual(slotsOf(r, plus(edge, 1)), ["unscoredAfterClose"]);
});

test("backfilled up/down rows: unpriced past the grace, pending inside it; a neutral row is only ever neutral", () => {
  for (const direction of ["up", "down"] as const) {
    const past = row("EURUSD", "2026-10-01", direction, { recv: "2026-10-02T09:00:00Z", label: "backfill" });
    assert.deepEqual(slotsOf(past, NOW), ["unpriced"], `${direction} past the grace`);
    const inside = row("EURUSD", "2026-10-01", direction, { recv: "21:30" });
    assert.deepEqual(slotsOf(inside, plus(inside.exitTs, HOUR)), ["pending"], `${direction} inside the grace`);
  }
  for (const recv of ["06:10", "2026-10-02T09:00:00Z"]) {
    const n = row("EURUSD", "2026-10-01", "neutral", { recv });
    assert.deepEqual(slotsOf(n, NOW), ["neutral"], `neutral received ${recv}, past the grace`);
    assert.deepEqual(slotsOf(n, plus(n.exitTs, HOUR)), ["neutral"], `neutral received ${recv}, inside the grace`);
  }
});

test("the shared comparison: received_at = exit_ts - 1 ms is P3-eligible and live, received_at = exit_ts is neither", () => {
  const live = row("EURUSD", "2026-10-01", "up", { recv: "2026-10-01T20:59:59.999Z" });
  assert.deepEqual(slotsOf(live, NOW), ["unscoredAfterClose"]);
  assert.equal(leadBucket(live), "laterInWindow");
  const atClose = row("EURUSD", "2026-10-01", "up", { recv: "2026-10-01T21:00:00.000Z" });
  assert.deepEqual(slotsOf(atClose, NOW), ["unpriced"]);
  assert.equal(leadBucket(atClose), "afterClose");

  const s = signalStats([live, atClose], NOW);
  assert.deepEqual([s.live.calls, s.live.unscoredAfterClose, s.live.unpriced], [1, 1, 0]);
  assert.deepEqual([s.backfilled.calls, s.backfilled.unscoredAfterClose, s.backfilled.unpriced], [1, 0, 1]);
});

test("entry priced after close: entry_px_at = exit_ts counts, 1 ms before does not, a backfilled row never", () => {
  const scored = { outcome: "right" as const, move: "6.00" };
  const atExit = row("EURUSD", "2026-10-01", "up", { recv: "06:10", ...scored, entryAt: "2026-10-01T21:00:00.000Z" });
  const before = row("EURUSD", "2026-10-02", "up", { recv: "06:10", ...scored, entryAt: "2026-10-02T20:59:59.999Z" });
  const unscored = row("EURUSD", "2026-10-03", "up", { recv: "06:10", entryAt: "2026-10-03T22:00:00Z" });
  const backfilled = row("EURUSD", "2026-10-04", "up", { recv: "2026-10-05T09:00:00Z", ...scored });
  assert.equal(tally([atExit], NOW).entryPricedAfterClose, 1);
  assert.equal(tally([before], NOW).entryPricedAfterClose, 0);
  assert.equal(tally([unscored], NOW).entryPricedAfterClose, 1, "scored or not");
  assert.equal(backfilled.entryPxAt!.getTime() >= backfilled.exitTs.getTime(), true);
  assert.equal(tally([backfilled], NOW).entryPricedAfterClose, 0, "live rows only");
});

test("each lead-time bucket at both of its edges", () => {
  assert.equal(LEAD_WITHIN_WINDOW_MS, 15 * 60 * 1000);
  const d = "2026-10-01";
  const cases: [string, string][] = [
    ["2026-10-01T05:59:59.999Z", "beforeOpen"],
    ["2026-10-01T06:00:00.000Z", "within15Min"],
    ["2026-10-01T06:14:59.999Z", "within15Min"],
    ["2026-10-01T06:15:00.000Z", "laterInWindow"],
    ["2026-10-01T20:59:59.999Z", "laterInWindow"],
    ["2026-10-01T21:00:00.000Z", "afterClose"],
  ];
  const rows = cases.map(([recv]) => row("EURUSD", d, "up", { recv }));
  rows.forEach((r, i) => assert.equal(leadBucket(r), cases[i][1], cases[i][0]));
  const s = signalStats(rows, NOW);
  assert.deepEqual(
    Object.fromEntries(Object.entries(s.leadTime).map(([b, t]) => [b, t.calls])),
    { beforeOpen: 1, within15Min: 2, laterInWindow: 2, afterClose: 1 }
  );
  assert.deepEqual([s.live.calls, s.backfilled.calls], [5, 1]);
});

test("the n<10 flag: 9 scored calls are small, 10 are not; a pending call is not a scored one", () => {
  assert.equal(SMALL_SAMPLE_SCORED, 10);
  const day = (i: number) => `2026-09-${String(i + 1).padStart(2, "0")}`;
  const nine = Array.from({ length: 9 }, (_, i) => row("EURUSD", day(i), "up", { recv: "06:10", outcome: "right", move: "6.00" }));
  const pending = row("EURUSD", "2026-10-13", "up", { recv: "06:10" });
  const ten = Array.from({ length: 10 }, (_, i) => row("GBPUSD", day(i), "up", { recv: "06:10", outcome: "wrong", move: "-6.00" }));
  const [eur, gbp] = signalStats([...nine, pending, ...ten], NOW).pairs;
  assert.deepEqual([eur.symbol, eur.calls, eur.pending, eur.scored, eur.small], ["EURUSD", 10, 1, 9, true]);
  assert.deepEqual([gbp.symbol, gbp.calls, gbp.scored, gbp.small], ["GBPUSD", 10, 10, false]);
});

test("moveMicros: exact millionths from the numeric's text; anything else throws", () => {
  assert.equal(moveMicros("-8.00"), -8_000_000);
  assert.equal(moveMicros("15.000000"), 15_000_000);
  assert.equal(moveMicros("4.96"), 4_960_000);
  assert.equal(moveMicros("-0.50"), -500_000);
  assert.equal(moveMicros("5"), 5_000_000);
  for (const bad of ["", "1e3", "1.1234567", "+5", " 5", "5."]) assert.throws(() => moveMicros(bad), /at most 6 dp/, JSON.stringify(bad));
});

test("no rows: zeros, null rates and dates, no pairs, no points", () => {
  const s = signalStats([], NOW);
  assert.deepEqual(s.headline, {
    calls: 0, right: 0, wrong: 0, flat: 0, neutral: 0, pending: 0, unscoredAfterClose: 0, unpriced: 0, hitPct: null,
    entryPricedAfterClose: 0, labels: { card: 0, backfill: 0, none: 0 }, firstDate: null, lastDate: null,
  });
  assert.deepEqual([s.pairs, s.cumulativeHit], [[], []]);
});
