import type { ProviderTierRow } from "./feed-providers";

/** feed_tiers has no package concept (coxwell hasn't decided that schema yet) -- this
 * grouping is a hardcoded literal, not data. It exists only to stop a tier list from
 * reading as N separately-priced products when London's three tiers and NY's two tiers
 * are each sold together as one package. If a new tier is added to feed_tiers, it will NOT
 * be picked up here automatically -- it falls through to its own ungrouped row, and this
 * list needs a manual update to fold it into a package. Shared by the Revenue and Feeds
 * tabs so there is exactly one place this mapping can drift. */
export const PACKAGES: { label: string; tierKeys: string[] }[] = [
  { label: "London Base", tierKeys: ["ld-beta-56", "ld-gamma-19", "ld-delta-18"] },
  { label: "NY", tierKeys: ["ny-normal", "ny-fast"] },
];

/** Package label for a tier_key, or null if it isn't in any PACKAGES entry (renders
 * standalone). Single lookup point so Overview's per-client activity grouping uses the
 * same membership data as groupTiers instead of a second literal. */
export function packageLabelForTierKey(tierKey: string): string | null {
  return PACKAGES.find((pkg) => pkg.tierKeys.includes(tierKey))?.label ?? null;
}

export type TierGroup =
  | { kind: "package"; label: string; priceCents: number; members: ProviderTierRow[] }
  | { kind: "single"; tier: ProviderTierRow };

/** London's number is FOC13's comparison score (feed-comparison-scores.ts), not a measured
 * latency -- every other region's latency_us is a real microsecond figure. The two need
 * different display units, and that decision drifted between the tiers page and the Feeds
 * tab once already (feeds-tab-latency-column-2026-09-02) because it lived as an inline
 * `region === "london"` check in two places. Shared here so it can't drift a third time. */
export function isScoreRegion(region: string): boolean {
  return region === "london";
}

/** Combined value+unit text for a tier's latency cell, e.g. "56/100" or "42µs". Does not
 * change latency_us or speed_display -- display only. */
export function formatTierLatency(region: string, t: { latencyUs: number | null; speedDisplay: string }): string {
  if (t.latencyUs == null) return t.speedDisplay;
  return isScoreRegion(region) ? `${t.speedDisplay}/100` : `${t.speedDisplay}µs`;
}

export function groupTiers(tiers: ProviderTierRow[]): TierGroup[] {
  const used = new Set<string>();
  const groups: TierGroup[] = [];

  for (const pkg of PACKAGES) {
    const members = tiers.filter((t) => pkg.tierKeys.includes(t.tierKey));
    if (members.length === 0) continue;
    members.forEach((t) => used.add(t.id));
    groups.push({ kind: "package", label: pkg.label, priceCents: members[0].priceCents ?? 0, members });
  }

  for (const t of tiers) {
    if (!used.has(t.id)) groups.push({ kind: "single", tier: t });
  }

  return groups;
}
