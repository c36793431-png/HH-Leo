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
 * m52589). Three kinds, and none is a second copy of a flow:
 * - link: hands off to the existing portal page that owns the flow (a Base bundle's request on
 *   its tiers page).
 * - request: the shipped TierRequestControl on the product page itself. It submits one
 *   tier_key, so the page 404s unless the listing is backed by exactly one feed_tiers row.
 * - download: the terminal only. The link shows ONLY to an account with an active, unexpired
 *   licence (isPaidUser's predicate, the check /dashboard unlocks Downloads with), alongside that
 *   licence and its feeds (TerminalAccessBox, m53069). Every other account gets
 *   "Request access →" to config.telegramChannelUrl, the /dashboard veil's own upgrade path
 *   (coxwell 2026-09-23 23:48Z via marcus, m53003/m53009 (a)). Nothing records that request:
 *   a tracked software request is the separate (b) job, gated on Fable and coxwell. */
export type MarketplaceAction =
  | { kind: "link"; href: string; label: string }
  | { kind: "request" }
  | { kind: "download"; href: string; label: string };

/** Iris's 60×36 flag-slot art under /public/marketplace/flags (m52632, mapping m52668). A plate
 * is NOT a flag: it fills the same slot for a listing with no country to show, which today is
 * only the terminal, because software has no venue. Her plate-horizon for Black is not shipped:
 * coxwell ruled Black is London (m52813). */
export type ListingMark = "flag-gb" | "flag-us" | "plate-desktop";

/** Alt text for each mark. These are ours, not the aria-labels inside Iris's files, because
 * <img> reads alt. */
export const LISTING_MARK_ALT: Record<ListingMark, string> = {
  "flag-gb": "United Kingdom",
  "flag-us": "United States",
  "plate-desktop": "Desktop software",
};

export function listingMarkSrc(mark: ListingMark): string {
  return `/marketplace/flags/${mark}.svg`;
}

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

/** One "What's included" entry: a line, or a labelled group of lines (the terminal's
 * strategies). */
export type IncludedLine = string | IncludedSection;

/** A labelled group of lines. `layout` is how the product page draws it, and only the terminal
 * sets one (coxwell via marcus, m58579 (a)): "cards" is one card per line, the words before its
 * first " — " as the card's title; "ticks" is a two-column ticked grid. Absent = the nested list.
 * A listing with any laid-out section gets the whole block full width below the Access box.
 * `icon` is a section icon under /public, for Iris's set (m58579 (c)). Absent renders nothing. */
export interface IncludedSection {
  label: string;
  items: string[];
  layout?: "cards" | "ticks";
  icon?: string;
}

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
  // Iris's per-product assets (coxwell via marcus, m52443/m52632). Every slot is OPTIONAL, and
  // an empty one renders nothing: no placeholder, no frame, no "coming soon". Fill them from her
  // delivery only (public/marketplace/, md5s in her MANIFEST), never from the 09-18 mockup,
  // which is layout and not inventory.
  /** Her card crop (1024×640, the shelf) and hero crop (1024×440, the product page), paths
   * under /public, and her description of the picture. */
  image?: { card: string; hero: string; alt: string };
  /** Drawn bottom-left on the image, on the card and the product page. Replaces the flag-icons
   * interim of 246b0a4 (m52632 item 2). */
  mark?: ListingMark;
  /** One line per included item, in render order. ONLY products.json lines marked FACT whose
   * claim is also on a shipped surface (m52632 item 3). Her FACT means "exists on a shipped
   * surface", and several of hers cite her own mockup HTML instead, so each line here names the
   * shipped file it was checked against. No price, latency or uptime line, even a FACT one.
   * The terminal's lines are the exception to the products.json source: they come from FOC12's
   * read of the terminal's own code (m52904), and its comment says so. */
  included?: IncludedLine[];
  /** The product page's Specification plate, "Coverage". Our public wording, NOT the row's
   * feed_tiers.description: that is the provider's own text, which names the upstream vendor's
   * dataset code, and no vendor name or code goes on a public page (marcus m56642 (b)). The row
   * stays unedited because the provider's dashboard renders it. Absent = no plate. */
  coverage?: string;
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
    // with its own request flow on /account/servers.
    //
    // NOT AVAILABLE (coxwell 2026-10-02 20:23Z via marcus, m58539: "not available at the
    // moment", the provider does not offer Black yet). The same state as Alpha and Ultra, so the
    // same shape: no action, and no sentence or included line that points at a way to get it.
    // The blurb's "Access is requested from your Servers page." and the trial/delivery lines are
    // dropped for that reason. The card and its comparison score stay.
    //
    // The same state closes Black's other request paths (same ruling, marcus GO 2026-10-02): the
    // London tiers page's Black card, the Black trial card on /account/servers, and both trial
    // server actions read it through blackAvailability() below. Flipping this line reopens all
    // of them together.
    key: "black",
    title: "Black",
    category: "feeds",
    availability: "unavailable",
    tierKeys: [],
    feedSlug: null,
    blurb: "Horizon's flagship institutional feed, ranked #1 on the Horizon Feed Comparison.",
    action: null,
    scoreTierKey: "black",
    image: {
      card: "/marketplace/black-card.jpg",
      hero: "/marketplace/black-hero.jpg",
      alt: "A black sea with no land; a thin platinum horizon line and a few tall platinum ticks.",
    },
    // coxwell ruled Black is London (2026-09-23 via marcus, m52813), so it carries the GB flag
    // like the three London cards. Iris's plate-horizon was for an unruled region and is dropped.
    mark: "flag-gb",
    // No included list while Not available, as for Alpha and Ultra. Its two lines ("A 3-day
    // trial, once per client — first time only", "Delivered by IP allowlist to a server you
    // register", from black-trial-card.tsx) describe how to get it. Restore them if it returns.
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
    image: {
      card: "/marketplace/ld-base-card.jpg",
      hero: "/marketplace/ld-base-hero.jpg",
      alt: "The London skyline across the Thames at night under a sparse field of cyan ticks rising from the horizon.",
    },
    mark: "flag-gb",
    // Both checked against shipped copy: the request note on this product page's own Access box
    // and the rule on /account/servers (server-registrations-grouped.tsx, "One licence covers one
    // server (one IP)"). Iris's venue line ("Equinix LD4, Slough") and "Tick-level" cite her
    // feeds-page.html mockup and appear nowhere in src, so they stay off.
    included: [
      "Delivery by IP allowlist to a server you register on /account/servers",
      "One licence per server, one IP each — add servers later, each with its own licence",
    ],
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
    image: {
      card: "/marketplace/ld-alpha-card.jpg",
      hero: "/marketplace/ld-alpha-hero.jpg",
      alt: "The London skyline across the Thames at night under a medium-density field of cyan ticks in two heights.",
    },
    mark: "flag-gb",
    // No included list. Iris's one FACT line, "Specifications are published at release",
    // promises a release, and coxwell moved these two from Coming soon to "Not available at this
    // moment" precisely because that is a different promise (m52137).
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
    image: {
      card: "/marketplace/ld-ultra-card.jpg",
      hero: "/marketplace/ld-ultra-hero.jpg",
      alt: "The London skyline across the Thames at night under a dense, full-depth field of fine cyan ticks with faint horizontal price bands.",
    },
    mark: "flag-gb",
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
    image: {
      card: "/marketplace/ny-base-card.jpg",
      hero: "/marketplace/ny-base-hero.jpg",
      alt: "The Manhattan skyline across the Hudson from the New Jersey shore at night under a sparse field of cyan ticks.",
    },
    mark: "flag-us",
    // Same two lines and the same check as London's Base.
    included: [
      "Delivery by IP allowlist to a server you register on /account/servers",
      "One licence per server, one IP each — add servers later, each with its own licence",
    ],
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
    //
    // No delivery protocol in the title or blurb: the public listing does not name cTrader FIX
    // (coxwell via marcus, m55704/m55723). The signed-in request name in feed-tier-catalogue.ts
    // still does, by ruling. It feeds the admin queue, Telegram and the provider's list.
    key: "chicago",
    title: "CME Futures",
    category: "feeds",
    availability: "available",
    tierKeys: ["cme-ctrader-fix"],
    feedSlug: "futures",
    blurb: "US Central (Chicago). CME futures.",
    // Request access lives only on the product page (coxwell's flow via marcus, m52443).
    action: { kind: "request" },
    image: {
      card: "/marketplace/chicago-card.jpg",
      hero: "/marketplace/chicago-hero.jpg",
      alt: "The Chicago skyline across Lake Michigan at night under sparse cyan ticks, with one luminous curve sweeping across them.",
    },
    mark: "flag-us",
    // No included list. Iris's FACT delivery, region and coverage are already on this page, from
    // the blurb and the Specification plate. Her remaining FACT line is a pricing line.
    // The row's description with the vendor dataset code taken out: GLBX.MDP3 is dropped and
    // MBP-1 reads as top-of-book (marcus m56642 (b)). Re-read the row if its coverage changes.
    coverage: "CME futures, 13 symbols, top-of-book, plus XAUGBP and XAUEUR, from US Central (Chicago).",
  },
  {
    key: "horizon-terminal",
    title: "Horizon Terminal",
    category: "software",
    availability: "available",
    tierKeys: [],
    feedSlug: null,
    // Windows only (coxwell 2026-09-23 via marcus, m52817): the terminal has no macOS build.
    blurb: "The Horizon trading terminal for Windows, included with an active licence.",
    // Licensed accounts only; everyone else gets Request access (see MarketplaceAction). It
    // points at the dashboard's Downloads section, where a licensed account has the real build
    // list, the same destination the sidebar uses (sidebar.tsx PORTAL_LINKS).
    action: { kind: "download", href: "/dashboard#downloads", label: "Downloads →" },
    // coxwell's own screenshot of a live client (2026-10-02, via marcus m58359), cropped at native
    // pixels to the card and hero frames, in place of Iris's illustration. A placeholder until the
    // 2.0.7 set.
    image: {
      card: "/marketplace/horizon-terminal-client-card.jpg",
      hero: "/marketplace/horizon-terminal-client-hero.jpg",
      alt: "The Horizon terminal on XAUUSD with the fast feed and the broker connected: strategy panel, datafeed analysis, an active signal and the price chart.",
    },
    // A plate, not a flag: software is not delivered from a region (coxwell via marcus, m52589).
    mark: "plate-desktop",
    // From FOC12's read of the terminal's code at horizon-src 5b28079 (m52902), as marcus picked
    // the lines (m52904). Iris's products.json lines are not used here: they cite her mockup.
    // - Names are the app's own (the strategy dropdown, NewUI.cs:307), not the website's: "1 Leg",
    //   not "1 Leg Lock"; "Order Block Imbalance", not "Order Book".
    // - No NinjaTrader: the code has no reference to it.
    // - Emergency Close is per instance, since ForceCloseAllTrades closes one tab.
    // - Set files are load and save only. They hold broker passwords in plaintext today, so
    //   nothing here says share or export.
    // - Left out: stealth/identity rotation, the offline licence grace, and every line with a
    //   figure in it. No performance words.
    // - Brokers and feeds read "connects to", because the terminal does not include a feed
    //   licence or a broker account.
    // Laid out as five strategy cards and a features grid (coxwell via marcus, m58579 (a)). The
    // lines are the same words: only the "Features" label is new, and it carries no claim.
    included: [
      {
        label: "Strategies",
        layout: "cards",
        items: [
          "1 Leg — one market order when the gap between the Horizon feed and your broker's price reaches your setting, with a virtual stop-loss, take-profit and trailing stop",
          "2 Leg Lock — on the same gap, a hedged pair with a pending lock leg; the losing leg is released and the other is trailed",
          "Trend Impulse — trades in the direction of a move in the Horizon feed that reaches your size within your time window, with an EMA trend filter",
          "Order Block Imbalance — trades a gap on one side only, and checks order-book imbalance when book depth is available (cTrader FIX)",
          "Grid Arbitrage — opens a basket on the gap, adds levels at your step and multiplier up to your maximum, and closes the basket at its own take-profit or stop-loss",
        ],
      },
      {
        label: "Features",
        layout: "ticks",
        items: [
          "Connects to brokers: MT5, MT4, Rithmic (CME futures) and BloFin (crypto)",
          "Connects to feeds: Horizon London, New York and Chicago, cTrader FIX (with book depth) and Binance",
          "Multi-instance: several accounts or symbols in one window, one per tab",
          "Emergency Close per instance: closes everything on that tab",
          "Set files: load and save your settings as profiles (.ini)",
          "Tick recorder (CSV)",
          "Auto-offset calibration",
          "Automatic reconnect when a feed stalls",
          "Lot sizing by risk %",
          "Telegram alerts",
          "Windows only — no .NET install needed",
        ],
      },
    ],
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

/** Black's declared availability, read from its listing above. Black has no feed_tiers row, so
 * tierAvailability() never sees it; this is what its own request paths (the tiers-page card,
 * the /account/servers trial card, requestBlackTrialAction and requestBlackTrialConvertAction)
 * ask instead. FAILS CLOSED: a missing listing reads as "unavailable", not as on sale. */
export function blackAvailability(): MarketplaceAvailability {
  return listingByKey("black")?.availability ?? "unavailable";
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
