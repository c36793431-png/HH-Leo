import type { FeedType } from "./licenses";

/**
 * Source of truth for feed-tier signup (marcus's spec, horizon-portal-v2051-polish
 * add-on). Tier keys/names are the list marcus supplied verbatim from coxwell's
 * request -- swap in real pricing once coxwell confirms the canonical list.
 */

export type FeedRegion = "london" | "ny" | "cme" | "tokyo";
export const FEED_REGIONS: FeedRegion[] = ["london", "ny", "cme", "tokyo"];

/** Maps a signup region to the license feed_types entitlement it corresponds to.
 * null regions (cme, tokyo) aren't wired to a FeedType yet -- coming soon only. */
export const FEED_REGION_TYPE: Record<FeedRegion, FeedType | null> = {
  london: "london",
  ny: "ny",
  cme: null,
  tokyo: "crypto",
};

export interface FeedTierMeta {
  key: string;
  name: string;
  region: FeedRegion;
}

export const FEED_TIERS: FeedTierMeta[] = [
  { key: "ld-alpha-85", name: "LD Alpha 85", region: "london" },
  { key: "ld-beta-56", name: "LD Beta 56", region: "london" },
  { key: "ld-gamma-19", name: "LD Gamma 19", region: "london" },
  { key: "ld-delta-18", name: "LD Delta 18", region: "london" },
  { key: "ld-ultra", name: "LD Ultra", region: "london" },
  { key: "ny-normal", name: "NY Beta", region: "ny" },
  { key: "ny-fast", name: "NY Alpha", region: "ny" },
  /** Pseudo-tier for the Retail package card's single request button (tiers/page.tsx
   * TIER_PACKAGE_KEY, london-tiers-retail-package-card-2026-08-29). Not a real feed_tiers
   * DB row and never rendered as its own card -- exists only so feed_tier_requests gets
   * one row per package purchase (tier_key is unconstrained text, no migration needed)
   * instead of three disconnected per-tier rows for what the client bought as one bundle. */
  { key: "ld-retail-package", name: "Retail Package (Beta 56 / Gamma 19 / Delta 18)", region: "london" },
];

/** Only the entry tier and the flagship get a trial CTA (coxwell, trial feature add-on,
 * horizon-portal-v2051-polish-2026-08-13) -- middle tiers stay paid-only. NY has no middle
 * tier (2 tiers total), so both are trial-eligible (coxwell, leo-ny-feed-trial-option-2026-08-15). */
export const TRIAL_ELIGIBLE_TIER_KEYS: readonly string[] = ["ld-alpha-85", "ld-ultra", "ny-normal", "ny-fast"];

export function isTrialEligibleTier(tierKey: string): boolean {
  return TRIAL_ELIGIBLE_TIER_KEYS.includes(tierKey);
}

const TIERS_BY_KEY: Map<string, FeedTierMeta> = new Map(FEED_TIERS.map((t) => [t.key, t]));

export function feedTierMeta(tierKey: string): FeedTierMeta | null {
  return TIERS_BY_KEY.get(tierKey) ?? null;
}

export function tiersForRegion(region: FeedRegion): FeedTierMeta[] {
  return FEED_TIERS.filter((t) => t.region === region);
}

export function isFeedRegion(value: string): value is FeedRegion {
  return (FEED_REGIONS as string[]).includes(value);
}

/** Reverse of FEED_REGION_TYPE -- lets /feeds cards (keyed by feeds-catalogue.ts slug/feedType)
 * find their tier-signup region without the two catalogues needing matching slugs. */
export function regionForFeedType(feedType: FeedType | null): FeedRegion | null {
  if (!feedType) return null;
  const match = (Object.entries(FEED_REGION_TYPE) as [FeedRegion, FeedType | null][]).find(
    ([, ft]) => ft === feedType
  );
  return match ? match[0] : null;
}
