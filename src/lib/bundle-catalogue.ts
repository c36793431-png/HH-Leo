import type { FeedType } from "./licenses";
import { listingByKey } from "./marketplace-catalogue";
import { expandTierKey } from "./feed-tier-catalogue";

/** Bundle DEFINITIONS live in code, for the same reason the listings do (marketplace-catalogue.ts: no
 * non-prod DB to rehearse a migration); bundle GRANTS live in bundle_subscriptions (0107). Plan m66837 (1).
 *
 * What a Horizon Complete licence delivers needs no field here:
 * - the strategy pack is the 4 strategies every licence unlocks once OBI is gated separately (coxwell Q-A, m66858);
 * - Nova follows the licence and is read only through novaEntitlement(), never from bundle code (plan 5b).
 *
 * NO PRICE in this file, ever (plan 5b P1): the price is a portal_config read in a signed-in server page,
 * so it can never ride a catalogue prop into a signed-out RSC payload. */

export type BundleKey = "horizon-complete";
export type BundleFeedChoice = "ld-base" | "ny-base";

export interface BundleDefinition {
  key: BundleKey;
  title: string;
  /** Set explicitly on a bundle-born licence, never left to the DB default (0012:9). */
  licenceTier: "paid";
  /** Marketplace listing keys: the buyer picks one at checkout. */
  feedChoices: BundleFeedChoice[];
}

export const BUNDLES: BundleDefinition[] = [
  { key: "horizon-complete", title: "Horizon Complete", licenceTier: "paid", feedChoices: ["ld-base", "ny-base"] },
];

export const BUNDLE_FEED_CHOICES: BundleFeedChoice[] = ["ld-base", "ny-base"];

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
