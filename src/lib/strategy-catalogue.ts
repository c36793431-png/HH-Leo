import type { StrategyKey } from "@/lib/setfiles";
import { FEED_TYPE_META, type FeedType } from "@/lib/licenses";

export interface StrategyDisplayMeta {
  /** Full display name — kept here rather than derived from a setfile row so the card
   * still renders sensibly if a strategy_key ever has zero setfile rows published. */
  name: string;
  hook: string;
  marketFocus: string;
  /** Cross-link target on /feeds — the feed whose latency profile this strategy depends on. */
  recommendedFeedSlug: FeedType;
}

export const STRATEGY_ORDER: StrategyKey[] = ["1leg", "2leg_lock", "trend_impulse", "obi", "grid"];

export const STRATEGY_DISPLAY_META: Record<StrategyKey, StrategyDisplayMeta> = {
  "1leg": {
    name: "1 LEG — Latency Arbitrage",
    hook: "Trades the gap the instant the broker feed lags behind the Fast Feed.",
    marketFocus: "FX majors — London/NY overlap",
    recommendedFeedSlug: "ny",
  },
  "2leg_lock": {
    name: "2 LEG LOCK — Hedge Arbitrage",
    hook: "Opens both sides at once, keeps the winner, cuts the loser fast.",
    marketFocus: "FX majors — hedge-enabled brokers only",
    recommendedFeedSlug: "london",
  },
  trend_impulse: {
    name: "Trend Impulse — Fast-Feed Momentum",
    hook: "Catches sharp Fast Feed impulses before the broker catches up.",
    marketFocus: "FX majors, gold — London open + NY morning",
    recommendedFeedSlug: "ny",
  },
  obi: {
    name: "OBI — Order Block Imbalance",
    hook: "Trades genuine CME depth-of-book imbalance, not just latency.",
    marketFocus: "CME futures — ES, NQ, GC, CL",
    recommendedFeedSlug: "futures",
  },
  grid: {
    name: "Grid Arbitrage — Progressive Basket",
    hook: "Trend-filtered basket that averages in with progressively larger legs.",
    marketFocus: "FX/CFD — London + NY overlap",
    recommendedFeedSlug: "london",
  },
};

/** Co-lo code badge (e.g. "NY4") for a strategy's recommended feed — same vocabulary /feeds
 * already teaches the user, so no separate legend or tooltip is needed. */
export function strategyColoCode(meta: StrategyDisplayMeta): string {
  return FEED_TYPE_META[meta.recommendedFeedSlug].coloCode;
}

export type StrategyCardStatus = "active" | "trial" | "included" | "locked";

/** Strategies are gated as a bundle with the paid tier (no per-strategy entitlement column
 * exists yet, unlike feed_types on licenses) — so unlike /feeds, every card shares one status
 * for a given user. Mirrors /feeds' vocabulary (active/trial/included/locked) for a consistent
 * pill system across the two product-catalogue pages. */
export function computeStrategyCardStatus({
  paid,
  licenseTier,
  isAdmin,
}: {
  paid: boolean;
  licenseTier: string | null;
  isAdmin: boolean;
}): StrategyCardStatus {
  if (isAdmin) return "included";
  if (paid) return licenseTier === "trial" ? "trial" : "active";
  return "locked";
}
