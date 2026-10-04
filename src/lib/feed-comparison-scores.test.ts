/* Run: npx tsx --test src/lib/feed-comparison-scores.test.ts
 *
 * The London board's parts are FOC13's (feed-methodology-draft.md §2, marcus m59293): each row's
 * parts add up to its score at one decimal, and no part exceeds its maximum. */
import { test } from "node:test";
import assert from "node:assert/strict";
import { FEED_COMPARISON_SCORES } from "./feed-comparison-scores";

test("every row's parts add up to its score", () => {
  for (const f of FEED_COMPARISON_SCORES) {
    const tenths = Math.round(f.speed * 10) + Math.round(f.consistency * 10) + Math.round(f.streamQuality * 10);
    assert.equal(tenths, Math.round(f.score * 10), f.name);
  }
});

test("no part exceeds its maximum", () => {
  for (const f of FEED_COMPARISON_SCORES) {
    assert.ok(f.speed >= 0 && f.speed <= 45, `${f.name} speed`);
    assert.ok(f.consistency >= 0 && f.consistency <= 35, `${f.name} consistency`);
    assert.ok(f.streamQuality >= 0 && f.streamQuality <= 20, `${f.name} stream`);
  }
});

test("the parts match FOC13's table", () => {
  const parts = Object.fromEntries(
    FEED_COMPARISON_SCORES.map((f) => [f.name, [f.score, f.speed, f.consistency, f.streamQuality]]),
  );
  assert.deepEqual(parts, {
    Black: [94.8, 45, 35, 14.8],
    Alpha: [76.4, 35.7, 25.5, 15.2],
    Ultra: [73.2, 35.1, 24.9, 13.2],
    Beta: [42.4, 14.8, 14.4, 13.2],
    Gamma: [14.5, 0.9, 7.6, 6.0],
    Delta: [6.0, 0, 0, 6.0],
    Epsilon: [0, 0, 0, 0],
  });
});
