/* Run: npx tsx --test src/lib/admin-network-tiles.test.tsx
 *
 * Admin dashboard network tiles (marcus m64339 GO on plan m64338). One "live provider" predicate,
 * providerIsLiveSql (approved + >=1 provider_tiers row status 'live'), read by the dashboard tile, the
 * /admin/providers roster's Live/Onboarding status and that page's "Live providers" stat.
 * Runs on PGlite with the REAL migration chain (the provider-overview.test.tsx harness), no prod.
 * Counts are asserted as deltas over what the migrations seed, so a seed row can't make them pass. */
import { test, before } from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { renderToStaticMarkup } from "react-dom/server";
import { PGlite } from "@electric-sql/pglite";
import type { NetworkCounts } from "./admin-dashboard";

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

/* eslint-disable @typescript-eslint/no-explicit-any */
let db: any;
let base: NetworkCounts;
async function sql(text: string, params: unknown[] = []) {
  const r = await db.query(text, params);
  return { rows: r.rows as any[], rowCount: (r.rows.length || r.affectedRows || 0) as number };
}

let n = 0;
/** One provider application (+ its user) with the given tier statuses. */
async function provider(status: "approved" | "pending" | "declined", tiers: ("live" | "trial" | "paused")[], onboarded: boolean) {
  n += 1;
  const user = (await sql(`insert into users (email, role) values ($1, 'feed_provider') returning id`, [`p${n}@example.invalid`])).rows[0].id;
  const app = (
    await sql(
      `insert into provider_applications (user_id, reference_id, name, email, status, onboarded_at)
       values ($1, $2, $3, $4, $5, $6) returning id`,
      [user, `FP-TEST-${n}`, `Provider ${n}`, `p${n}@example.invalid`, status, onboarded ? new Date() : null]
    )
  ).rows[0].id;
  for (const [i, s] of tiers.entries()) {
    await sql(
      `insert into provider_tiers (application_id, provider_user_id, tier_name, client_price_cents, status) values ($1, $2, $3, 10000, $4)`,
      [app, user, `Tier ${n}-${i}`, s]
    );
  }
  return { app, name: `Provider ${n}` };
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
  const { getNetworkCounts } = await import("./admin-dashboard");
  base = await getNetworkCounts();
});

test("live = approved + >=1 live tier: onboarded_at NULL with live tiers is live, onboarded_at set with none is not; tile, roster and stat agree", async () => {
  const { getNetworkCounts } = await import("./admin-dashboard");
  const { listProviderRoster } = await import("./provider-tiers");
  const { getTermsQueueStats } = await import("./provider-terms-queue");
  const statBase = (await getTermsQueueStats()).liveProvidersCount;

  const cw1Like = await provider("approved", ["live", "live"], false); // serves clients, never stamped
  const pipLike = await provider("approved", ["live"], true);
  const pausedOnly = await provider("approved", ["paused", "trial"], true); // onboarded, nothing live
  const noTiers = await provider("approved", [], false);
  await provider("pending", ["live"], false); // not approved: never a provider
  await provider("declined", ["live"], true);

  const counts = await getNetworkCounts();
  assert.equal(counts.feedProviders - base.feedProviders, 4, "approved applications only");
  assert.equal(counts.liveFeedProviders - base.liveFeedProviders, 2, "cw1Like + pipLike");

  const roster = new Map((await listProviderRoster()).map((e) => [e.providerName, e.status]));
  assert.equal(roster.get(cw1Like.name), "live", "onboarded_at NULL but two live tiers: Live (was Onboarding)");
  assert.equal(roster.get(pipLike.name), "live");
  assert.equal(roster.get(pausedOnly.name), "onboarding", "onboarded_at set but no live tier: not Live");
  assert.equal(roster.get(noTiers.name), "onboarding");
  assert.equal(roster.has("Provider 5"), false, "a pending application is not on the roster");

  const liveOnRoster = [...roster.values()].filter((s) => s === "live").length;
  const stat = (await getTermsQueueStats()).liveProvidersCount;
  assert.equal(stat - statBase, 2, "the Live providers stat moves with the same predicate");
  assert.equal(stat, counts.liveFeedProviders, "page stat == dashboard tile");
  assert.equal(liveOnRoster, counts.liveFeedProviders, "roster Live filter == dashboard tile");
});

test("partners: active counted, inactive not; pending applications in the sub-line, approved/declined not", async () => {
  const { getNetworkCounts } = await import("./admin-dashboard");
  const before = await getNetworkCounts();
  await sql(`insert into partners (name, status) values ('Active A', 'active'), ('Active B', 'active'), ('Gone', 'inactive')`);
  await sql(
    `insert into partner_applications (name, email, status) values
       ('Pa', 'pa@example.invalid', 'pending'), ('Pb', 'pb@example.invalid', 'approved'), ('Pc', 'pc@example.invalid', 'declined')`
  );
  const after = await getNetworkCounts();
  assert.equal(after.activePartners - before.activePartners, 2);
  assert.equal(after.pendingPartnerApplications - before.pendingPartnerApplications, 1);
});

test("strategy providers: submitted counts every row; a 'listed' row changes nothing else (status never read)", async () => {
  const { getNetworkCounts } = await import("./admin-dashboard");
  const before = await getNetworkCounts();
  const author = (await sql(`insert into users (email) values ('author@example.invalid') returning id`)).rows[0].id;
  for (const status of ["pending", "listed", "declined"]) {
    await sql(
      `insert into strategy_submissions (author_user_id, name, category, description, contact_preference, status)
       values ($1, $2, 'custom', 'x', 'portal', $3)`,
      [author, `S ${status}`, status]
    );
  }
  const after = await getNetworkCounts();
  assert.equal(after.strategySubmissions - before.strategySubmissions, 3);
  assert.deepEqual({ ...after, strategySubmissions: 0 }, { ...before, strategySubmissions: 0 });
});

test("AdminDashboardPage renders the three tiles with their links; Strategy providers is — with 'not live yet · N submitted'", async () => {
  const { getNetworkCounts } = await import("./admin-dashboard");
  const { default: AdminDashboardPage } = await import("../app/admin/dashboard/page");
  const c = await getNetworkCounts();
  const html = renderToStaticMarkup(await AdminDashboardPage()).replace(/<!-- -->/g, "");
  const tile = (label: string) => {
    const at = html.indexOf(`>${label}</div>`);
    assert.ok(at > 0, `tile ${label} rendered`);
    const start = html.lastIndexOf("<a ", at);
    return html.slice(start, html.indexOf("</a>", at));
  };
  const providers = tile("Feed providers");
  assert.match(providers, /href="\/admin\/providers"/);
  assert.ok(providers.includes(`>${c.feedProviders}</div>`));
  assert.ok(providers.includes(`${c.liveFeedProviders} live · ${c.feedProviders - c.liveFeedProviders} onboarding`));
  const partners = tile("Partners");
  assert.match(partners, /href="\/admin\/partners"/);
  assert.ok(partners.includes(`>${c.activePartners}</div>`));
  assert.ok(partners.includes(`${c.pendingPartnerApplications} application${c.pendingPartnerApplications === 1 ? "" : "s"} pending`));
  const strategies = tile("Strategy providers");
  assert.match(strategies, /href="\/admin\/strategy-submissions"/);
  assert.ok(strategies.includes(">—</div>"), "value is — whatever the row count");
  assert.ok(strategies.includes(`not live yet · ${c.strategySubmissions} submitted`));
  assert.ok(c.strategySubmissions > 0, "the — holds with submissions present, incl. a 'listed' one");
});
