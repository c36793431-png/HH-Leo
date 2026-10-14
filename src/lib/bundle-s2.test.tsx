/* Run: npx tsx --test --experimental-test-module-mocks src/lib/bundle-s2.test.tsx
 *
 * Bundles slice 2: the client-facing part (plan to-marcus/bundles_s2_plan_part{1,2}_2026-10-14.md @ 0efe0f6; Fable
 * PASS C1-C7 m67878; marcus rulings m67867 + BUILD GO m67879). A client can see the Horizon Complete bundle, pick
 * its feed and send it in a basket; S2 writes nothing but the basket_requests row. Real Postgres, no prod: PGlite
 * carrying the REAL migration chain, the shipped lib through db.ts's global._pgPool seam, pages rendered with
 * renderToStaticMarkup. The RSC payload and .next/static checks need a real build and are the C5 probe, pasted in
 * the diff message, not here. */
import { test, before, after, mock } from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import type { ReactElement, ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { PGlite } from "@electric-sql/pglite";

const MIGRATIONS = path.join(process.cwd(), "db/migrations");
const SEED_PROVIDER = "00000000-0000-4000-8000-0000000000a1";
const SEVEN_PAIRS = [
  ["9239faa5-88a0-4789-9774-b0c161823b29", "c0e8b76c-3b3d-433d-a47c-b7ba4f87c45b"],
  ["a66d928c-6830-4cb3-80af-06cfca4ad3b6", "6c3f0587-b3b3-4a58-909f-05c507d975e9"],
  ["5182a8be-96ab-4ad7-8b3c-ff2603e8f784", "973abad0-bc81-4c8e-87cf-9a30c1287385"],
  ["a830b5f8-a358-4203-971d-281fd65784b9", "176ca960-de6a-4dac-b17b-693448a526ad"],
  ["122221aa-789d-4830-8726-2060147d9206", "5b50698e-98f1-4ca3-b607-e91ae2183028"],
  ["ce3d2cce-28dc-4e4c-bb8e-889c9a6a29db", "692523d5-207d-4ad5-8310-2702035d29c2"],
  ["5e3fa8fd-ebac-4516-a68a-9d8101644786", "6865647f-735f-4db6-b3da-5f233e341aa0"],
];
const SEEDS: Record<string, string> = {
  "0046_partner_backfill_legitcashmaker_aylrn.sql": `insert into users (email) values ('giang2000ln@gmail.com');`,
  "0081_feed_subscriptions_license_id.sql": `
    insert into users (id, email, role) values ('${SEED_PROVIDER}', 'seed-provider@example.invalid', 'feed_provider');
    update feed_tiers set provider_user_id = '${SEED_PROVIDER}';
    update feed_tiers set id = '21842a66-62be-46e6-a0b1-c38ff78a0da5' where tier_key = 'ld-beta-56';
    update feed_tiers set id = '19cb2c39-8446-4b91-937f-16da2250770d' where tier_key = 'ld-gamma-19';
    update feed_tiers set id = 'a8538ab6-0057-44a8-80c2-6877980c85e6' where tier_key = 'ld-delta-18';
    ${SEVEN_PAIRS.map(([u, l], i) => `
      insert into users (id, email) values ('${u}', 'seed${i}@example.invalid');
      insert into licenses (id, user_id, license_key, expires_at, feed_types)
        values ('${l}', '${u}', 'SEED-${i}', now() + interval '90 days', array['london']);`).join("")}`,
};
const SKIPPED = new Set(["0082_provider_client_pseudonyms_backfill.sql"]);
const PRICE_ROW = { "horizon-complete": { usd: 100, per: "month" } };
/** "$" followed by a digit: any price at all, not only "$100/month" (Fable S2 C6). */
const ANY_PRICE = /\$\s*\d/;
/** AI vendor and model names (m66854 hard rule: none on a client surface). */
const VENDOR_NAMES = /\b(claude|anthropic|openai|chatgpt|gpt|gemini|google ai|llama|meta ai|mistral|sonnet|opus|haiku|grok|deepseek|copilot|qwen)\b/i;

/* eslint-disable @typescript-eslint/no-explicit-any */
let db: any;
let cat: typeof import("./basket-catalogue");
let bc: typeof import("./bundle-catalogue");
let mc: typeof import("./marketplace-catalogue");
let br: typeof import("./basket-requests");
let price: typeof import("./bundle-price");
let store: typeof import("./basket-store");
const session: { user: any } | null = { user: null };
const telegramSends: string[] = [];
/** What the mocked useBasket returns: the stored lines a client-side render would read from localStorage. */
let storedLines: any[] = [];

async function sql(text: string, params: unknown[] = []) {
  const r = await db.query(text, params);
  return { rows: r.rows as any[], rowCount: (r.rows.length || r.affectedRows || 0) as number };
}
const html = (el: ReactElement) => renderToStaticMarkup(el).replace(/<!-- -->/g, "");
const signIn = (id: string, email: string) => {
  session!.user = { id, email, roles: [] };
};
const signOut = () => {
  session!.user = null;
};
async function setPriceRow(value: unknown | null) {
  await sql(`delete from portal_config where key = 'bundle_list_price'`);
  if (value !== null) await sql(`insert into portal_config (key, value) values ('bundle_list_price', $1::jsonb)`, [JSON.stringify(value)]);
}

let seq = 0;
async function makeUser() {
  seq++;
  const email = `bundle${seq}@example.invalid`;
  const r = await sql(`insert into users (email, telegram_username) values ($1, $2) returning id`, [email, `bundle_${seq}`]);
  return { id: r.rows[0].id as string, email };
}

before(async () => {
  db = new PGlite();
  const files = readdirSync(MIGRATIONS).filter((f) => f.endsWith(".sql") && !f.includes("rollback")).sort();
  for (const f of files) {
    if (SKIPPED.has(f)) continue;
    if (SEEDS[f]) await db.exec(SEEDS[f]);
    await db.exec(readFileSync(path.join(MIGRATIONS, f), "utf8"));
  }
  (globalThis as any)._pgPool = { query: sql, connect: async () => ({ query: sql, release() {} }), end: async () => {} };
  process.env.TELEMETRY_BOT_TOKEN = "test-token";
  (globalThis as any).fetch = async (url: string, init?: { body?: string }) => {
    if (String(url).includes("/sendMessage") && init?.body) telegramSends.push(String(JSON.parse(init.body).text));
    return new Response(JSON.stringify({ ok: true, result: {} }), { status: 200 });
  };
  // The real store first, for its pure functions; then every component that imports it gets useBasket mocked.
  store = await import("./basket-store");
  mock.module("@/lib/basket-store", { namedExports: { ...store, useBasket: () => storedLines, useBasketStep: () => "basket" } });
  mock.module("@/lib/auth", { namedExports: { auth: async () => session } });
  mock.module("next/cache", { namedExports: { revalidatePath: () => {} } });
  mock.module("next/navigation", {
    namedExports: {
      redirect: (to: string) => {
        throw new Error(`redirect ${to}`);
      },
      notFound: () => {
        throw new Error("notFound");
      },
      usePathname: () => "/marketplace",
      useRouter: () => ({ push() {}, refresh() {}, replace() {} }),
      useSearchParams: () => new URLSearchParams(),
    },
  });
  mock.module("@/components/portal/portal-shell", { namedExports: { PortalShell: ({ children }: { children: ReactNode }) => children } });
  mock.module("@/components/marketplace/public-shell", { namedExports: { PublicShell: ({ children }: { children: ReactNode }) => children } });
  cat = await import("./basket-catalogue");
  bc = await import("./bundle-catalogue");
  mc = await import("./marketplace-catalogue");
  br = await import("./basket-requests");
  price = await import("./bundle-price");
});

after(() => {
  storedLines = [];
});

const LD = { kind: "bundle", key: "horizon-complete", feed: "ld-base" };
const NY = { kind: "bundle", key: "horizon-complete", feed: "ny-base" };

/** Runs fn with one listing's availability changed, then puts it back (the tierAvailability seam reads it). An
 * async fn is awaited before the put-back, so a page render reads the changed state. */
function withAvailability<T>(key: string, availability: string, fn: () => T): T {
  const listing = mc.listingByKey(key)! as any;
  const was = listing.availability;
  listing.availability = availability;
  let result: T;
  try {
    result = fn();
  } catch (err) {
    listing.availability = was;
    throw err;
  }
  if (result instanceof Promise) return result.finally(() => (listing.availability = was)) as T;
  listing.availability = was;
  return result;
}
/** Runs fn with a second bundle defined, for the one-bundle-of-any-key rule (C4). */
function withSecondBundle<T>(fn: () => T): T {
  bc.BUNDLES.push({ key: "horizon-two" as any, title: "Horizon Two", blurb: "x", licenceTier: "paid", feedChoices: ["ld-base", "ny-base"] });
  try {
    return fn();
  } finally {
    bc.BUNDLES.pop();
  }
}

// ---- T7 validator ----

test("T7 a bundle line with ld-base or ny-base resolves to the exact snapshot (feed + name carrying it)", () => {
  const [ld] = cat.resolveBasketLines([LD]);
  assert.deepEqual(ld, { kind: "bundle", key: "horizon-complete", name: "Horizon Complete (feed: London · Base)", feed: "ld-base" });
  const [ny] = cat.resolveBasketLines([NY]);
  assert.equal(ny.name, `Horizon Complete (feed: ${mc.listingByKey("ny-base")!.title})`);
  assert.equal(ny.feed, "ny-base");
  assert.equal(ny.servers, undefined);
  // Beside the other kinds, unchanged.
  const mixed = cat.resolveBasketLines([LD, { kind: "feed", key: "ld-base", servers: 2 }, { kind: "software", key: "horizon-terminal" }]);
  assert.deepEqual(mixed.map((l) => l.kind), ["bundle", "feed", "software"]);
});

test("T7 refused: no feed, an unknown or non-string feed, an unknown bundle key, servers, the same bundle twice", () => {
  const bad: unknown[][] = [
    [{ kind: "bundle", key: "horizon-complete" }],
    [{ kind: "bundle", key: "horizon-complete", feed: "ld-alpha" }],
    [{ kind: "bundle", key: "horizon-complete", feed: "chicago" }],
    [{ kind: "bundle", key: "horizon-complete", feed: 7 }],
    [{ kind: "bundle", key: "horizon-complete", feed: "__proto__" }],
    [{ kind: "bundle", key: "horizon-nope", feed: "ld-base" }],
    [{ kind: "bundle", key: "ld-base", feed: "ld-base" }],
    [{ ...LD, servers: 1 }],
    [LD, NY],
  ];
  for (const lines of bad) assert.throws(() => cat.resolveBasketLines(lines), cat.BasketLineError, JSON.stringify(lines));
});

test("T7 C4: two bundle lines of DIFFERENT keys are refused (one bundle per basket, Q-H)", () => {
  withSecondBundle(() => {
    // Each alone is fine, so the refusal below is the pair, not the fixture.
    assert.equal(cat.resolveBasketLines([{ kind: "bundle", key: "horizon-two", feed: "ny-base" }])[0].key, "horizon-two");
    assert.throws(() => cat.resolveBasketLines([LD, { kind: "bundle", key: "horizon-two", feed: "ny-base" }]), /one bundle/);
  });
});

test("T7 a feed whose listing can't be requested is refused, by the feed line's own test; the other feed still resolves", () => {
  withAvailability("ld-base", "maintenance", () => {
    assert.throws(() => cat.resolveBasketLines([LD]), /London · Base isn't available/);
    assert.throws(() => cat.resolveBasketLines([{ kind: "feed", key: "ld-base" }]), cat.BasketLineError, "same rule as a feed line");
    assert.equal(cat.resolveBasketLines([NY]).length, 1);
  });
  // Neither feed: the bundle itself can't be requested, and leaves the catalogue.
  withAvailability("ld-base", "unavailable", () =>
    withAvailability("ny-base", "unavailable", () => {
      assert.equal(cat.basketEntry("bundle", "horizon-complete"), null);
      assert.ok(!cat.basketCatalogue().some((e) => e.kind === "bundle"));
      assert.throws(() => cat.resolveBasketLines([NY]), cat.BasketLineError);
    }),
  );
});

test("T7 PIN: the catalogue is the bundle first, then every listing and strategy in its old kind and order", () => {
  assert.deepEqual(cat.basketCatalogue().map((e) => `${e.kind}:${e.key}`), [
    "bundle:horizon-complete",
    "software:horizon-terminal",
    "feed:ld-base",
    "feed:ny-base",
    "feed:chicago",
    "strategy:1leg",
    "strategy:2leg_lock",
    "strategy:trend_impulse",
    "strategy:obi",
    "strategy:grid",
  ]);
  const entry = cat.basketEntry("bundle", "horizon-complete")!;
  // C2: the feed choices travel as titled props, nothing else.
  assert.deepEqual(entry.feedChoices, [
    { key: "ld-base", title: "London · Base", available: true },
    { key: "ny-base", title: mc.listingByKey("ny-base")!.title, available: true },
  ]);
  assert.equal(entry.detailHref, "/marketplace/horizon-complete");
  assert.equal(entry.image, undefined, "plate only (M4)");
  for (const field of Object.keys(entry)) assert.doesNotMatch(field, /price|usd|cents|share/i, field);
});

// ---- T7b store ----

test("T7b isLine keeps a good bundle line and drops one with no feed, a bad feed, or servers", () => {
  assert.equal(store.isStoredBasketLine(LD), true);
  assert.equal(store.isStoredBasketLine(NY), true);
  for (const l of [
    { kind: "bundle", key: "horizon-complete" },
    { kind: "bundle", key: "horizon-complete", feed: "ld-alpha" },
    { kind: "bundle", key: "horizon-complete", feed: 7 },
    { ...LD, servers: 1 },
    { kind: "bundle", feed: "ld-base" },
  ]) {
    assert.equal(store.isStoredBasketLine(l), false, JSON.stringify(l));
  }
  // Older kinds unchanged.
  assert.equal(store.isStoredBasketLine({ kind: "feed", key: "ld-base", servers: 2 }), true);
  assert.equal(store.isStoredBasketLine({ kind: "feed", key: "ld-base", servers: 0 }), false);
});

test("T7b C4 store: putting a bundle replaces ANY bundle line (other feed, other key); other lines stay", () => {
  const base = [{ kind: "feed" as const, key: "ld-base", servers: 1 }];
  const one = store.putLine(base, LD as any);
  assert.deepEqual(store.putLine(one, NY as any), [...base, NY]);
  assert.deepEqual(store.putLine(one, { kind: "bundle", key: "horizon-two", feed: "ny-base" }), [...base, { kind: "bundle", key: "horizon-two", feed: "ny-base" }]);
  // Non-bundle lines keep one-per-kind+key.
  assert.deepEqual(store.putLine(one, { kind: "feed", key: "ld-base", servers: 3 }), [{ kind: "feed", key: "ld-base", servers: 3 }, LD]);
});

// ---- T7c / T7e create ----

test("T7c create: one basket_requests row whose jsonb carries the feed; nothing else written; the card names it", async () => {
  const u = await makeUser();
  const tables = ["access_requests", "bundle_subscriptions", "payments", "referral_earnings", "licenses", "feed_subscriptions"];
  const counts = async () => Object.fromEntries(await Promise.all(tables.map(async (t) => [t, (await sql(`select count(*)::int n from ${t}`)).rows[0].n])));
  const c0 = await counts();
  const before = telegramSends.length;
  const { id } = await br.createBasketRequest({ userId: u.id, lines: [LD, { kind: "strategy", key: "obi" }], wantTrial: false });
  const row = (await sql(`select lines, has_trial from basket_requests where id = $1`, [id])).rows[0];
  assert.deepEqual(row.lines[0], { kind: "bundle", key: "horizon-complete", name: "Horizon Complete (feed: London · Base)", feed: "ld-base" });
  assert.equal(row.has_trial, false);
  assert.deepEqual(await counts(), c0, "S2 writes nothing but the basket row");
  const sent = telegramSends.slice(before);
  assert.equal(sent.length, 1);
  // telemetry-sink is unchanged: a non-feed line prints `• <name> (<kind>)`, and the name carries the feed.
  assert.match(sent[0], /\n• Horizon Complete \(feed: London · Base\) \(bundle\)\n/);
});

test("T7e M2: wantTrial + a bundle line is REFUSED server-side before anything is written or sent (even for an eligible account)", async () => {
  const u = await makeUser();
  assert.equal(await br.isBasketTrialEligible(u.id), true, "precondition: the trial alone would be allowed");
  const before = telegramSends.length;
  await assert.rejects(br.createBasketRequest({ userId: u.id, lines: [NY], wantTrial: true }), cat.BasketLineError);
  assert.equal((await sql(`select count(*)::int n from basket_requests where user_id = $1`, [u.id])).rows[0].n, 0);
  assert.equal(telegramSends.length, before);
  // Control: the same account's trial without the bundle, and the bundle without the trial, both go through.
  await br.createBasketRequest({ userId: u.id, lines: [NY], wantTrial: false });
  await br.createBasketRequest({ userId: u.id, lines: [{ kind: "feed", key: "ny-base" }], wantTrial: true });
});

// ---- T7d forward ----

test("T7d forward: a bundle line is never forwarded as a provider access request; only the feed line beside it is", async () => {
  const { forwardBasketFeedLines } = await import("./basket-forward");
  const u = await makeUser();
  const [bundleLine, feedLine] = cat.resolveBasketLines([LD, { kind: "feed", key: "ld-base" }]);
  assert.deepEqual(await forwardBasketFeedLines({ userId: u.id, lines: [bundleLine], picks: {} }), []);
  const results = await forwardBasketFeedLines({ userId: u.id, lines: [bundleLine, feedLine], picks: {} });
  assert.deepEqual(results.map((r) => r.key), ["ld-base"]);
  assert.equal((await sql(`select count(*)::int n from access_requests where user_id = $1`, [u.id])).rows[0].n, 0);
});

// ---- T8 price reader ----

test("T8 reader: refuses rather than guesses; only a positive whole usd per month reads", async () => {
  const f = (v: unknown) => price.formatBundleListPrice(v, "horizon-complete");
  for (const v of [
    undefined,
    null,
    {},
    [],
    "100",
    { "horizon-other": { usd: 100, per: "month" } },
    { "horizon-complete": null },
    { "horizon-complete": { usd: 0, per: "month" } },
    { "horizon-complete": { usd: -1, per: "month" } },
    { "horizon-complete": { usd: "100", per: "month" } },
    { "horizon-complete": { usd: 99.5, per: "month" } },
    { "horizon-complete": { usd: 100, per: "year" } },
    { "horizon-complete": { usd: 100 } },
  ]) {
    assert.equal(f(v), null, JSON.stringify(v));
  }
  assert.equal(f(PRICE_ROW), "$100/month");
  assert.equal(f({ "horizon-complete": { usd: 1250, per: "month" } }), "$1,250/month");

  // Through the DB: missing row -> null (there is NO fallback number), the row -> the string.
  await setPriceRow(null);
  assert.equal(await price.getBundleListPrice("horizon-complete"), null);
  assert.deepEqual(await price.getBundleListPrices(["horizon-complete"]), {});
  await setPriceRow(PRICE_ROW);
  assert.equal(await price.getBundleListPrice("horizon-complete"), "$100/month");
  assert.deepEqual(await price.getBundleListPrices(["horizon-complete"]), { "horizon-complete": "$100/month" });
});

// ---- renders ----

async function productPage(key: string) {
  const { default: Page } = await import("../app/marketplace/[key]/page");
  return html(await Page({ params: Promise.resolve({ key }) }));
}
async function shelf() {
  const { default: Page } = await import("../app/marketplace/page");
  return html(await Page({ searchParams: Promise.resolve({}) }));
}
async function basketPage() {
  const { default: Page } = await import("../app/marketplace/basket/page");
  return html(await Page());
}
async function basketView(props: Record<string, unknown>) {
  const { BasketView } = await import("../components/marketplace/basket-view");
  return html(<BasketView catalogue={cat.basketCatalogue()} signInHref="/login" account={null} {...(props as any)} />);
}
const ACCOUNT = { email: "c@example.invalid", trialEligible: true, feedReady: false };

test("T8/T14 product page SIGNED OUT: no price and no hint of one, even with the row set; Sign in to request", async () => {
  await setPriceRow(PRICE_ROW);
  signOut();
  const out = await productPage("horizon-complete");
  assert.match(out, /<h1>Horizon Complete<\/h1>/);
  assert.match(out, /Sign in to request →/);
  assert.doesNotMatch(out, ANY_PRICE);
  assert.doesNotMatch(out, /bundle_list_price|after sign-in|per month|\/month/i);
  assert.doesNotMatch(out, /type="radio"/, "no feed picker signed out");
});

test("T8/T14 product page SIGNED IN: the price, two radios with NONE checked, Add disabled; an unavailable feed is disabled", async () => {
  const u = await makeUser();
  signIn(u.id, u.email);
  await setPriceRow(PRICE_ROW);
  const out = await productPage("horizon-complete");
  assert.match(out, /\$100\/month/);
  assert.equal(out.match(/type="radio"/g)?.length, 2);
  assert.doesNotMatch(out, /checked=""/, "no pre-checked feed");
  assert.match(out, /<button[^>]*disabled=""[^>]*>\+ Add to basket<\/button>/);
  assert.match(out, /London · Base/);
  assert.match(out, /Your feed is switched on once you register a server\. Everything else starts when we confirm\./);
  // No row: no price line at all, and nothing guessed.
  await setPriceRow(null);
  const bare = await productPage("horizon-complete");
  assert.doesNotMatch(bare, ANY_PRICE);
  await setPriceRow(PRICE_ROW);
  // One feed off: its radio is disabled with its own line; the other stays pickable.
  const off = await withAvailability("ny-base", "maintenance", () => productPage("horizon-complete"));
  assert.match(off, /<input(?=[^>]*value="ny-base")(?=[^>]*disabled="")[^>]*>/);
  assert.doesNotMatch(off, /<input(?=[^>]*value="ld-base")(?=[^>]*disabled="")[^>]*>/);
  assert.doesNotMatch(out, /<input(?=[^>]*type="radio")(?=[^>]*disabled="")[^>]*>/, "both on when both are available");
  assert.match(off, /Not available right now/);
  signOut();
});

test("T14 What's included: names from the catalogues, the 4 strategies (no OBI), one Base feed; no Nova line while the constant is null", async () => {
  signOut();
  const out = await productPage("horizon-complete");
  for (const k of bc.BUNDLE_STRATEGY_KEYS) assert.ok(out.includes((await import("./strategy-catalogue")).STRATEGY_DISPLAY_META[k].name.replace(/&/g, "&amp;")), k);
  assert.doesNotMatch(out, /Order Book Imbalance/);
  assert.match(out, /Horizon licence/);
  assert.match(out, /One Base feed, your choice: London · Base or New York · Base/);
  assert.equal(bc.BUNDLE_NOVA_LINE, null);
  assert.doesNotMatch(out, /Nova/);
  // Each of coxwell's three variants is a one-line change: the list follows the constant.
  for (const nova of [null, "Nova", "Nova (set up with you after purchase)"]) {
    const lines = bc.bundleIncludedLines(bc.BUNDLES[0], nova);
    assert.equal(lines.includes(nova as string), nova !== null, String(nova));
    assert.equal(lines.length, nova === null ? 3 : 4);
  }
});

test("T12 route: a bundle key renders the bundle; listing pages are untouched; keys never collide", async () => {
  signOut();
  const listingKeys = new Set(mc.MARKETPLACE_LISTINGS.map((l) => l.key));
  const statics = readdirSync(path.join(process.cwd(), "src/app/marketplace")).filter((f) => statSync(path.join(process.cwd(), "src/app/marketplace", f)).isDirectory() && !f.startsWith("["));
  assert.ok(statics.includes("basket") && statics.includes("requests"), statics.join(","));
  for (const b of bc.BUNDLES) {
    assert.ok(!listingKeys.has(b.key), `${b.key} is a listing key`);
    assert.ok(!statics.includes(b.key), `${b.key} is a static route`);
  }
  const ld = await productPage("ld-base");
  assert.match(ld, /<h1>London · Base<\/h1>/);
  assert.doesNotMatch(ld, /Horizon Complete|Choose your feed/);
  await assert.rejects(productPage("horizon-nope"), /notFound/);
});

test("T8/T13 shelf: Bundles is section 0 and the first chip after All; no Add on its card; its link is the product page; no price signed in or out", async () => {
  await setPriceRow(PRICE_ROW);
  for (const who of ["out", "in"] as const) {
    if (who === "in") {
      const u = await makeUser();
      signIn(u.id, u.email);
    } else signOut();
    const out = await shelf();
    assert.doesNotMatch(out, ANY_PRICE, who);
    const chips = [...out.matchAll(/<button[^>]*class="[^"]*mkt-filter[^"]*"[^>]*>([^<]*)</g)].map((m) => m[1].trim());
    if (chips.length) assert.deepEqual(chips.slice(0, 2), ["All", "Bundles"], who);
    const firstSection = out.indexOf('class="fp-section mkt-section"');
    assert.ok(firstSection >= 0);
    assert.equal(out.indexOf('id="bundles"'), out.lastIndexOf('id="bundles"'));
    assert.ok(out.indexOf('id="bundles"') < out.indexOf("<h2", firstSection + 1) || out.slice(firstSection, firstSection + 80).includes('id="bundles"'), `${who}: Bundles first`);
    const card = out.slice(out.indexOf('id="bundles"'), out.indexOf("</h2>", out.indexOf("Software</h2>") - 200));
    assert.match(card, /href="\/marketplace\/horizon-complete"[^>]*>Choose your feed →/);
    assert.doesNotMatch(card, /Add to basket/);
    assert.match(card, /Available/);
  }
  signOut();
});

test("T13 C7: with neither feed requestable the card reads the catalogue's own 'Not available at this moment', still no Add", async () => {
  signOut();
  const out = await withAvailability("ld-base", "unavailable", () => withAvailability("ny-base", "unavailable", () => shelf()));
  const card = out.slice(out.indexOf('id="bundles"'), out.indexOf("Software</h2>"));
  assert.match(card, /Not available at this moment/);
  assert.doesNotMatch(card, /Add to basket/);
});

test("T8 basket step: the bundle's price shows only with the server's prop; signed out a boolean says 'after sign-in'; no row = by agreement", async () => {
  storedLines = [LD, { kind: "feed", key: "ny-base", servers: 1 }];
  const priced = await basketView({ account: ACCOUNT, bundlePrices: { "horizon-complete": "$100/month" } });
  assert.match(priced, /\$100\/month/);
  assert.match(priced, /Lines without a price are priced by agreement\./);
  assert.match(priced, /Feed London · Base/);
  assert.match(priced, /One bundle, for you/);
  assert.match(priced, /href="\/marketplace\/horizon-complete"[^>]*>Change feed/);
  assert.match(priced, /<span>Bundles<\/span><b>1<\/b>/);
  const unpriced = await basketView({ account: ACCOUNT });
  assert.doesNotMatch(unpriced, ANY_PRICE);
  assert.match(unpriced, /Every line is priced by agreement\./);
  const out = await basketView({ account: null, priceAfterSignIn: true });
  assert.doesNotMatch(out, ANY_PRICE);
  assert.match(out, /Price shown after sign-in/);
  storedLines = [];
});

test("T8 M2 render: with a bundle line the 30-day trial box is HIDDEN for an eligible account; without one it shows", async () => {
  storedLines = [LD];
  assert.doesNotMatch(await basketView({ account: ACCOUNT }), /Start with a 30-day trial/);
  storedLines = [{ kind: "feed", key: "ld-base", servers: 1 }];
  assert.match(await basketView({ account: ACCOUNT }), /Start with a 30-day trial/, "control: the box is there without a bundle");
  storedLines = [];
});

test("T8 M3/C3: 'Included in Horizon Complete' on the terminal and on the CHOSEN feed only; never on the other feed", async () => {
  const note = /Included in Horizon Complete\./g;
  storedLines = [LD, { kind: "feed", key: "ny-base", servers: 1 }];
  assert.equal((await basketView({ account: ACCOUNT })).match(note)?.length ?? 0, 0, "ny-base beside an ld-base bundle: no note");
  storedLines = [LD, { kind: "feed", key: "ld-base", servers: 1 }];
  assert.equal((await basketView({ account: ACCOUNT })).match(note)?.length, 1, "ld-base beside an ld-base bundle");
  storedLines = [NY, { kind: "feed", key: "ld-base", servers: 1 }, { kind: "software", key: "horizon-terminal" }];
  assert.equal((await basketView({ account: ACCOUNT })).match(note)?.length, 1, "the terminal only");
  storedLines = [];
});

test("T8 price text: one function for all three steps (basket, Review :300, Sent :206)", async () => {
  const { linePriceText } = await import("./basket-price-text");
  const prices = { "horizon-complete": "$100/month" };
  assert.equal(linePriceText({ kind: "bundle", key: "horizon-complete" }, prices, undefined), "$100/month");
  assert.equal(linePriceText({ kind: "bundle", key: "horizon-complete" }, undefined, true), "Price shown after sign-in");
  assert.equal(linePriceText({ kind: "bundle", key: "horizon-complete" }, undefined, undefined), "Priced by agreement");
  for (const kind of ["software", "feed", "strategy"] as const) assert.equal(linePriceText({ kind, key: "horizon-complete" }, prices, true), "Priced by agreement", kind);
  // The three steps all read it: no literal "Priced by agreement" price cell left in the file.
  const src = readFileSync(path.join(process.cwd(), "src/components/marketplace/basket-view.tsx"), "utf8");
  assert.doesNotMatch(src, /bk-row-price">Priced by agreement/);
  assert.equal(src.match(/\{priceText\((l|entry)\)\}/g)?.length, 2, "Review + Sent cells");
});

test("T8 basket page SIGNED OUT with the row set: no price digits anywhere; the signed-out prop is a boolean", async () => {
  await setPriceRow(PRICE_ROW);
  signOut();
  storedLines = [LD];
  const out = await basketPage();
  assert.doesNotMatch(out, ANY_PRICE);
  assert.match(out, /Price shown after sign-in/);
  // No row: not even the boolean.
  await setPriceRow(null);
  const none = await basketPage();
  assert.doesNotMatch(none, /after sign-in/);
  assert.match(none, /Priced by agreement/);
  await setPriceRow(PRICE_ROW);
  storedLines = [];
});

// ---- T8 static ----

function stripComments(src: string) {
  return src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1");
}
function walk(dir: string): string[] {
  return readdirSync(dir).flatMap((f) => {
    const p = path.join(dir, f);
    return statSync(p).isDirectory() ? walk(p) : /\.(ts|tsx)$/.test(f) ? [p] : [];
  });
}

test("T8 static: the two catalogues carry no price, usd, cents or share in code", () => {
  for (const f of ["src/lib/bundle-catalogue.ts", "src/lib/basket-catalogue.ts"]) {
    const code = stripComments(readFileSync(path.join(process.cwd(), f), "utf8"));
    assert.doesNotMatch(code, /price|usd|cents|share/i, f);
  }
});

test("T8 static C1: no 'use client' module value-imports bundle-price, bundle-catalogue, basket-catalogue or marketplace-catalogue", () => {
  const forbidden = /^import\s+(?!type\b)[^;]*from\s+["'](@\/lib\/|\.\.?\/(?:[\w-]+\/)*)(bundle-price|bundle-catalogue|basket-catalogue|marketplace-catalogue)["']/m;
  const offenders = walk(path.join(process.cwd(), "src"))
    .filter((f) => !/\.test\.tsx?$/.test(f))
    .filter((f) => /^\s*["']use client["']/.test(readFileSync(f, "utf8")))
    .filter((f) => forbidden.test(readFileSync(f, "utf8")));
  assert.deepEqual(offenders, []);
  // The pin bites: a value import in a client file is caught.
  assert.ok(forbidden.test(`"use client";\nimport { BUNDLES } from "@/lib/bundle-catalogue";`));
  assert.ok(!forbidden.test(`"use client";\nimport type { BundleFeedChoice } from "@/lib/bundle-catalogue";`));
});

// ---- T8b copy pin ----

test("T8b no AI vendor or model name on any bundle client string (BUNDLES, every Nova variant, the pages, the basket)", async () => {
  for (const b of bc.BUNDLES) assert.doesNotMatch(`${b.title} ${b.blurb}`, VENDOR_NAMES);
  for (const nova of [null, "Nova", "Nova (set up with you after purchase)"]) {
    assert.doesNotMatch(JSON.stringify(bc.bundleIncludedLines(bc.BUNDLES[0], nova)), VENDOR_NAMES, String(nova));
  }
  const u = await makeUser();
  signIn(u.id, u.email);
  storedLines = [LD, { kind: "software", key: "horizon-terminal" }];
  const surfaces = [await productPage("horizon-complete"), await basketView({ account: ACCOUNT, bundlePrices: { "horizon-complete": "$100/month" } }), await basketView({ account: null, priceAfterSignIn: true })];
  signOut();
  surfaces.push(await productPage("horizon-complete"));
  for (const s of surfaces) assert.doesNotMatch(s.replace(/<[^>]+>/g, " "), VENDOR_NAMES);
  // The pin bites.
  assert.match("Powered by Claude", VENDOR_NAMES);
  storedLines = [];
});
