import { FEED_TYPES, FEED_TYPE_META, computePortalTierFromLicenses, type FeedType } from "./licenses";
import { FEED_CATALOGUE, computeFeedCardStatus } from "./feeds-catalogue";
import { regionForFeedType } from "./feed-tier-catalogue";
import type { getTierCountsByRegion, getBestLatencyByRegion } from "./feed-tiers";

export interface SignalFeedCard {
  feedType: FeedType;
  name: string;
  countryCode: string;
  stat: string | null;
  pill: { color: "green" | "red"; label: string };
  tierBadge: string | null;
  action: { label: string; href: string; external: boolean };
}

/** The four Signal Feed cards: /dashboard's strip and the terminal product page's licensed Access
 * box (coxwell via marcus, m53069) both render from this, so the two cannot disagree about which
 * feeds an account holds or where "Upgrade →" goes. Moved verbatim out of dashboard/page.tsx. */
export function computeSignalFeedCards({
  activeFeeds,
  activeLicenses,
  isAdmin,
  feedTierCounts,
  feedBestLatency,
}: {
  activeFeeds: FeedType[];
  activeLicenses: { tier: string }[];
  isAdmin: boolean;
  feedTierCounts: Awaited<ReturnType<typeof getTierCountsByRegion>>;
  feedBestLatency: Awaited<ReturnType<typeof getBestLatencyByRegion>>;
}): SignalFeedCard[] {
  // Highest tier across every active license wins (thread multi-license-visibility-2026-08-31,
  // marcus) — a paying client must never see "Trial" on a feed just because getLatestIssuedLicenseForUser's
  // latest-issued row happens to be an older trial.
  const { tier: bestActiveTier } = computePortalTierFromLicenses(false, activeLicenses);
  const bestLicenseTier = bestActiveTier === "free" ? null : bestActiveTier;

  const feedCatalogueByType = new Map(FEED_CATALOGUE.map((entry) => [entry.feedType, entry]));
  return FEED_TYPES.map((feedType) => {
    const catalogueEntry = feedCatalogueByType.get(feedType);
    const meta = FEED_TYPE_META[feedType];
    const status = catalogueEntry
      ? computeFeedCardStatus(catalogueEntry, { activeFeeds, licenseTier: bestLicenseTier, isAdmin })
      : "locked";
    const region = regionForFeedType(feedType);
    const tierCount = region ? feedTierCounts[region] ?? 0 : 0;
    const hasDrillIn = tierCount > 1;
    const isOwned = status === "active" || status === "trial" || status === "included";

    // Status pill always reflects real ownership — a tier count is informational and must never
    // replace it (thread multi-license-visibility-2026-08-31, marcus: NY showed "2 TIERS" where
    // the header read "1 OF 4 ACTIVE"). /feeds renders both as separate pills; mirror that here.
    const pill: { color: "green" | "red"; label: string } = isOwned
      ? { color: "green", label: "ACTIVE" }
      : { color: "red", label: "LOCKED" };
    // Tier count is a fact about the feed, not a property of ownership status — no isOwned gate,
    // matching /feeds (thread multi-license-visibility-2026-08-31, marcus).
    const tierBadge = hasDrillIn ? `${tierCount} TIER${tierCount === 1 ? "" : "S"}` : null;

    // Both branches route in-product now (coxwell, leo-cross-region-server-picker-2026-09-04:
    // "yes feed picker instead of telegram") — a paying client hitting a locked feed used to be
    // sent to Telegram instead of the tier picker they actually needed.
    const action = {
      label: pill.color === "red" ? "Upgrade →" : "See tiers →",
      href: hasDrillIn && region ? `/feeds/${region}/tiers` : "/feeds",
      external: false,
    };

    const bestLatency = region ? feedBestLatency[region] : undefined;
    const colo = meta.coloCode ? `${meta.coloCode} co-lo` : null;
    const stat = [bestLatency != null ? `${bestLatency}µs` : null, colo].filter(Boolean).join(" · ") || null;

    return {
      feedType,
      name: meta.name,
      countryCode: catalogueEntry?.countryCode ?? "US",
      stat,
      pill,
      tierBadge,
      action,
    };
  });
}
