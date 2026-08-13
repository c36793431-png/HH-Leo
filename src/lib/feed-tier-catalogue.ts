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
  { key: "ny-normal", name: "NY Normal", region: "ny" },
  { key: "ny-fast", name: "NY Fast", region: "ny" },
];

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
