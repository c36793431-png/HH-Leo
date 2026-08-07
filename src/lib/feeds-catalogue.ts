import { FEED_TYPE_META, type FeedType } from "@/lib/licenses";

export interface FeedCatalogueEntry {
  slug: string;
  /** null = not wired to a license entitlement yet — always renders as "coming soon". */
  feedType: FeedType | null;
  name: string;
  countryFlag: string;
  countryCode: string;
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
    countryCode: "US",
    description: FEED_TYPE_META.futures.description,
    latencyBand: "<1ms typical",
    isLive: true,
  },
  {
    slug: "ny",
    feedType: "ny",
    name: FEED_TYPE_META.ny.name,
    countryFlag: "🇺🇸",
    countryCode: "US",
    description: FEED_TYPE_META.ny.description,
    latencyBand: "<1ms typical",
    isLive: true,
  },
  {
    slug: "london",
    feedType: "london",
    name: FEED_TYPE_META.london.name,
    countryFlag: "🇬🇧",
    countryCode: "GB",
    description: FEED_TYPE_META.london.description,
    latencyBand: "<1ms typical",
    isLive: true,
  },
  {
    slug: "crypto",
    feedType: "crypto",
    name: FEED_TYPE_META.crypto.name,
    countryFlag: "🇯🇵",
    countryCode: "JP",
    description: FEED_TYPE_META.crypto.description,
    // Tokyo TY3 latency pending coxwell confirmation (crypto venue may be a different
    // regime than the FX/futures co-lo cross-connects) — held per marcus, do not overwrite.
    latencyBand: "~50ms typical",
    isLive: true,
  },
];

/** "What's coming" roadmap — coxwell supplies entries as they're confirmed. Adding a feed
 * here with isLive: false renders it in the coming-soon grid on /feeds. */
export const COMING_SOON_CATALOGUE: FeedCatalogueEntry[] = [
  {
    slug: "singapore",
    feedType: null,
    name: "Singapore Feed",
    countryFlag: "🇸🇬",
    countryCode: "SG",
    description: "SG1 co-lo.",
    latencyBand: "Coming soon",
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
