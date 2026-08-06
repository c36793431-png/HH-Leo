import { FEED_TYPE_META, type FeedType } from "@/lib/licenses";

export interface FeedCatalogueEntry {
  slug: string;
  /** null = not wired to a license entitlement yet — always renders as "coming soon". */
  feedType: FeedType | null;
  name: string;
  countryFlag: string;
  description: string;
  latencyBand: string;
  isLive: boolean;
}

/** Declarative v1 catalogue — no admin editor yet, so this list is the single source of
 * truth for what appears on /feeds. Live entries must have a matching FeedType so their
 * per-user status can be derived from the license's feed_types array. */
export const FEED_CATALOGUE: FeedCatalogueEntry[] = [
  {
    slug: "futures",
    feedType: "futures",
    name: FEED_TYPE_META.futures.name,
    countryFlag: "🇺🇸",
    description: FEED_TYPE_META.futures.description,
    latencyBand: "~15ms typical",
    isLive: true,
  },
  {
    slug: "london",
    feedType: "london",
    name: FEED_TYPE_META.london.name,
    countryFlag: "🇬🇧",
    description: FEED_TYPE_META.london.description,
    latencyBand: "~15ms typical",
    isLive: true,
  },
  {
    slug: "ny",
    feedType: "ny",
    name: FEED_TYPE_META.ny.name,
    countryFlag: "🇺🇸",
    description: FEED_TYPE_META.ny.description,
    latencyBand: "~15ms typical",
    isLive: true,
  },
  {
    slug: "crypto",
    feedType: "crypto",
    name: FEED_TYPE_META.crypto.name,
    countryFlag: "🌐",
    description: FEED_TYPE_META.crypto.description,
    latencyBand: "~50ms typical",
    isLive: true,
  },
  {
    slug: "asian",
    feedType: null,
    name: "Asian Feeds",
    countryFlag: "🇯🇵🇸🇬🇭🇰",
    description: "Tokyo, Singapore & Hong Kong session signals — in the pipeline.",
    latencyBand: "TBD",
    isLive: false,
  },
];

export type FeedCardStatus = "active" | "trial" | "included" | "locked" | "coming_soon";

export function computeFeedCardStatus(
  entry: FeedCatalogueEntry,
  {
    activeFeeds,
    licenseTier,
    isAdmin,
  }: { activeFeeds: FeedType[]; licenseTier: string | null; isAdmin: boolean }
): FeedCardStatus {
  if (!entry.isLive || !entry.feedType) return "coming_soon";
  if (activeFeeds.includes(entry.feedType)) return licenseTier === "trial" ? "trial" : "active";
  if (isAdmin) return "included";
  return "locked";
}
