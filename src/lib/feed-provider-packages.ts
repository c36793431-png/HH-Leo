import type { ProviderTierRow } from "./feed-providers";
import { scoreForTierKey } from "./feed-comparison-scores";

/** feed_tiers has no package concept (coxwell hasn't decided that schema yet) -- this
 * grouping is a hardcoded literal, not data. It exists only to stop a tier list from
 * reading as N separately-priced products when London's three tiers and NY's two tiers
 * are each sold together as one package. If a new tier is added to feed_tiers, it will NOT
 * be picked up here automatically -- it falls through to its own ungrouped row, and this
 * list needs a manual update to fold it into a package. Shared by the Revenue and Feeds
 * tabs so there is exactly one place this mapping can drift. */
/** defaultPriceCents (bus thread leo-provider-subscribers-page-2026-09-06, Job C, coxwell:
 * "Ld base 30 nd ny base 30") is list-price reference only -- the Revenue catalogue view's
 * "list price" column and a future pre-fill affordance. Marcus's m46504 ruling revoked the
 * read path's original COALESCE(subscription.price_cents, package default) shape: a payout
 * total must never silently substitute this for an unset per-client price (a client whose
 * price has never been negotiated would render as if it had one -- fabricated money on a
 * dashboard read as fact). providerShareCentsFor/-For below take ONLY the subscription's own
 * price_cents; a null there renders and totals as unset, full stop, no fallback. Previously
 * the catalogue-view default was derived as `members[0].priceCents` off whichever feed_tiers
 * row happened to sort first -- an arbitrary catalogue row standing in for a commercial
 * decision that was never made per-tier. That was the bug named in Job C (also hit
 * /feed/dashboard/revenue, which reads groupTiers() directly) -- a literal here removes the
 * dependency on catalogue row order entirely. */
export const PACKAGES: { label: string; tierKeys: string[]; defaultPriceCents: number }[] = [
  { label: "LD Base", tierKeys: ["ld-beta-56", "ld-gamma-19", "ld-delta-18"], defaultPriceCents: 3000 },
  { label: "NY Base", tierKeys: ["ny-normal", "ny-fast"], defaultPriceCents: 3000 },
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
 * change latency_us or speed_display -- display only.
 *
 * Score regions (London) never read latency_us/speedDisplay -- feed_tiers holds FOC13's
 * comparison score there, not real microseconds, and it has drifted from the canonical
 * FEED_COMPARISON_SCORES before (marcus, leo-london-tier-score-mismatch-2026-09-07). Keyed
 * by tier_key via scoreForTierKey, same source as the tiers page and getBestLatencyByRegion
 * so the three can't drift from each other. A tier_key with no score entry renders "--"
 * rather than falling back to the untrusted DB value. */
export function formatTierLatency(
  region: string,
  t: { tierKey: string; latencyUs: number | null; speedDisplay: string }
): string {
  if (isScoreRegion(region)) {
    const score = scoreForTierKey(t.tierKey);
    return score != null ? `${score.toFixed(1)}/100` : "--";
  }
  return t.latencyUs == null ? t.speedDisplay : `${t.speedDisplay}µs`;
}

export function groupTiers(tiers: ProviderTierRow[]): TierGroup[] {
  const used = new Set<string>();
  const groups: TierGroup[] = [];

  for (const pkg of PACKAGES) {
    const members = tiers.filter((t) => pkg.tierKeys.includes(t.tierKey));
    if (members.length === 0) continue;
    members.forEach((t) => used.add(t.id));
    groups.push({ kind: "package", label: pkg.label, priceCents: pkg.defaultPriceCents, members });
  }

  for (const t of tiers) {
    if (!used.has(t.id)) groups.push({ kind: "single", tier: t });
  }

  return groups;
}

function money(cents: number): string {
  return `$${(cents / 100).toLocaleString(undefined, { minimumFractionDigits: 0, maximumFractionDigits: 0 })}`;
}

type ShareStatus = "trial" | "active" | "lapsed";

/** Provider's notional 50% share for one subscription/package, bus thread
 * leo-provider-panel-package-labels-2026-09-04 (coxwell, Job 6): "50% of the payment is paid
 * to the feed provider ... for the paying clients not the trial." Shared by every dashboard
 * surface that shows a payout figure (Subscribers row/total, Overview card, Revenue) per
 * marcus's m46504 ruling -- one function so they cannot disagree; a mismatch would be a data
 * problem, never two call sites drifting apart.
 *
 * Returns null for anything other than `status === "active"` (EFFECTIVE_STATUS_SQL, same
 * predicate as the Status badge) AND for a row with no priceCents at all -- there is no
 * default-price fallback here (m46504: a hardcoded default reads as a real negotiated price
 * once it flows into a revenue total). Callers must treat null as "unset", not $0. */
export function providerShareCentsFor(status: ShareStatus, priceCents: number | null | undefined): number | null {
  if (status !== "active" || priceCents == null) return null;
  return Math.round(priceCents / 2);
}

/** Display text for providerShareCentsFor. Three distinct outcomes: null (status isn't
 * active -- "no payment applies", renders blank), "Not set" (active, but no price has ever
 * been negotiated for this client -- distinct from a real $0), or the dollar figure. */
export function providerShareFor(status: ShareStatus, priceCents: number | null | undefined): string | null {
  if (status !== "active") return null;
  const cents = providerShareCentsFor(status, priceCents);
  return cents == null ? "Not set" : money(cents);
}
