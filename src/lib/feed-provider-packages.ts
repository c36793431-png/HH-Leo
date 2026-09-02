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

export type TierGroup =
  | { kind: "package"; label: string; priceCents: number; members: ProviderTierRow[] }
  | { kind: "single"; tier: ProviderTierRow };

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
