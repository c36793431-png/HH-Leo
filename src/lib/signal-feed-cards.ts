import { FEED_TYPES, FEED_TYPE_META, computePortalTierFromLicenses, type FeedType } from "./licenses";
import { FEED_CATALOGUE, computeFeedCardStatus } from "./feeds-catalogue";
import { regionForFeedType } from "./feed-tier-catalogue";
import type { getTierCountsByRegion, getBestLatencyByRegion } from "./feed-tiers";

export interface SignalFeedCard {
  feedType: FeedType;
  name: string;
  countryCode: string;
  stat: string | null;
  pill: { color: "green" | "teal"; label: string };
  tierBadge: string | null;
  action: { label: string; href: string; external: boolean };
}

/** "ACTIVATED", or "2 ACTIVATED" when the account holds that many tiers of a multi-tier feed.
 * Upper-case here; /feeds' pill is lower-cased text under a text-transform: uppercase class. */
export function activatedLabel(heldTiers: number): string {
  return heldTiers > 0 ? `${heldTiers} ACTIVATED` : "ACTIVATED";
}

/** Live tiers per region for one account, from its live grants (listLiveFeedTierGrantsForSubscriber):
 * distinct tier keys, so a tier held on two licences counts once. */
export function countActivatedTiersByRegion(grants: { tierKey: string; regionKey: string }[]): Record<string, number> {
  const byRegion = new Map<string, Set<string>>();
  for (const g of grants) {
    if (!byRegion.has(g.regionKey)) byRegion.set(g.regionKey, new Set());
    byRegion.get(g.regionKey)!.add(g.tierKey);
  }
  return Object.fromEntries([...byRegion].map(([region, tiers]) => [region, tiers.size]));
}

/** The four Signal Feed cards: /dashboard's strip and the terminal product page's licensed Access
 * box (coxwell via marcus, m53069) both render from this, so the two cannot disagree about which
 * feeds an account holds or where "See tiers →" goes. Moved verbatim out of dashboard/page.tsx. */
export function computeSignalFeedCards({
  activeFeeds,
  activeLicenses,
  isAdmin,
  feedTierCounts,
  feedBestLatency,
  activatedTierCounts = {},
}: {
  activeFeeds: FeedType[];
  activeLicenses: { tier: string }[];
  isAdmin: boolean;
  feedTierCounts: Awaited<ReturnType<typeof getTierCountsByRegion>>;
  feedBestLatency: Awaited<ReturnType<typeof getBestLatencyByRegion>>;
  /** This account's live tiers per region (countActivatedTiersByRegion). */
  activatedTierCounts?: Record<string, number>;
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
    // One vocabulary for every client surface (coxwell 14:05Z via marcus m59956): nothing on it
    // is AVAILABLE, never LOCKED; held is ACTIVATED, with the count of held tiers on a multi-tier
    // feed. A feed held through the licence's feed_types alone has no tier grant to count.
    const pill: { color: "green" | "teal"; label: string } = isOwned
      ? { color: "green", label: activatedLabel(hasDrillIn && region ? activatedTierCounts[region] ?? 0 : 0) }
      : { color: "teal", label: "AVAILABLE" };
    // Tier count is a fact about the feed, not a property of ownership status — no isOwned gate,
    // matching /feeds (thread multi-license-visibility-2026-08-31, marcus).
    const tierBadge = hasDrillIn ? `${tierCount} TIER${tierCount === 1 ? "" : "S"}` : null;

    // Both branches route in-product now (coxwell, leo-cross-region-server-picker-2026-09-04:
    // "yes feed picker instead of telegram") — a paying client hitting a locked feed used to be
    // sent to Telegram instead of the tier picker they actually needed.
    const action = {
      label: hasDrillIn ? "See tiers →" : "View feeds →",
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
