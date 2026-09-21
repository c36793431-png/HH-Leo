import type { FeedType } from "./licenses";

/**
 * Source of truth for feed-tier signup (marcus's spec, horizon-portal-v2051-polish
 * add-on). Tier keys/names are the list marcus supplied verbatim from coxwell's
 * request -- swap in real pricing once coxwell confirms the canonical list.
 */

export type FeedRegion = "london" | "ny" | "cme" | "tokyo";
export const FEED_REGIONS: FeedRegion[] = ["london", "ny", "cme", "tokyo"];

/** Human labels for a region_key, hoisted out of the Subscribers page 2026-09-12 (bus thread
 * leo-provider-revenue-ny-base-2026-09-12) when Revenue's region switch became a second
 * consumer -- two provider surfaces naming the same region differently is the kind of drift
 * that makes coxwell doubt both. Callers keep their own fallback for a null/unknown region_key
 * ("Other" on Subscribers); this map only covers the four keys the catalogue knows. */
export const FEED_REGION_LABELS: Record<FeedRegion, string> = {
  london: "London",
  ny: "New York",
  cme: "CME",
  tokyo: "Tokyo",
};

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
  { key: "ld-alpha-85", name: "Alpha", region: "london" },
  { key: "ld-beta-56", name: "LD Beta 56", region: "london" },
  { key: "ld-gamma-19", name: "LD Gamma 19", region: "london" },
  { key: "ld-delta-18", name: "LD Delta 18", region: "london" },
  { key: "ld-ultra", name: "Ultra", region: "london" },
  { key: "ny-normal", name: "NY Beta", region: "ny" },
  { key: "ny-fast", name: "NY Alpha", region: "ny" },
  /** Pseudo-tier for the Base package card's single request button (tiers/page.tsx
   * TIER_PACKAGE_KEY, london-tiers-retail-package-card-2026-08-29). Not a real feed_tiers
   * DB row and never rendered as its own card. SUBMIT-SIDE ONLY since 0086 phase 2: the
   * button posts this key, createFeedTierRequest expands it through expandTierKey() and
   * writes one access_requests envelope per MEMBER tier in one batch, so no stored row
   * carries this tier_key and no read path can find one under it (it named the single
   * feed_tier_requests row per package purchase before 0086; that table is no longer
   * written or read). Anything showing a package's state has to derive it from the member
   * tiers -- tiers/page.tsx packageCardState(), added after this stale wording cost the
   * package card its granted/pending state (marcus R1,
   * kai-feed-entitlement-vs-request-visibility-2026-09-13).
   * name is client-facing via feed-tier-requests.ts's admin queue + Telegram approve/decline
   * DM (feedTierMeta lookup) -- renamed Retail -> Base per coxwell (marcus, feed-tier-entitlement-2026-09-01),
   * tier_key ("ld-retail-package") intentionally unchanged, same pattern as 0074's Alpha/Ultra rename. */
  { key: "ld-retail-package", name: "LD Base Package (Beta 56 / Gamma 19 / Delta 18)", region: "london" },
  /** Same pseudo-tier pattern as ld-retail-package, for NY's Base bundle
   * (marcus/coxwell, leo-ny-base-package-2026-09-04). No feed_tiers row either. */
  { key: "ny-retail-package", name: "NY Base Package (NY Alpha / NY Beta)", region: "ny" },
];

/** Package pseudo-tier -> its real member tier keys. Provider scoping (feed-providers.ts
 * listPendingRequestsForProvider/assertOwnsRequestTier) has to expand a package request's
 * tier_key against this before matching it to a provider's owned feed_tiers rows, since no
 * provider ever owns "ld-retail-package" itself (bug confirmed m35243, live since
 * 2026-08-29: package requests were invisible to every provider's queue and unapprovable
 * even manually). Single source of truth for that expansion -- both call sites in
 * feed-providers.ts import expandTierKey() rather than each hardcoding the member list.
 * Keep in sync with tiers/page.tsx's TIER_PACKAGE_KEY (the display-grouping inverse of
 * this, used to render the three members as one card). */
export const PACKAGE_TIER_KEYS: Record<string, string[]> = {
  "ld-retail-package": ["ld-beta-56", "ld-gamma-19", "ld-delta-18"],
  "ny-retail-package": ["ny-fast", "ny-normal"],
};

export function expandTierKey(tierKey: string): string[] {
  return PACKAGE_TIER_KEYS[tierKey] ?? [tierKey];
}

/** The BUYER-FACING name of a package, keyed by tiers/page.tsx's TIER_PACKAGE_KEY grouping key
 * ("retail"/"ny-retail" -- the pseudo-tier keys' stems, kept as-is per the ld-retail-package
 * note above). Hoisted out of tiers/page.tsx 2026-09-14 when /marketplace became a second
 * surface naming the same bundle: both regions' bundles are called "Base", and a rename by
 * coxwell has to move both surfaces or they misname the same product at each other
 * (marcus, m50723 #4). Deliberately NOT feed-provider-packages.ts's PACKAGES[].label
 * ("LD Base"/"NY Base") -- that is the PROVIDER-side label and no buyer sees it. */
export const PACKAGE_DISPLAY_LABELS: Record<string, string> = {
  retail: "Base",
  "ny-retail": "Base",
};

/** Only the entry tier and the flagship get a trial CTA (coxwell, trial feature add-on,
 * horizon-portal-v2051-polish-2026-08-13) -- middle tiers stay paid-only. NY has no middle
 * tier (2 tiers total), so both are trial-eligible (coxwell, leo-ny-feed-trial-option-2026-08-15).
 *
 * LONDON'S TWO ARE GONE, AND THE REASON IS A PRODUCT STATE, NOT A TRIAL POLICY. ld-alpha-85 and
 * ld-ultra were here under that same coxwell ruling until he made both COMING SOON (via marcus,
 * m50788). A coming-soon product cannot be trialled: a trial is access, and it would have been
 * the one path still handing out a product every other surface now says is not on sale.
 *
 * WHAT MOVED WHEN THEY LEFT, measured against prod 2026-09-14 rather than assumed:
 * - The Telegram approve card and the provider panel carry no decision input, so they may only
 *   approve a TRIAL-ELIGIBLE tier (feed-tier-requests.ts approveFeedTierRequest). The four
 *   pending Alpha/Ultra envelopes now refuse there with PaidApprovalNeedsQueueError, whose
 *   message is the admin's instruction to use the queue. They are redirected, not stranded --
 *   the admin queue passes an explicit decision and is untouched.
 * - No client lost access: zero feed_subscriptions rows on either tier, and all six historic
 *   feed_tier_trials rows are already expired or cancelled.
 * - An admin who explicitly picks decision='trial' in the queue USED TO be able to grant one
 *   with no feed_tier_trials row behind it (invisible to the expire-cron and the provider
 *   Trials tab). Closed since marcus m50841: approveOnClient refuses a trial decision that
 *   would write no mirror row (UntrackableTrialError, access-requests.ts). A PAID approval on
 *   a coming-soon tier is still permitted -- coming soon governs the buyer surface, not the
 *   admin's discretion.
 *
 * NOT DERIVED FROM marketplace-catalogue.ts, which is where availability otherwise has its one
 * home: that module imports this one, so reading it back here would be an import cycle. This
 * literal is the copy, and this comment is the pointer -- a tier listed there in any state other
 * than "available" (both are "unavailable" since 2026-09-21) has to be taken out here by hand. */
export const TRIAL_ELIGIBLE_TIER_KEYS: readonly string[] = ["ny-normal", "ny-fast"];

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
