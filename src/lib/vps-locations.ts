import type { FeedType } from "@/lib/licenses";

export interface VpsLocation {
  city: string;
  country: string;
  descriptor: string;
  datacenter?: string;
  live: boolean;
  /** Set when this city hosts one of our own feeds, so the VPS page can point out that a
   * client already paying for that feed can colocate next to it. */
  feedType?: FeedType;
}

/** Tradox's live location lineup, read from their own site nav 2026-09-06. Frankfurt is not
 * orderable yet -- flip `live` to true here (and drop the descriptor's "Coming soon") once it
 * is, there is no second list of locations anywhere else to keep in sync. */
export const VPS_LOCATIONS: VpsLocation[] = [
  { city: "Chicago", country: "US", descriptor: "CME futures & Kalshi", live: true },
  { city: "New York", country: "US", descriptor: "Forex & US equities", datacenter: "NY4", live: true, feedType: "ny" },
  { city: "London", country: "UK", descriptor: "Forex", datacenter: "Telehouse", live: true, feedType: "london" },
  { city: "Amsterdam", country: "NL", descriptor: "Crypto & EU forex", live: true },
  { city: "Dublin", country: "IE", descriptor: "Crypto & Polymarket", live: true },
  { city: "Frankfurt", country: "DE", descriptor: "Coming soon", live: false },
];

export interface VpsPlan {
  name: string;
  priceUsdPerMonth: number;
  forDescription: string;
  vCores: number;
  ramGb: number;
  storageGb: number;
  mostPopular?: boolean;
}

/** Only the three plans Tradox publishes a price for (2026-09-06 read). Three larger plans
 * exist (8/12/16 vCore) but were not captured with a price -- do not add them here until
 * they are. */
export const VPS_PLANS: VpsPlan[] = [
  { name: "Starter Trader", priceUsdPerMonth: 39, forDescription: "1-2 strategies", vCores: 2, ramGb: 6, storageGb: 75 },
  { name: "Active Trader", priceUsdPerMonth: 69, forDescription: "3-4 strategies", vCores: 4, ramGb: 12, storageGb: 150, mostPopular: true },
  { name: "Advanced Trader", priceUsdPerMonth: 99, forDescription: "5-6 strategies", vCores: 6, ramGb: 18, storageGb: 250 },
];
