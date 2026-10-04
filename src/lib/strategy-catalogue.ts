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

// Names and hooks must not contradict the live www /strategies/<slug> pages (marcus m59654): one
// line each, worded from www, no new claims.
export const STRATEGY_DISPLAY_META: Record<StrategyKey, StrategyDisplayMeta> = {
  "1leg": {
    name: "1 LEG — Latency Arbitrage",
    hook: "Trades the gap the instant the broker feed lags behind the Fast Feed.",
    marketFocus: "FX majors — London/NY overlap",
    recommendedFeedSlug: "ny",
  },
  "2leg_lock": {
    name: "2 LEG LOCK — Hedge Arbitrage",
    hook: "Holds a BUY and a SELL; when the fast feed leads by your Exec Gap it closes the wrong side, and broker orders lock the other again at its target or stop.",
    marketFocus: "FX majors — hedge-enabled brokers only",
    recommendedFeedSlug: "london",
  },
  trend_impulse: {
    name: "Trend Impulse — Fast-Feed Momentum",
    hook: "When price moves far enough on the fast feed within a short time window, it opens one position the same way and exits on the rules you set.",
    marketFocus: "FX majors, gold — London open + NY morning",
    recommendedFeedSlug: "ny",
  },
  obi: {
    name: "OBI — Order Book Imbalance",
    hook: "Enters on the side where the CME Futures feed leads your broker's price; it trades on prices only and does not read order-book volume.",
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
 * already teaches the user, so no separate legend or tooltip is needed. null when the feed has
 * no co-lo code (futures), and the badge is then not rendered. */
export function strategyColoCode(meta: StrategyDisplayMeta): string | null {
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
