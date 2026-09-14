import { FEED_REGION_LABELS, PACKAGE_DISPLAY_LABELS, PACKAGE_TIER_KEYS } from "./feed-tier-catalogue";

/**
 * /marketplace — the catalogue of what Horizon sells: one listing per product, each with a
 * category and an availability state (coxwell 2026-09-14 via marcus, m50709/m50711/m50717/m50723).
 *
 * WHY THE STATE LIVES IN CODE, AND WHY THAT IS NOT LAZINESS. Availability and category are
 * presentation metadata and they belong in the database; this file moves into it in a second
 * pass once `0088_tighten` lands. It is here BECAUSE A MIGRATION CANNOT BE DRY-RUN TODAY —
 * preview deploys share the production database, so there is no non-prod database to rehearse
 * one against, which is why `0088_tighten` is frozen and reviewed migrations are queued behind
 * it. Until that changes, a state change has to be a one-line edit and a deploy, never a
 * migration. A reader who does not know that will read this file as a shortcut and move it at
 * the wrong moment (marcus, m50717).
 *
 * THIS FILE IS THE ONLY SOURCE OF A LISTING'S AVAILABILITY. /feeds reads it too — see
 * feeds-catalogue.ts computeFeedCardStatus — so the two surfaces cannot disagree about whether
 * a product is live. The disagreement, not the state, is the defect (marcus, m50717 #5).
 *
 * DELIBERATELY NOT HERE:
 * - PRICES. No buyer surface Horizon ships renders a feed price: /feeds, /feeds/[region]/tiers
 *   and /dashboard render none, and price_cents reaches only the provider and admin panels.
 *   Publishing one would be the first feed price Horizon has ever shown a customer — a
 *   commercial first, not a layout choice (marcus ruling, m50723 #1). Whether to publish prices
 *   is coxwell's, and additive. Do not add a price field here to "finish" the card.
 * - TOKYO (`crypto`), a declared FEED_REGION with a live /feeds card. coxwell has never ruled on
 *   it and neither has marcus; absence is not a claim about a product, "maintenance" would be
 *   (marcus, m50723). It joins this list when he rules, not before.
 */
export type MarketplaceAvailability = "available" | "coming-soon" | "maintenance";

/** Exactly the two coxwell named. A third category is a product decision, so a third word here
 * must not compile until he makes it. */
export type MarketplaceCategory = "feeds" | "software";

export const MARKETPLACE_CATEGORY_LABELS: Record<MarketplaceCategory, string> = {
  feeds: "Feeds",
  software: "Software",
};

/** Render order of the category sections. */
export const MARKETPLACE_CATEGORY_ORDER: MarketplaceCategory[] = ["feeds", "software"];

export const MARKETPLACE_AVAILABILITY_LABELS: Record<MarketplaceAvailability, string> = {
  available: "Available",
  "coming-soon": "Coming soon",
  maintenance: "Maintenance",
};

export interface MarketplaceListing {
  /** Stable render key. Deliberately not a tier_key — several listings have no feed_tiers row. */
  key: string;
  title: string;
  category: MarketplaceCategory;
  availability: MarketplaceAvailability;
  /** feed_tiers.tier_key(s) this listing covers, in render order. EMPTY = a declared listing
   * with no feed_tiers row (Black, Chicago, the terminal): it renders from this file alone and
   * cannot vanish when someone refactors a query (marcus, m50711 trap 2). */
  tierKeys: string[];
  /** Only set when this listing IS an entire /feeds card, so its state can speak for that card.
   * London and NY are null: one /feeds card covers several listings at once (Base is available
   * while Alpha and Ultra are not), so no single state could speak for it. */
  feedSlug: string | null;
  blurb: string;
  /** Existing portal path this listing's CTA links to, never a second copy of a request flow.
   * null on every non-available listing: coxwell's words are "can be listed not requested", so
   * the action is ABSENT, not present-and-disabled. */
  ctaHref: string | null;
  ctaLabel: string | null;
}

/**
 * Order is render order within a category. Rulings: packaging MIRRORS the tiers page (two
 * bundles, not five tiers — a marketplace selling five things where the tiers page sells two
 * bundles is a pricing misrepresentation, marcus m50717 #1); Black is INCLUDED as a declared
 * entry because the catalogue's whole point is completeness and it is the flagship (m50717 #6);
 * Chicago is a declared MAINTENANCE listing and /feeds moves with it (m50717 #5).
 */
export const MARKETPLACE_LISTINGS: MarketplaceListing[] = [
  {
    // Not in feed_tiers at all — a separate paid-only, one-per-client gate (black-trials.ts)
    // with its own request flow on /account/servers. The CTA hands off to that page rather
    // than duplicating a gated request flow, exactly as the tiers page's Black card does.
    key: "black",
    title: "Black",
    category: "feeds",
    availability: "available",
    tierKeys: [],
    feedSlug: null,
    blurb: "Horizon's flagship institutional feed, ranked #1 on the Horizon Feed Comparison. Access is requested from your Servers page.",
    ctaHref: "/account/servers",
    ctaLabel: "Request access →",
  },
  {
    // Membership is read from PACKAGE_TIER_KEYS, not re-listed, so this cannot drift from the
    // expansion the request path itself uses. Title composes the two labels the buyer already
    // sees — region as context, not a rename (marcus ruling, m50723 #4): the tiers page calls
    // BOTH London's and NY's bundle "Base", which is fine inside a region and ambiguous in a
    // catalogue that lists them side by side.
    key: "ld-base",
    title: `${FEED_REGION_LABELS.london} · ${PACKAGE_DISPLAY_LABELS.retail}`,
    category: "feeds",
    availability: "available",
    tierKeys: PACKAGE_TIER_KEYS["ld-retail-package"],
    feedSlug: null,
    blurb: "London · LD4 co-lo. Three feeds from one provider, sold as a single bundle.",
    ctaHref: "/feeds/london/tiers",
    ctaLabel: "See tiers →",
  },
  {
    key: "ny-base",
    title: `${FEED_REGION_LABELS.ny} · ${PACKAGE_DISPLAY_LABELS["ny-retail"]}`,
    category: "feeds",
    availability: "available",
    tierKeys: PACKAGE_TIER_KEYS["ny-retail-package"],
    feedSlug: null,
    blurb: "New York · NY4 co-lo. Two feeds from one provider, sold as a single bundle.",
    ctaHref: "/feeds/ny/tiers",
    ctaLabel: "See tiers →",
  },
  {
    // Declared, not queried: there are zero Chicago rows in feed_tiers and `cme` is a region
    // key with no tiers. The product itself is real and already ships on /feeds as
    // FEED_CATALOGUE's `futures` entry — so this listing states its state, it does not invent
    // the product. feedSlug wires the /feeds card to this state so the two cannot disagree.
    key: "chicago",
    title: "Chicago",
    category: "feeds",
    availability: "maintenance",
    tierKeys: [],
    feedSlug: "futures",
    blurb: "Chicago · CH1 co-lo. CME Group futures, indices, metals and energy. Temporarily unavailable.",
    ctaHref: null,
    ctaLabel: null,
  },
  {
    key: "horizon-terminal",
    title: "Horizon Terminal",
    category: "software",
    availability: "available",
    tierKeys: [],
    feedSlug: null,
    blurb: "The Horizon trading terminal for Windows and macOS, included with an active licence.",
    // /downloads redirects a non-paid account to /dashboard, and this page is visible to free
    // accounts — so the CTA points at the dashboard's Downloads section, which is the exact
    // destination the sidebar already sends a locked account to (sidebar.tsx PORTAL_LINKS,
    // "/dashboard#downloads"). Paid accounts get the real build list in that same section.
    ctaHref: "/dashboard#downloads",
    ctaLabel: "Downloads →",
  },
];

/**
 * HELD FROM RENDER — declared here so nobody rebuilds them, NOT rendered by /marketplace.
 *
 * Both are real feed_tiers rows that coxwell/marcus have stated as COMING SOON (m50711 table),
 * and a coming-soon listing renders with no request action. The block is marcus's merge gate
 * (m50723), as a predicate rather than a date: DO NOT ship a listing as coming-soon while
 * another surface still offers it. Today three surfaces do — /feeds/london/tiers renders each
 * of these as a card with a live TierRequestControl, /dashboard counts them inside London's
 * "5 TIERS" badge and deep-links there, and both are trial-eligible. "Losing one card beats
 * publishing three surfaces that disagree" (marcus).
 *
 * WHAT UNBLOCKS EACH:
 * - Alpha: coxwell's answer on whether the live "Request access" CTA comes off
 *   /feeds/london/tiers. marcus put it to him 2026-09-14 with the deciding fact that Alpha has
 *   a NULL price_cents and no provider_user_id, so it cannot be sold today even by someone who
 *   clicks. When he answers, this entry moves into MARKETPLACE_LISTINGS.
 * - Ultra: the identical shape, and marcus has NOT ruled on it by name — it is a feed_tiers row
 *   rendered on /feeds/london/tiers with a live request control, trial-eligible, NULL price and
 *   no provider, counted in the same badge. His ruling names Alpha, but its reason is the
 *   contradiction, not the name. Flagged to him in the build reply; do not promote this one on
 *   the Alpha answer alone.
 *
 * Their blurbs below are place-holding region context only — neither has ever had buyer-facing
 * catalogue copy, and writing some would be inventing product claims. Whoever promotes these
 * needs coxwell's wording, not this line.
 */
export const MARKETPLACE_LISTINGS_HELD: MarketplaceListing[] = [
  {
    key: "ld-alpha",
    title: `${FEED_REGION_LABELS.london} · Alpha`,
    category: "feeds",
    availability: "coming-soon",
    tierKeys: ["ld-alpha-85"],
    feedSlug: null,
    blurb: "London · LD4 co-lo.",
    ctaHref: null,
    ctaLabel: null,
  },
  {
    key: "ld-ultra",
    title: `${FEED_REGION_LABELS.london} · Ultra`,
    category: "feeds",
    availability: "coming-soon",
    tierKeys: ["ld-ultra"],
    feedSlug: null,
    blurb: "London · LD4 co-lo.",
    ctaHref: null,
    ctaLabel: null,
  },
];

/**
 * Availability of the /feeds card for a feeds-catalogue slug, or null when no listing speaks
 * for that whole card. Read by computeFeedCardStatus so a product's state has ONE home: the
 * defect marcus ruled against is the marketplace saying "maintenance" while /feeds still shows
 * the same product live, and two literals in two files is how that happens (m50717 #5).
 */
export function feedCardAvailability(slug: string): MarketplaceAvailability | null {
  return MARKETPLACE_LISTINGS.find((listing) => listing.feedSlug === slug)?.availability ?? null;
}
