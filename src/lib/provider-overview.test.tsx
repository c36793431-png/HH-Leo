/* Run: npx tsx --test src/lib/provider-overview.test.tsx
 *
 * P1, the provider Overview on Iris's dashboard.html (marcus m64242 order; Earnings naming m64316, Fable m64314).
 * Fail-first: on 9c820fe every test here fails (no provider-overview lib, no overview-cards components).
 * Fixture months and rendered static HTML for the cards; the one new query (new clients in 7 days) runs on PGlite with
 * the REAL migration chain (the access-requests-admin-trial.test.ts harness), no prod. */
import { test, before } from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { renderToStaticMarkup } from "react-dom/server";
import { PGlite } from "@electric-sql/pglite";
import type { MonthlyHistoryEntry, ProviderRevenueSummary } from "./feed-subscriptions";

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
const NOW = new Date("2026-10-11T01:00:00Z");
const DAY = 24 * 60 * 60 * 1000;

/* eslint-disable @typescript-eslint/no-explicit-any */
let db: any;
async function sql(text: string, params: unknown[] = []) {
  const r = await db.query(text, params);
  return { rows: r.rows as any[], rowCount: (r.rows.length || r.affectedRows || 0) as number };
}

before(async () => {
  db = new PGlite();
  const files = readdirSync(MIGRATIONS).filter((f) => f.endsWith(".sql") && !f.includes("rollback")).sort();
  for (const f of files) {
    if (SKIPPED.has(f)) continue;
    if (SEEDS[f]) await db.exec(SEEDS[f]);
    await db.exec(readFileSync(path.join(MIGRATIONS, f), "utf8"));
  }
  (globalThis as any)._pgPool = { query: sql, connect: async () => ({ query: sql, release() {} }) };
});

function month(monthKey: string, clients: number, pricedClients: number, grossCents: number, shareCents: number): MonthlyHistoryEntry {
  const [y, mm] = monthKey.split("-").map(Number);
  const label = `${["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"][mm - 1]} ${y}`;
  return { monthKey, label, clients, pricedClients, grossCents, shareCents, rows: [] };
}

function summary(months: MonthlyHistoryEntry[], over: Partial<ProviderRevenueSummary> = {}): ProviderRevenueSummary {
  return {
    liveShareCents: 6000,
    live: { priced: 2, subscribers: 2 },
    months,
    contracted: { agreements: 2, clients: 2, grossCents: 24000, shareCents: 12000 } as ProviderRevenueSummary["contracted"],
    ...over,
  };
}

const strip = (html: string) => html.replace(/<!-- -->/g, "");

test("thisMonthShare: up / down vs last month in whole percent; Horizon = gross - share, not a second halving", async () => {
  const { thisMonthShare } = await import("./provider-overview");
  const up = thisMonthShare([month("2026-10", 2, 2, 12001, 6001), month("2026-09", 1, 1, 10000, 5000)], NOW);
  assert.equal(up.month?.monthKey, "2026-10");
  assert.equal(up.changePct, 20);
  assert.equal(up.horizonCents, 6000, "12001 - 6001: the two halves add to the gross");
  const down = thisMonthShare([month("2026-10", 1, 1, 6000, 3000), month("2026-09", 2, 2, 8000, 4000)], NOW);
  assert.equal(down.changePct, -25);
});

test("thisMonthShare: no honest comparison -> null (unpriced client either month, no client last month, last month $0, no row)", async () => {
  const { thisMonthShare } = await import("./provider-overview");
  const partNow = thisMonthShare([month("2026-10", 2, 1, 6000, 3000), month("2026-09", 1, 1, 6000, 3000)], NOW);
  assert.equal(partNow.changePct, null);
  assert.equal(partNow.horizonCents, null, "no split of a partly unpriced month");
  assert.equal(thisMonthShare([month("2026-10", 1, 1, 6000, 3000), month("2026-09", 2, 1, 6000, 3000)], NOW).changePct, null);
  assert.equal(thisMonthShare([month("2026-10", 1, 1, 6000, 3000), month("2026-09", 0, 0, 0, 0)], NOW).changePct, null);
  assert.equal(thisMonthShare([month("2026-10", 1, 1, 6000, 3000)], NOW).changePct, null, "no September row at all");
  const none = thisMonthShare([month("2026-09", 1, 1, 6000, 3000)], NOW);
  assert.equal(none.month, null, "History has no October row");
  assert.equal(none.changePct, null);
  // The previous month across a year end.
  assert.equal(thisMonthShare([month("2026-01", 1, 1, 200, 100), month("2025-12", 1, 1, 100, 50)], new Date("2026-01-03T00:00:00Z")).changePct, 100);
});

test("ThisMonthShareStat: '▲ 20%', '50% of $120'; partly priced -> no %, '1 of 2 priced'; no client -> '—'", async () => {
  const { thisMonthShare } = await import("./provider-overview");
  const { ThisMonthShareStat } = await import("../components/feed/overview-cards");
  const html = strip(renderToStaticMarkup(<ThisMonthShareStat share={thisMonthShare([month("2026-10", 2, 2, 12000, 6000), month("2026-09", 1, 1, 10000, 5000)], NOW)} />));
  assert.match(html, /This month · your share/);
  assert.match(html, />\$60</);
  assert.match(html, /▲ 20%/);
  assert.match(html, /50% of \$120/);
  const part = strip(renderToStaticMarkup(<ThisMonthShareStat share={thisMonthShare([month("2026-10", 2, 1, 6000, 3000)], NOW)} />));
  assert.match(part, /— vs\. last month/);
  assert.match(part, /1 of 2 priced/);
  assert.doesNotMatch(part, /50% of/);
  const empty = strip(renderToStaticMarkup(<ThisMonthShareStat share={thisMonthShare([], NOW)} />));
  assert.match(empty, /class="val">—</);
  assert.doesNotMatch(empty, /\$/);
});

test("ActiveUsersStat: 'N / M trial', new in 7 days, links to Subscribers and Trials", async () => {
  const { ActiveUsersStat } = await import("../components/feed/overview-cards");
  const html = strip(renderToStaticMarkup(<ActiveUsersStat subscribers={3} trialClients={1} newClients={2} />));
  assert.match(html, /Active users/);
  assert.match(html, /3 <small>\/ 1 trial<\/small>/);
  assert.match(html, /▲ 2<\/span> new in 7 days/);
  assert.match(html, /href="\/feed\/dashboard\/subscribers"/);
  assert.match(html, /href="\/feed\/dashboard\/active-users"/);
  assert.doesNotMatch(strip(renderToStaticMarkup(<ActiveUsersStat subscribers={0} trialClients={0} newClients={0} />)), /▲/);
});

test("Feed uptime tile and Feed health card: no number, no bars, no 'measured by', 'not measured yet'", async () => {
  const { FeedUptimeStat, FeedHealthCard } = await import("../components/feed/overview-cards");
  const tile = strip(renderToStaticMarkup(<FeedUptimeStat />));
  assert.match(tile, /not measured yet/);
  assert.doesNotMatch(tile.replace("30d", ""), /\d/);
  const card = strip(renderToStaticMarkup(<FeedHealthCard />));
  assert.match(card, /Not measured yet/);
  assert.doesNotMatch(card, /\d/);
  assert.doesNotMatch(card, /measured by|Feedverse|spark/i);
  assert.match(card, /href="\/feed\/dashboard\/health"/);
});

test("EarningsCard: 'Earnings', split bar Contracted vs Horizon, Right now, Contracted by month, Received '—'; no payout date, no Statements, no Feedverse", async () => {
  const { thisMonthShare } = await import("./provider-overview");
  const { EarningsCard } = await import("../components/feed/overview-cards");
  const months = [month("2026-10", 2, 2, 12000, 6000), month("2026-09", 1, 1, 10000, 5000)];
  const html = strip(renderToStaticMarkup(<EarningsCard revenue={summary(months)} share={thisMonthShare(months, NOW)} monthsOnCard={3} />));
  assert.match(html, /<h3>Earnings<\/h3>/);
  assert.match(html, /Oct 2026/);
  assert.match(html, /width:50%/);
  assert.match(html, /Contracted · your share <b[^>]*>\$60<\/b>/);
  assert.match(html, /Horizon <span[^>]*>\$60<\/span>/);
  assert.match(html, /Right now · your 50%/);
  assert.match(html, /Contracted · by month/);
  assert.match(html, /Received<\/span><span class="mc">not tracked yet — there is no payout ledger<\/span><span class="mv none">—<\/span>/);
  assert.match(html, /Earnings → History/);
  assert.doesNotMatch(html, /Next payout|Statements|Feedverse|Revenue/);
});

test("EarningsCard: a partly priced month draws no split bar and says why; no month row -> no bar either", async () => {
  const { thisMonthShare } = await import("./provider-overview");
  const { EarningsCard } = await import("../components/feed/overview-cards");
  const part = [month("2026-10", 2, 1, 6000, 3000)];
  const html = strip(renderToStaticMarkup(<EarningsCard revenue={summary(part)} share={thisMonthShare(part, NOW)} monthsOnCard={3} />));
  assert.doesNotMatch(html, /class="splitbar"/);
  assert.match(html, /once every client this month has an agreed price/);
  const none = strip(renderToStaticMarkup(<EarningsCard revenue={summary([])} share={thisMonthShare([], NOW)} monthsOnCard={3} />));
  assert.doesNotMatch(none, /class="splitbar"/);
  assert.match(none, /once a client holds a paid subscription this month/);
});

test("BotChip: 'Feed bot · linked' only when a link exists", async () => {
  const { BotChip } = await import("../components/feed/overview-cards");
  assert.match(strip(renderToStaticMarkup(<BotChip linked />)), /Feed bot · linked/);
  assert.equal(renderToStaticMarkup(<BotChip linked={false} />), "");
});

test("countNewClientsForProvider: clients whose FIRST grant from this provider began in the last 7 days", async () => {
  const { countNewClientsForProvider } = await import("./provider-overview");
  const provider = (await sql(`insert into users (email, role) values ('p1-provider@example.invalid', 'feed_provider') returning id`)).rows[0].id;
  const other = (await sql(`insert into users (email, role) values ('p1-other@example.invalid', 'feed_provider') returning id`)).rows[0].id;
  const tiers = (await sql(`select id from feed_tiers order by tier_key limit 2`)).rows.map((r) => r.id);
  async function client(email: string) {
    return (await sql(`insert into users (email) values ($1) returning id`, [email])).rows[0].id as string;
  }
  async function grant(providerId: string, subscriberId: string, tierId: string, daysAgo: number) {
    // Lapsed rows: the started_at is what this reads, and a lapsed row needs no server or licence.
    await sql(
      `insert into feed_subscriptions (provider_user_id, subscriber_user_id, feed_tier_id, status, started_at, lapsed_at)
       values ($1, $2, $3, 'lapsed', $4, $4)`,
      [providerId, subscriberId, tierId, new Date(NOW.getTime() - daysAgo * DAY)]
    );
  }
  const fresh = await client("p1-fresh@example.invalid");
  const returning = await client("p1-returning@example.invalid");
  const elsewhere = await client("p1-elsewhere@example.invalid");
  const twoTiers = await client("p1-twotiers@example.invalid");
  await grant(provider, fresh, tiers[0], 3);
  await grant(provider, returning, tiers[0], 20);
  await grant(provider, returning, tiers[1], 2); // a new row, not a new client
  await grant(other, elsewhere, tiers[0], 1); // another provider's client
  await grant(provider, twoTiers, tiers[0], 1);
  await grant(provider, twoTiers, tiers[1], 1); // one client, two rows
  assert.equal(await countNewClientsForProvider(provider, NOW), 2, "fresh + twoTiers");
  assert.equal(await countNewClientsForProvider(provider, NOW, 30), 3, "30 days takes the returning client too");
  assert.equal(await countNewClientsForProvider(other, NOW), 1);
});
