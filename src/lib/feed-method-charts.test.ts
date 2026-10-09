/* Run: npx tsx --test src/lib/feed-method-charts.test.ts
 *
 * The "How we measure" charts on feed.horizonhft.com (marcus m62845): every plotted number must trace to
 * FOC13's README (m62846/m62847). A few cells are written out here as the README prints them, and the
 * tables are checked against each other the way FOC13's trace check did, so a mistyped cell fails. */
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  FEEDS,
  GAP_HISTOGRAM,
  GAP_SUMMARY,
  HEAD_TO_HEAD,
  SPREAD,
  UPDATES_PER_HOUR,
  fmtMs,
  fmtPct1,
} from "./feed-method-charts";

test("README cells, as printed", () => {
  const hour = (h: string) => UPDATES_PER_HOUR.find((r) => r.hour === h)!.counts;
  assert.deepEqual(hour("13:00"), [98234, 103944, 89890, 58156, 27248, 27252]);
  assert.equal(hour("20:00")[5], 7508);
  const gap = (f: string) => GAP_SUMMARY.find((r) => r.feed === f)!;
  assert.equal(gap("London Alpha").p99Ms, 695.323);
  assert.equal(gap("LD Gamma 19").stallPct, 9.91258);
  assert.equal(gap("Black").p50Ms, 12.9648);
  assert.deepEqual(SPREAD.find((r) => r.feed === "London Alpha"), { feed: "London Alpha", p50: 0.149902, p95: 0.160156, p99: 0.199707 });
  assert.deepEqual(GAP_HISTOGRAM[18], [1.79128, 2.10274, 4.11089, 1.43055, 10.5326, 0.117106, 0.0517991, 0.0505505]);
});

test("each feed's hourly updates are one more than its gaps counted", () => {
  FEEDS.forEach((feed, i) => {
    const updates = UPDATES_PER_HOUR.reduce((sum, row) => sum + row.counts[i], 0);
    assert.equal(updates, GAP_SUMMARY[i].gapsCounted + 1, feed);
  });
});

test("the histogram: 79 bins on numpy.logspace(-1, 4.5, 80), each feed's column sums to 100%", () => {
  assert.equal(GAP_HISTOGRAM.length, 79);
  GAP_HISTOGRAM.forEach(([left, right], i) => {
    const edge = (k: number) => Math.pow(10, -1 + (5.5 * k) / 79);
    assert.ok(Math.abs(left - edge(i)) / edge(i) < 1e-5, `left edge ${i}`);
    assert.ok(Math.abs(right - edge(i + 1)) / edge(i + 1) < 1e-5, `right edge ${i}`);
  });
  FEEDS.forEach((feed, i) => {
    const total = GAP_HISTOGRAM.reduce((sum, row) => sum + row[2 + i], 0);
    assert.ok(Math.abs(total - 100) < 0.001, `${feed}: ${total}`);
  });
});

test("the figures the copy quotes come out of the same data", () => {
  const gap = (f: string) => GAP_SUMMARY.find((r) => r.feed === f)!;
  assert.equal(fmtMs(gap("London Alpha").p99Ms), "695 ms");
  assert.equal(fmtPct1(gap("London Alpha").stallPct), "2.0%");
  assert.equal(fmtMs(gap("LD Gamma 19").p99Ms), "1,484 ms");
  assert.equal(fmtMs(gap("LD Delta 18").p99Ms), "1,484 ms");
  assert.equal(fmtPct1(gap("LD Gamma 19").stallPct), "9.9%");
  assert.equal(fmtPct1(gap("LD Delta 18").stallPct), "9.9%");
});

test("head to head is the published percentages, public feed names only", () => {
  assert.deepEqual(
    HEAD_TO_HEAD.map((h) => [h.first, h.other, h.firstPct, h.otherPct]),
    [
      ["Black", "London Alpha", 89, undefined],
      ["Black", "London Ultra", 91, undefined],
      ["Black", "LD Beta 56", 98, undefined],
      ["Black", "LD Gamma 19", 98, undefined],
      ["Black", "LD Delta 18", 98, undefined],
      ["London Alpha", "London Ultra", 54, 46],
    ],
  );
  for (const h of HEAD_TO_HEAD) {
    assert.ok(FEEDS.includes(h.first) && FEEDS.includes(h.other));
  }
});
