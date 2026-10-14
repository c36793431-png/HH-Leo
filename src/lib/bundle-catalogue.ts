import type { FeedType } from "./licenses";
import type { StrategyKey } from "./setfiles";
import { listingByKey, type IncludedLine } from "./marketplace-catalogue";
import { expandTierKey } from "./feed-tier-catalogue";
import { STRATEGY_DISPLAY_META } from "./strategy-catalogue";

/** Bundle DEFINITIONS live in code, for the same reason the listings do (marketplace-catalogue.ts: no
 * non-prod DB to rehearse a migration); bundle GRANTS live in bundle_subscriptions (0107). Plan m66837 (1).
 *
 * What a Horizon Complete licence delivers needs no field here:
 * - the strategy pack is the 4 strategies every licence unlocks once OBI is gated separately (coxwell Q-A, m66858);
 * - Nova follows the licence and is read only through novaEntitlement(), never from bundle code (plan 5b).
 *
 * NO PRICE in this file, ever: the portal shows clients no price anywhere (coxwell 10-14 via marcus m68871,
 * m68882), and a field here would ride the catalogue prop into every basket payload. */

export type BundleKey = "horizon-complete";
export type BundleFeedChoice = "ld-base" | "ny-base";

export interface BundleDefinition {
  key: BundleKey;
  title: string;
  /** The shelf card's and the product page's one sentence (client copy, coxwell C1). */
  blurb: string;
  /** Set explicitly on a bundle-born licence, never left to the DB default (0012:9). */
  licenceTier: "paid";
  /** Marketplace listing keys: the buyer picks one at checkout. */
  feedChoices: BundleFeedChoice[];
}

export const BUNDLES: BundleDefinition[] = [
  {
    key: "horizon-complete",
    title: "Horizon Complete",
    blurb: "The Horizon licence, the strategy pack and one Base feed of your choice, as one bundle.",
    licenceTier: "paid",
    feedChoices: ["ld-base", "ny-base"],
  },
];

/** Bundle art (coxwell 10-14 via marcus m68634: Iris's variant A), the one map for the shelf card's plate, the
 * product page's hero (coxwell 10-14 via marcus m69323) and the basket line's thumb (marcus m68882 D). Keyed by
 * BundleKey, so a new bundle can't render without art. The key content sits in a 1.85:1 centre band, so the card
 * plate's cover crop is safe from 222px (desktop) to 318px (mobile) wide; the hero shows the whole 8:3 frame,
 * uncropped; the basket thumb (88x56, 1.57:1) trims about 8% of the band on each side. */
export const BUNDLE_CARD_ART: Record<BundleKey, { src640: string; src960: string; alt: string }> = {
  "horizon-complete": {
    src640: "/marketplace/bundles/horizon-complete-card-640.webp",
    src960: "/marketplace/bundles/horizon-complete-card-960.webp",
    alt: "A Base feed stream, the Horizon app and the strategy pack, joined into one on a horizon line",
  },
};

export const BUNDLE_FEED_CHOICES: BundleFeedChoice[] = ["ld-base", "ny-base"];

/** The strategy pack: every strategy a licence unlocks except OBI, which coxwell sells separately (Q-A, m66858).
 * Today OBI still unlocks with any licence, so this list understates and never overclaims (Fable S2 N2). */
export const BUNDLE_STRATEGY_KEYS: StrategyKey[] = ["1leg", "2leg_lock", "trend_impulse", "grid"];

/** The Nova line in "What's included", or null for none. Of the three variants (marcus m67879: (0) null; (a) "Nova";
 * (b) this one), coxwell picked (b) while N-S1 is unbuilt (copy OK via marcus m67960 #1): it says Nova is set up
 * with the client, not switched on at purchase (Fable 5b C4). */
export const BUNDLE_NOVA_LINE: string | null = "Nova (set up with you after purchase)";

/** "What's included" on the product page. Every name is read from the catalogues, none typed here: the
 * strategies from STRATEGY_DISPLAY_META, the feeds from their listing titles. No price, no share, no tier price. */
export function bundleIncludedLines(bundle: BundleDefinition, novaLine: string | null = BUNDLE_NOVA_LINE): IncludedLine[] {
  const feeds = bundle.feedChoices.map((c) => listingByKey(c)?.title ?? c);
  return [
    "Horizon licence",
    { label: "Strategies", items: BUNDLE_STRATEGY_KEYS.map((k) => STRATEGY_DISPLAY_META[k].name) },
    ...(novaLine ? [novaLine] : []),
    `One Base feed, your choice: ${feeds.join(" or ")}`,
  ];
}

/** The licence feed_type each choice needs, so the admin panel's feed picker offers the region. */
const FEED_CHOICE_FEED_TYPE: Record<BundleFeedChoice, FeedType> = { "ld-base": "london", "ny-base": "ny" };

export function bundleByKey(key: string): BundleDefinition | null {
  return BUNDLES.find((b) => b.key === key) ?? null;
}

export function isBundleFeedChoice(value: string): value is BundleFeedChoice {
  return (BUNDLE_FEED_CHOICES as string[]).includes(value);
}

export function bundleFeedType(choice: BundleFeedChoice): FeedType {
  return FEED_CHOICE_FEED_TYPE[choice];
}

/** The real member tier keys of a feed choice (LD Base -> 3, NY Base -> 2), read from the listing through
 * the same expansion a basket feed line uses (basket-forward.ts basketLineTierKeys), so they cannot drift. */
export function bundleFeedTierKeys(choice: BundleFeedChoice): string[] {
  const listing = listingByKey(choice);
  if (!listing || listing.tierKeys.length === 0) throw new Error(`Bundle feed choice ${choice} has no listing tiers`);
  return [...new Set(listing.tierKeys.flatMap(expandTierKey))];
}
