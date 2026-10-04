import { FEED_REGION_LABELS, feedTierMeta } from "./feed-tier-catalogue";
import { MAIN_SITE_URL } from "./main-site";
import { MARKETPLACE_LISTINGS, listingByKey, listingDetailHref, tierAvailability, type ListingMark } from "./marketplace-catalogue";
import { STRATEGY_DISPLAY_META } from "./strategy-catalogue";
import type { StrategyKey } from "./setfiles";

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

export type BasketLineKind = "software" | "strategy" | "feed";

export const BASKET_MAX_LINES = 20;
export const BASKET_MAX_SERVERS = 20;
export const BASKET_STRATEGY_NOTE = "Included with a Horizon licence";

/** One strategy product in the basket. Today each is one strategy; a package lists several. */
interface BasketStrategyEntry {
  key: string;
  strategyKeys: StrategyKey[];
  /** Overrides meta.name, for a package. Absent = the one strategy's meta.name. */
  name?: string;
  /** The card's own image, a file under /public (marcus m59621: Iris is drawing one per
   * strategy). Absent = the shared "Strategy" plate. */
  image?: string;
}

export const BASKET_STRATEGY_ENTRIES: BasketStrategyEntry[] = [
  { key: "1leg", strategyKeys: ["1leg"] },
  { key: "2leg_lock", strategyKeys: ["2leg_lock"] },
  { key: "trend_impulse", strategyKeys: ["trend_impulse"] },
  { key: "obi", strategyKeys: ["obi"] },
  { key: "grid", strategyKeys: ["grid"] },
];

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
  mark?: ListingMark;
  detailHref?: string;
  /** A strategy's "See more" target on www. Not detailHref: that one also links the basket line. */
  aboutHref?: string;
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
    image: e.image,
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

/** The entry for one line, or null when the basket can't carry it (unknown key, wrong kind, not
 * available). */
export function basketEntry(kind: BasketLineKind, key: string): BasketEntry | null {
  if (kind === "strategy") {
    const e = BASKET_STRATEGY_ENTRIES.find((s) => s.key === key);
    return e ? strategyEntry(e) : null;
  }
  return listingEntry(kind, key);
}

/** Every product the basket can carry today, in shelf order: software, feeds, strategies. */
export function basketCatalogue(): BasketEntry[] {
  const listed = MARKETPLACE_LISTINGS.flatMap((l) => {
    const e = listingEntry(l.category === "feeds" ? "feed" : "software", l.key);
    return e ? [e] : [];
  });
  return [
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
  return inputs.map((raw): BasketLine => {
    const input = raw as { kind?: unknown; key?: unknown; servers?: unknown } | null;
    const kind = input?.kind;
    const key = typeof input?.key === "string" ? input.key : "";
    if (kind !== "software" && kind !== "strategy" && kind !== "feed") throw new BasketLineError("Unknown line in basket");
    const id = `${kind}:${key}`;
    if (seen.has(id)) throw new BasketLineError("The same product is in the basket twice");
    seen.add(id);
    const entry = basketEntry(kind, key);
    if (!entry) throw new BasketLineError(`${key || "A product"} isn't available to request`);
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
