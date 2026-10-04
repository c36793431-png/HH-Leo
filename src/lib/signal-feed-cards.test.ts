/* Run: npx tsx --test src/lib/signal-feed-cards.test.ts
 *
 * The client status vocabulary (coxwell 14:05Z via marcus m59956): AVAILABLE / ACTIVATED, the
 * held-tier count on a multi-tier feed, never LOCKED. Pure functions, no database. */
import { test } from "node:test";
import assert from "node:assert/strict";
import { activatedLabel, countActivatedTiersByRegion, computeSignalFeedCards } from "./signal-feed-cards";

test("countActivatedTiersByRegion: distinct tiers per region, a tier on two licences counts once", () => {
  assert.deepEqual(
    countActivatedTiersByRegion([
      { tierKey: "ld-beta-56", regionKey: "london" },
      { tierKey: "ld-gamma-19", regionKey: "london" },
      { tierKey: "ld-beta-56", regionKey: "london" },
      { tierKey: "ny-base", regionKey: "ny" },
    ]),
    { london: 2, ny: 1 }
  );
  assert.deepEqual(countActivatedTiersByRegion([]), {});
});

test("activatedLabel: count only when there is one", () => {
  assert.equal(activatedLabel(0), "ACTIVATED");
  assert.equal(activatedLabel(2), "2 ACTIVATED");
});

test("computeSignalFeedCards: AVAILABLE (teal) when not held, ACTIVATED / N ACTIVATED when held; no LOCKED, no Upgrade", () => {
  const base = { activeLicenses: [{ tier: "pro" }], isAdmin: false, feedBestLatency: {} };
  const tierCounts = { london: 5, ny: 2 } as Parameters<typeof computeSignalFeedCards>[0]["feedTierCounts"];

  const none = computeSignalFeedCards({ ...base, activeFeeds: [], feedTierCounts: tierCounts });
  assert.ok(none.every((c) => c.pill.label === "AVAILABLE" && c.pill.color === "teal"));
  const ld = none.find((c) => c.feedType === "london")!;
  assert.equal(ld.tierBadge, "5 TIERS", "the tier pill stays beside AVAILABLE");
  assert.equal(ld.action.label, "See tiers →");

  const held = computeSignalFeedCards({
    ...base,
    activeFeeds: ["london", "ny"],
    feedTierCounts: tierCounts,
    activatedTierCounts: { london: 2 },
  });
  assert.equal(held.find((c) => c.feedType === "london")!.pill.label, "2 ACTIVATED");
  // Held through the licence's feed_types with no tier grant: plain ACTIVATED.
  assert.equal(held.find((c) => c.feedType === "ny")!.pill.label, "ACTIVATED");
  for (const c of [...none, ...held]) {
    assert.doesNotMatch(c.pill.label, /LOCKED/);
    assert.doesNotMatch(c.action.label, /Upgrade/);
  }
});
