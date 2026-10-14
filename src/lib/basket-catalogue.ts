import { FEED_REGION_LABELS, feedTierMeta } from "./feed-tier-catalogue";
import { MAIN_SITE_URL } from "./main-site";
import { MARKETPLACE_LISTINGS, listingByKey, listingDetailHref, tierAvailability, type ListingMark } from "./marketplace-catalogue";
import { STRATEGY_DISPLAY_META } from "./strategy-catalogue";
import type { StrategyKey } from "./setfiles";
import { BUNDLES, BUNDLE_CARD_ART, bundleByKey, isBundleFeedChoice, type BundleDefinition, type BundleFeedChoice } from "./bundle-catalogue";

/**
 * What the request basket can carry, and the one validator for a submitted basket (coxwell
 * 2026-10-03 via marcus m59124/m59146). Server-side: strategy-catalogue reaches the DB module
 * through licenses.ts, so client components get these entries as props, never by import.
 *
 * - software and feeds: the marketplace listings that are "available", and for a feed every
 *   member tier too (the feed submit action's member rule). Black, Alpha and Ultra are
 *   therefore refused here, even when a POST skips the button.
 * - strategies: BASKET_STRATEGY_ENTRIES below, DATA, so that coxwell's pending "Base Strategy
 *   package, 4 in 1" (marcus m59173) is one entry with four strategy keys, or a package plus a
 *   single, with no change anywhere else. Names are strategy-catalogue.ts's meta.name.
 */

export type BasketLineKind = "software" | "strategy" | "feed" | "bundle";

export const BASKET_MAX_LINES = 20;
export const BASKET_MAX_SERVERS = 20;
export const BASKET_STRATEGY_NOTE = "Included with a Horizon licence";

/** One strategy product in the basket. Today each is one strategy; a package lists several. */
interface BasketStrategyEntry {
  key: string;
  strategyKeys: StrategyKey[];
  /** Overrides meta.name, for a package. Absent = the one strategy's meta.name. */
  name?: string;
  /** The card's own image, 1x + 2x files under /public. Absent = the shared "Strategy" plate. */
  image?: StrategyCardImage;
}

/** Iris's schematics (marcus m59622, coxwell approved m59658): 316x120 masters, every mark in the
 * central 222px, so object-fit: cover at the 222px 4-up slot crops only background. */
export interface StrategyCardImage {
  src: string;
  src2x: string;
}
const strategyImage = (file: string): StrategyCardImage => ({
  src: `/marketplace/strategies/${file}.png`,
  src2x: `/marketplace/strategies/${file}@2x.png`,
});

export const BASKET_STRATEGY_ENTRIES: BasketStrategyEntry[] = [
  { key: "1leg", strategyKeys: ["1leg"], image: strategyImage("1-leg") },
  { key: "2leg_lock", strategyKeys: ["2leg_lock"], image: strategyImage("2-leg-lock") },
  { key: "trend_impulse", strategyKeys: ["trend_impulse"], image: strategyImage("trend-impulse") },
  { key: "obi", strategyKeys: ["obi"], image: strategyImage("obi") },
  { key: "grid", strategyKeys: ["grid"], image: strategyImage("grid-arbitrage") },
];

/** The marketplace card's diagram for one strategy, from the entry that is that strategy alone, so
 * the Academy lesson shows the same picture as the card (coxwell via marcus, m62840). Null when no
 * single-strategy entry carries an image. */
export function strategyCardImage(key: StrategyKey): StrategyCardImage | null {
  return BASKET_STRATEGY_ENTRIES.find((e) => e.strategyKeys.length === 1 && e.strategyKeys[0] === key)?.image ?? null;
}

/** The main site's /software strategy cards link to /marketplace?strategy=<slug> (marcus m59280).
 * Its slugs, as www spells them, to the portal's strategy keys. */
const STRATEGY_PUBLIC_SLUGS = new Map<string, StrategyKey>([
  ["1-leg", "1leg"],
  ["2-leg-lock", "2leg_lock"],
  ["trend-impulse", "trend_impulse"],
  ["order-book-imbalance", "obi"],
  ["grid-arbitrage", "grid"],
]);

/** The basket strategy entry a www slug lands on: the entry that carries that strategy, so a
 * package entry takes over its strategies' links with no change here. Null for an unknown slug. */
export function strategyEntryKeyForSlug(slug: string | undefined): string | null {
  const strategyKey = slug ? STRATEGY_PUBLIC_SLUGS.get(slug) : undefined;
  if (!strategyKey) return null;
  return BASKET_STRATEGY_ENTRIES.find((e) => e.strategyKeys.includes(strategyKey))?.key ?? null;
}

/** The www page that explains a strategy entry (marcus m59621): one strategy -> its own
 * /strategies/<slug>, from the slug map above; a package, or a key with no slug -> the list. */
function strategyAboutHref(e: BasketStrategyEntry): string {
  const only = e.strategyKeys.length === 1 ? e.strategyKeys[0] : null;
  const slug = only ? [...STRATEGY_PUBLIC_SLUGS].find(([, k]) => k === only)?.[0] : undefined;
  return slug ? `${MAIN_SITE_URL}/strategies/${slug}` : `${MAIN_SITE_URL}/strategies`;
}

/** A basket-able product as the shelf, the product page and the basket render it. Plain data. */
export interface BasketEntry {
  kind: BasketLineKind;
  key: string;
  name: string;
  /** Short facts shown as chips on the basket line: region and tier for a feed, the type for a
   * strategy. */
  chips: string[];
  /** One sentence for the strategy card. */
  blurb?: string;
  /** The listing's card image and flag, for the line thumbnail. */
  image?: string;
  /** A strategy card's own image, 1x + 2x, on the /marketplace card only. Not image: a strategy
   * basket line keeps the plain plate (marcus m59724, option b). */
  cardImage?: string;
  cardImage2x?: string;
  mark?: ListingMark;
  detailHref?: string;
  /** A strategy's "See more" target on www. Not detailHref: that one also links the basket line. */
  aboutHref?: string;
  /** A bundle's feed choices, titled from their listings (Fable S2 C2), so client components get the names as
   * props and never import a catalogue (C1). `available` = the listing passes the same test a feed line does. */
  feedChoices?: BundleFeedChoiceEntry[];
}

export interface BundleFeedChoiceEntry {
  key: BundleFeedChoice;
  title: string;
  available: boolean;
}

/** A strategy's type, as its meta.name spells it after the dash ("1 LEG — Latency Arbitrage" ->
 * "Latency Arbitrage"), for the line's chip (Iris r2 sheet 2, marcus m59367 d2). Null when the
 * name has no dash part. */
function strategyType(key: StrategyKey): string | null {
  return STRATEGY_DISPLAY_META[key].name.split(" — ")[1] ?? null;
}

function strategyEntry(e: BasketStrategyEntry): BasketEntry {
  const first = STRATEGY_DISPLAY_META[e.strategyKeys[0]];
  // A package names several strategies, so it gets no single type chip.
  const type = e.strategyKeys.length === 1 ? strategyType(e.strategyKeys[0]) : null;
  return {
    kind: "strategy",
    key: e.key,
    name: e.name ?? first.name,
    chips: type ? [`Strategy ${type}`] : [],
    blurb: e.strategyKeys.length === 1 ? first.hook : e.strategyKeys.map((k) => STRATEGY_DISPLAY_META[k].name).join(" · "),
    cardImage: e.image?.src,
    cardImage2x: e.image?.src2x,
    aboutHref: strategyAboutHref(e),
  };
}

function listingEntry(kind: "software" | "feed", key: string): BasketEntry | null {
  const listing = listingByKey(key);
  if (!listing) return null;
  if (listing.category !== (kind === "feed" ? "feeds" : "software")) return null;
  if (listing.availability !== "available") return null;
  const blockedMember = listing.tierKeys.some((t) => {
    const declared = tierAvailability(t);
    return declared != null && declared !== "available";
  });
  if (blockedMember) return null;
  const chips: string[] = [];
  if (kind === "feed") {
    const region = listing.tierKeys.map((t) => feedTierMeta(t)?.region).find(Boolean);
    if (region) chips.push(`Region ${FEED_REGION_LABELS[region]}`);
    // "London · Base" -> Base. CME's title has no tier part, so it gets the region chip only.
    const tier = listing.title.split(" · ")[1];
    if (tier) chips.push(`Tier ${tier}`);
  } else {
    chips.push("Licence for you");
  }
  return {
    kind,
    key,
    name: listing.title,
    chips,
    image: listing.image?.card,
    mark: listing.mark,
    detailHref: listingDetailHref(listing),
  };
}

/** A bundle's product page, a sibling of the listings' (/marketplace/<key>). */
export function bundleDetailHref(bundle: BundleDefinition): string {
  return `/marketplace/${bundle.key}`;
}

/** A bundle's feed choices, each titled and tested by the SAME rule as a feed line (listingEntry), so the bundle
 * can never offer a feed the basket would refuse on its own. */
export function bundleFeedChoiceEntries(bundle: BundleDefinition): BundleFeedChoiceEntry[] {
  return bundle.feedChoices.map((key) => {
    const feed = listingEntry("feed", key);
    return { key, title: feed?.name ?? listingByKey(key)?.title ?? key, available: feed != null };
  });
}

/** A bundle's entry, or null when none of its feeds can be requested (then there is nothing to pick). NO price
 * field: the portal shows clients no price (marcus m68882). The line thumb is the shelf card's 640 art (marcus
 * m68882 D, replacing the plain plate of M4). */
function bundleEntry(bundle: BundleDefinition): BasketEntry | null {
  const feedChoices = bundleFeedChoiceEntries(bundle);
  if (!feedChoices.some((c) => c.available)) return null;
  return {
    kind: "bundle",
    key: bundle.key,
    name: bundle.title,
    chips: [],
    blurb: bundle.blurb,
    image: BUNDLE_CARD_ART[bundle.key].src640,
    detailHref: bundleDetailHref(bundle),
    feedChoices,
  };
}

/** The entry for one line, or null when the basket can't carry it (unknown key, wrong kind, not
 * available). */
export function basketEntry(kind: BasketLineKind, key: string): BasketEntry | null {
  if (kind === "strategy") {
    const e = BASKET_STRATEGY_ENTRIES.find((s) => s.key === key);
    return e ? strategyEntry(e) : null;
  }
  if (kind === "bundle") {
    const b = bundleByKey(key);
    return b ? bundleEntry(b) : null;
  }
  return listingEntry(kind, key);
}

/** Every product the basket can carry today, in shelf order: bundles (first, Q-L m66848), software, feeds,
 * strategies. */
export function basketCatalogue(): BasketEntry[] {
  const listed = MARKETPLACE_LISTINGS.flatMap((l) => {
    const e = listingEntry(l.category === "feeds" ? "feed" : "software", l.key);
    return e ? [e] : [];
  });
  return [
    ...BUNDLES.flatMap((b) => bundleEntry(b) ?? []),
    ...listed.filter((e) => e.kind === "software"),
    ...listed.filter((e) => e.kind === "feed"),
    ...BASKET_STRATEGY_ENTRIES.map(strategyEntry),
  ];
}

/** A line as stored in basket_requests.lines: a snapshot at submit. */
export interface BasketLine {
  kind: BasketLineKind;
  key: string;
  name: string;
  servers?: number;
  /** Bundle lines only: the feed the client picked. The name carries it too, so every renderer that prints
   * l.name (the Telegram card, the admin list, My requests) shows it with no change. */
  feed?: BundleFeedChoice;
  note?: string;
}

export class BasketLineError extends Error {}

/**
 * Validates the client's lines into snapshots, without the per-account feed note (that needs the
 * DB; createBasketRequest adds it). Throws BasketLineError on the first bad line, naming it. A
 * repeated kind+key is refused rather than merged: the client's store never sends one, so a repeat
 * is a hand-made POST. Terminal and strategy lines carry no count (no unit has been named).
 */
export function resolveBasketLines(inputs: unknown): BasketLine[] {
  if (!Array.isArray(inputs) || inputs.length === 0) throw new BasketLineError("Your basket is empty");
  if (inputs.length > BASKET_MAX_LINES) throw new BasketLineError(`A basket holds at most ${BASKET_MAX_LINES} lines`);
  const seen = new Set<string>();
  // One bundle per basket, of ANY key (Q-H; Fable S2 C4): the kind:key set above only stops the same key twice.
  let bundleSeen = false;
  return inputs.map((raw): BasketLine => {
    const input = raw as { kind?: unknown; key?: unknown; servers?: unknown; feed?: unknown } | null;
    const kind = input?.kind;
    const key = typeof input?.key === "string" ? input.key : "";
    if (kind !== "software" && kind !== "strategy" && kind !== "feed" && kind !== "bundle") throw new BasketLineError("Unknown line in basket");
    const id = `${kind}:${key}`;
    if (seen.has(id)) throw new BasketLineError("The same product is in the basket twice");
    seen.add(id);
    if (kind === "bundle") {
      if (bundleSeen) throw new BasketLineError("A basket holds one bundle");
      bundleSeen = true;
    }
    const entry = basketEntry(kind, key);
    if (!entry) throw new BasketLineError(`${key || "A product"} isn't available to request`);
    if (kind === "bundle") {
      if (input?.servers !== undefined) throw new BasketLineError(`${entry.name}: a bundle line has no server count`);
      const feed = typeof input?.feed === "string" && isBundleFeedChoice(input.feed) ? input.feed : null;
      const choice = feed ? entry.feedChoices?.find((c) => c.key === feed) : undefined;
      if (!feed || !choice) throw new BasketLineError(`${entry.name}: choose a feed`);
      if (!choice.available) throw new BasketLineError(`${entry.name}: ${choice.title} isn't available to request`);
      return { kind, key, name: `${entry.name} (feed: ${choice.title})`, feed };
    }
    if (kind === "feed") {
      const servers = input?.servers ?? 1;
      if (typeof servers !== "number" || !Number.isInteger(servers) || servers < 1 || servers > BASKET_MAX_SERVERS) {
        throw new BasketLineError(`${entry.name}: servers must be a whole number from 1 to ${BASKET_MAX_SERVERS}`);
      }
      return { kind, key, name: entry.name, servers };
    }
    if (kind === "strategy") return { kind, key, name: entry.name, note: BASKET_STRATEGY_NOTE };
    return { kind, key, name: entry.name };
  });
}
