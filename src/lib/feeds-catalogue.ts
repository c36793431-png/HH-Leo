import { FEED_TYPE_META, type FeedType } from "@/lib/licenses";
import { feedCardAvailability } from "@/lib/marketplace-catalogue";

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
    slug: "crypto",
    feedType: "crypto",
    name: FEED_TYPE_META.crypto.name,
    countryFlag: "🇯🇵",
    countryCode: "JP",
    description: FEED_TYPE_META.crypto.description,
    latencyBand: "<1ms typical",
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

export type FeedCardStatus = "active" | "trial" | "included" | "locked" | "coming_soon" | "maintenance";

export function computeFeedCardStatus(
  entry: FeedCatalogueEntry,
  {
    activeFeeds,
    licenseTier,
    isAdmin,
  }: { activeFeeds: FeedType[]; licenseTier: string | null; isAdmin: boolean }
): FeedCardStatus {
  // A product's availability has ONE home: marketplace-catalogue.ts. This card would otherwise
  // keep rendering CME Futures as a live feed (isLive: true) while /marketplace calls it
  // maintenance, and two surfaces disagreeing about a product is the defect itself, not a
  // cosmetic mismatch (marcus, m50717 #5 -- "both surfaces move together"). The override runs
  // BEFORE the entitlement branches deliberately: a feed that is down is down for the clients
  // who hold it too, not just for the ones who don't. Blast radius when it landed: zero rows in
  // licenses carry `futures` and there are no CME tiers to have granted, so no client's card
  // changed. Restoring the feed is a one-word edit in that file, and it moves both surfaces.
  //
  // THE BRIDGE BELOW IS DORMANT, AND IT IS THE ONE PATH FROM /marketplace TO /feeds. It maps
  // marketplace "coming-soon" onto FeedCardStatus coming_soon -- the same English on both
  // surfaces, from two different enums. Only a listing with a feedSlug reaches it; today that is
  // Chicago alone (maintenance), and Alpha/Ultra carry feedSlug: null. A marketplace state
  // that is added or renamed MUST be mapped here, or /feeds and /marketplace will disagree about
  // the same product. The switch is exhaustive so that omission fails the build, not the page.
  //
  // "unavailable" -> maintenance is a DELIBERATELY WRONG PLACEHOLDER. It is chosen only because it
  // fails CLOSED: /feeds has no "not available" label, and a declared non-available product must
  // never fall through to a live card. It is semantically false -- a product that is not for sale
  // is not "under maintenance". Nothing reaches it today. The FIRST listing that does needs a real
  // /feeds label ruled by coxwell before it ships; do not inherit this mapping as correct.
  const declared = feedCardAvailability(entry.slug);
  switch (declared) {
    case "maintenance":
    case "unavailable":
      return "maintenance";
    case "coming-soon":
      return "coming_soon";
    case "available":
    case null:
      break;
    default: {
      const unmapped: never = declared;
      return unmapped;
    }
  }
  if (!entry.isLive || !entry.feedType) return "coming_soon";
  if (activeFeeds.includes(entry.feedType)) return licenseTier === "trial" ? "trial" : "active";
  if (isAdmin) return "included";
  return "locked";
}
