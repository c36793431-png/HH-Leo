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
 * feeds-catalogue.ts computeFeedCardStatus — and so does /feeds/[region]/tiers, which asks
 * tierAvailability() below whether a tier card may carry a request control. The three surfaces
 * cannot disagree about whether a product is live. The disagreement, not the state, is the
 * defect (marcus, m50717 #5, m50788).
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
export type MarketplaceAvailability = "available" | "coming-soon" | "unavailable" | "maintenance";

/** Exactly the two coxwell named. A third category is a product decision, so a third word here
 * must not compile until he makes it. */
export type MarketplaceCategory = "feeds" | "software";

export const MARKETPLACE_CATEGORY_LABELS: Record<MarketplaceCategory, string> = {
  feeds: "Feeds",
  software: "Software",
};

/** Render order of the category sections — and of the filter chips, which /marketplace derives
 * from the rendered sections, so this is the only place the order lives. Software first:
 * coxwell 2026-09-21 via marcus, "Horizon software would be above feeds also". */
export const MARKETPLACE_CATEGORY_ORDER: MarketplaceCategory[] = ["software", "feeds"];

/** "coming-soon" has no listing today and is kept on purpose: it is a state Horizon will want,
 * and its label must stay true to its name. "unavailable" is coxwell's own string, shipped as he
 * typed it (2026-09-21 via marcus, m52137) — not a paraphrase. */
export const MARKETPLACE_AVAILABILITY_LABELS: Record<MarketplaceAvailability, string> = {
  available: "Available",
  "coming-soon": "Coming soon",
  unavailable: "Not available at this moment",
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
    // NOT AVAILABLE, and therefore NOT REQUESTABLE ANYWHERE. First ruled coming-soon (coxwell
    // "Alpha Coming Soon" via marcus, m50788, read with his morning "listed not requested");
    // restated 2026-09-21 as "Not available at this moment" (via marcus, m52137), which is a
    // different promise to a buyer, so it is a different state rather than a relabel of
    // coming-soon. Promoted out of the old
    // MARKETPLACE_LISTINGS_HELD block once that predicate could be met: the tiers page reads
    // tierAvailability() below and renders these two without a request control, the trial path
    // is closed in feed-tier-catalogue.ts, and the submit action refuses the key. Both rows
    // also carry a NULL price_cents and a NULL provider_user_id in feed_tiers, so neither could
    // be sold today even by someone who clicked.
    //
    // BLURB IS DELIBERATELY BARE, and this is not an oversight. coxwell ruled the STATE, not
    // the copy, and neither tier has ever had buyer-facing catalogue copy. feed_tiers.description
    // holds a real buyer-facing paragraph for each (rendered on the tiers page), but copying it
    // here would be a denormalised duplicate of a DB column with no writer to re-sync it — the
    // card would keep the old claim the day someone edits the row. The comparison score beneath
    // the title is the substance of this card; product copy is coxwell's to supply.
    key: "ld-alpha",
    title: `${FEED_REGION_LABELS.london} · Alpha`,
    category: "feeds",
    availability: "unavailable",
    tierKeys: ["ld-alpha-85"],
    feedSlug: null,
    blurb: "London · LD4 co-lo.",
    ctaHref: null,
    ctaLabel: null,
  },
  {
    // Same shape and same ruling as Alpha above. marcus's instruction names Alpha, but its
    // reason is the contradiction rather than the name, and he ruled both by name in m50788.
    key: "ld-ultra",
    title: `${FEED_REGION_LABELS.london} · Ultra`,
    category: "feeds",
    availability: "unavailable",
    tierKeys: ["ld-ultra"],
    feedSlug: null,
    blurb: "London · LD4 co-lo.",
    ctaHref: null,
    ctaLabel: null,
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
 * MARKETPLACE_LISTINGS_HELD IS GONE, and the predicate that held it is the thing to keep.
 *
 * Alpha and Ultra used to live in a second array that /marketplace did not render, because
 * marcus's merge gate (m50723) was a predicate, not a date: DO NOT ship a listing as
 * coming-soon while another surface still offers it. Three surfaces did — the tiers page
 * rendered a live TierRequestControl on each, both were trial-eligible, and /dashboard counted
 * them in London's badge. coxwell resolved it the other way round (m50788): make the surfaces
 * agree by removing requestability, not by hiding the product. The predicate still governs —
 * anything added here in any state other than "available" must already be unrequestable
 * everywhere first.
 */

/**
 * The declared availability of one feed_tiers.tier_key, or null when no listing covers it.
 *
 * Read by /feeds/[region]/tiers so a tier card cannot offer a control for a product this file
 * says is not on sale. NULL MEANS "NOT DECLARED HERE", NOT "BLOCKED": a tier_key with no
 * listing leaves that page's behaviour exactly as it was, so adding a feed_tiers row cannot
 * silently make it unrequestable by omission. Same shape as feedCardAvailability below, keyed
 * by tier instead of by /feeds slug.
 */
export function tierAvailability(tierKey: string): MarketplaceAvailability | null {
  return MARKETPLACE_LISTINGS.find((listing) => listing.tierKeys.includes(tierKey))?.availability ?? null;
}

/**
 * Availability of the /feeds card for a feeds-catalogue slug, or null when no listing speaks
 * for that whole card. Read by computeFeedCardStatus so a product's state has ONE home: the
 * defect marcus ruled against is the marketplace saying "maintenance" while /feeds still shows
 * the same product live, and two literals in two files is how that happens (m50717 #5).
 */
export function feedCardAvailability(slug: string): MarketplaceAvailability | null {
  return MARKETPLACE_LISTINGS.find((listing) => listing.feedSlug === slug)?.availability ?? null;
}
