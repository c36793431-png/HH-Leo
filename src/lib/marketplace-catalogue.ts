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
 * - PRICES. No buyer surface Horizon ships renders a feed price: /feeds, /feeds/[region]/tiers,
 *   /marketplace, its product pages and /dashboard render none, and price_cents reaches only the
 *   provider and admin panels (marcus ruling, m50723 #1). coxwell restated it on 2026-09-16:
 *   "prices are discussed in telegram". marcus applied it to Chicago on 2026-09-23 (m52454 (a)),
 *   whose row carries 5000 for approval and revenue only. Do not add a price field or a price
 *   slot here to "finish" a card or a product page.
 * - TOKYO (`crypto`), a declared FEED_REGION with a live /feeds card. coxwell has never ruled on
 *   it and neither has marcus; absence is not a claim about a product, "maintenance" would be
 *   (marcus, m50723). It joins this list when he rules, not before.
 */
export type MarketplaceAvailability = "available" | "coming-soon" | "unavailable" | "maintenance";

/** Product pages live at <base>/<listing key>. */
const MARKETPLACE_DETAIL_BASE = "/marketplace";

/** What a listing's product page offers. The shelf card never renders it: every card's one
 * control is "See more →", bottom-right, into the product page (coxwell 2026-09-23 via marcus,
 * m52589). Two kinds, and neither is a second copy of a flow:
 * - link: hands off to the existing portal page that owns the flow (Black's gate on
 *   /account/servers, a Base bundle's request on its tiers page, the terminal's Downloads).
 * - request: the shipped TierRequestControl on the product page itself. It submits one
 *   tier_key, so the page 404s unless the listing is backed by exactly one feed_tiers row. */
export type MarketplaceAction = { kind: "link"; href: string; label: string } | { kind: "request" };

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
   * with no feed_tiers row (Black, the terminal): it renders from this file alone and
   * cannot vanish when someone refactors a query (marcus, m50711 trap 2). */
  tierKeys: string[];
  /** Only set when this listing IS an entire /feeds card, so its state can speak for that card.
   * London and NY are null: one /feeds card covers several listings at once (Base is available
   * while Alpha and Ultra are not), so no single state could speak for it. */
  feedSlug: string | null;
  blurb: string;
  /** The product page's action. null on every non-available listing: coxwell's words are "can be
   * listed not requested", so the action is ABSENT, not present-and-disabled. The product page
   * also drops it for any listing that is not "available", so a wrong entry here fails closed. */
  action: MarketplaceAction | null;
  /** A DECLARED listing's own Horizon Feed Comparison entry, as the tier_key scoreForTierKey
   * reads (feed-comparison-scores.ts). Black only: it has no feed_tiers row to carry its score,
   * and the London cards read theirs from that same table by tier_key. Absent = no score. */
  scoreTierKey?: string;
  /** ISO 3166-1 alpha-2 codes, rendered by the flag-icons set the portal already loads
   * (`fi fi-<code>`, as on /feeds) on the shelf card and the product page. Iris's art replaces
   * these later (coxwell via marcus, m52589); software carries none. */
  flagCountryCodes?: string[];
  // Product-page slots for Iris's per-product assets (coxwell via marcus, m52443/m52454: an
  // image and "What's included" for every product). They are OPTIONAL and EMPTY until her
  // assets land. An empty slot renders nothing: no placeholder, no frame, no "coming soon".
  // Fill them from her delivery only, never from the 09-18 mockup, which is layout and not
  // inventory.
  /** Path under /public to the product image. */
  image?: string;
  /** One line per included item, in render order. */
  included?: string[];
}

/**
 * Order is render order within a category. Rulings: packaging MIRRORS the tiers page (two
 * bundles, not five tiers — a marketplace selling five things where the tiers page sells two
 * bundles is a pricing misrepresentation, marcus m50717 #1); Black is INCLUDED as a declared
 * entry because the catalogue's whole point is completeness and it is the flagship (m50717 #6);
 * Chicago's state moves /feeds with it (m50717 #5).
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
    action: { kind: "link", href: "/account/servers", label: "Request access →" },
    scoreTierKey: "black",
    // London: Black is the London tiers page's flagship card (BLACK_TIER, regionKey "london").
    flagCountryCodes: ["GB"],
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
    // A link and not an embedded control: the bundle's request derives its state from every
    // member (packageCardState on the tiers page, including the "mixed" branch), and a second
    // copy of that rule here would be a second place for it to drift.
    action: { kind: "link", href: "/feeds/london/tiers", label: "See tiers →" },
    flagCountryCodes: ["GB"],
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
    action: null,
    flagCountryCodes: ["GB"],
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
    action: null,
    flagCountryCodes: ["GB"],
  },
  {
    key: "ny-base",
    title: `${FEED_REGION_LABELS.ny} · ${PACKAGE_DISPLAY_LABELS["ny-retail"]}`,
    category: "feeds",
    availability: "available",
    tierKeys: PACKAGE_TIER_KEYS["ny-retail-package"],
    feedSlug: null,
    blurb: "New York · NY4 co-lo. Two feeds from one provider, sold as a single bundle.",
    // A link for the same reason as London's Base above.
    action: { kind: "link", href: "/feeds/ny/tiers", label: "See tiers →" },
    flagCountryCodes: ["US"],
  },
  {
    // The Pip Dealer's CME feed over cTrader FIX, requestable (coxwell 2026-09-23 via marcus,
    // m52432: "clients can request it once they click on the product"). It was a declared
    // MAINTENANCE listing with no feed_tiers row. It is now backed by `cme-ctrader-fix`,
    // because a request and a grant can only key on a feed_tiers row. The row is
    // 6760e796, written and read back by marcus at 22:07Z from provider_tiers dff16179, the live
    // source (m52454). REQUEST, not buy: coxwell ruled there is no checkout. Fulfilment is the
    // admin queue and a manual allowlist.
    //
    // The blurb holds only what marcus read off the live row. The old "CH1 co-lo" and
    // "indices, metals and energy" are gone because neither is in that read. The spec detail
    // lives in feed_tiers.description, which the product page renders. It is not copied here.
    // feedSlug still wires the /feeds CME card to this state.
    key: "chicago",
    title: "CME Futures · cTrader FIX",
    category: "feeds",
    availability: "available",
    tierKeys: ["cme-ctrader-fix"],
    feedSlug: "futures",
    blurb: "US Central (Chicago). CME futures delivered over cTrader FIX.",
    // Request access lives only on the product page (coxwell's flow via marcus, m52443).
    action: { kind: "request" },
    flagCountryCodes: ["US"],
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
    // No flag: software is not delivered from a region (coxwell via marcus, m52589).
    action: { kind: "link", href: "/dashboard#downloads", label: "Downloads →" },
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

/** The product page of a listing. Every listing has one, Not available ones included
 * (coxwell via marcus, m52589). Single spelling of the route so the card's title, its See more
 * and the /feeds hand-off cannot point at three different places. */
export function listingDetailHref(listing: MarketplaceListing): string {
  return `${MARKETPLACE_DETAIL_BASE}/${listing.key}`;
}

/** A listing by its route key. null means a 404. */
export function listingByKey(key: string): MarketplaceListing | null {
  return MARKETPLACE_LISTINGS.find((listing) => listing.key === key) ?? null;
}

/** The blurb of the listing that speaks for a whole /feeds card, or null. /feeds uses it in
 * place of its own copy for that card. Both surfaces describe the same product, so they read
 * one sentence and not two that can drift. */
export function feedCardBlurb(slug: string): string | null {
  return MARKETPLACE_LISTINGS.find((listing) => listing.feedSlug === slug)?.blurb ?? null;
}

/** The product page behind a /feeds card, for a card whose listing has one. This is how the
 * /feeds CME card sends a buyer to the one request flow, not to Telegram. */
export function feedCardDetailHref(slug: string): string | null {
  const listing = MARKETPLACE_LISTINGS.find((l) => l.feedSlug === slug);
  return listing ? listingDetailHref(listing) : null;
}
