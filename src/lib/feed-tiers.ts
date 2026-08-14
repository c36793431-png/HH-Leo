import { pool } from "./db";
import { FEED_REGIONS, isFeedRegion, type FeedRegion } from "./feed-tier-catalogue";

export interface FeedTierDetail {
  regionKey: FeedRegion;
  tierKey: string;
  name: string;
  subtitle: string;
  speedDisplay: string;
  latencyUs: number | null;
  description: string;
  priceCents: number | null;
  isFlagship: boolean;
  pathRedundancy: string;
  supportLevel: string;
}

interface TierRow {
  region_key: string;
  tier_key: string;
  name: string;
  subtitle: string;
  speed_display: string;
  latency_us: number | null;
  description: string;
  price_cents: number | null;
  is_flagship: boolean;
  path_redundancy: string;
  support_level: string;
}

function mapRow(row: TierRow): FeedTierDetail | null {
  if (!isFeedRegion(row.region_key)) return null;
  return {
    regionKey: row.region_key,
    tierKey: row.tier_key,
    name: row.name,
    subtitle: row.subtitle,
    speedDisplay: row.speed_display,
    latencyUs: row.latency_us,
    description: row.description,
    priceCents: row.price_cents,
    isFlagship: row.is_flagship,
    pathRedundancy: row.path_redundancy,
    supportLevel: row.support_level,
  };
}

const SELECT_BASE = `
  select region_key, tier_key, name, subtitle, speed_display, latency_us, description,
         price_cents, is_flagship, path_redundancy, support_level
  from feed_tiers
`;

export async function getTiersForRegion(region: FeedRegion): Promise<FeedTierDetail[]> {
  const result = await pool.query<TierRow>(`${SELECT_BASE} where region_key = $1 order by sort_order asc`, [
    region,
  ]);
  return result.rows.map(mapRow).filter((t): t is FeedTierDetail => t !== null);
}

/** Region -> tier count, for the "N tiers" pill on /feeds. Regions with 0 or 1 rows
 * don't get a tiers page -- single-tier regions stay on the plain feed card. */
export async function getTierCountsByRegion(): Promise<Partial<Record<FeedRegion, number>>> {
  const result = await pool.query<{ region_key: string; count: string }>(
    `select region_key, count(*)::text as count from feed_tiers group by region_key`
  );
  const counts: Partial<Record<FeedRegion, number>> = {};
  for (const row of result.rows) {
    if (isFeedRegion(row.region_key)) counts[row.region_key] = Number(row.count);
  }
  return counts;
}

export async function getMultiTierRegions(): Promise<FeedRegion[]> {
  const counts = await getTierCountsByRegion();
  return FEED_REGIONS.filter((r) => (counts[r] ?? 0) > 1);
}

/** Region -> lowest known latency_us, for the Dashboard compact feed cards' stat line.
 * Tiers with no confirmed figure yet (latency_us null, e.g. flagship "MIN" tiers or NY's
 * pending rows) are excluded rather than treated as 0. */
export async function getBestLatencyByRegion(): Promise<Partial<Record<FeedRegion, number>>> {
  const result = await pool.query<{ region_key: string; min_latency: number | null }>(
    `select region_key, min(latency_us) as min_latency from feed_tiers where latency_us is not null group by region_key`
  );
  const best: Partial<Record<FeedRegion, number>> = {};
  for (const row of result.rows) {
    if (isFeedRegion(row.region_key) && row.min_latency != null) best[row.region_key] = row.min_latency;
  }
  return best;
}
