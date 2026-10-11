/* Run: npx tsx --test src/lib/client-feeds.test.tsx
 *
 * /admin/client-feeds (marcus m63917 B2): one read-only row per feed_subscriptions row, with client
 * + link, tier, EFFECTIVE status, trial/paid, started, ends, price, server + declared IP and the
 * allowlist state; a region filter; and every row past its ends_at that still reads active is
 * flagged "past end, still active". No schema, no writes.
 * Real Postgres, no prod: PGlite (PG 17) carries the real migration chain, the same harness and
 * seeds as access-requests-admin-trial.test.ts (see its header for the three preflight files). */
import { test, before } from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { renderToStaticMarkup } from "react-dom/server";
import { PGlite } from "@electric-sql/pglite";

const MIGRATIONS = path.join(process.cwd(), "db/migrations");
const DAY = 24 * 60 * 60 * 1000;

const PIP = "00000000-0000-4000-8000-00000000d001";
const ADMIN = "00000000-0000-4000-8000-00000000d002";
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
let lib: {
  cf: typeof import("./client-feeds");
  ftr: typeof import("./feed-tier-requests");
  ar: typeof import("./access-requests");
  fs: typeof import("./feed-subscriptions");
};

async function sql(text: string, params: unknown[] = []) {
  const r = await db.query(text, params);
  return { rows: r.rows as any[], rowCount: (r.rows.length || r.affectedRows || 0) as number };
}

let buyerSeq = 0;
async function makeBuyer(opts: { licenceFeeds?: string[] } = {}) {
  buyerSeq++;
  const u = await sql(`insert into users (email, display_name) values ($1, $2) returning id`, [`cf${buyerSeq}@example.invalid`, `Client ${buyerSeq}`]);
  const userId = u.rows[0].id as string;
  const l = await sql(
    `insert into licenses (user_id, license_key, expires_at, feed_types) values ($1, $2, now() + interval '60 days', $3) returning id`,
    [userId, `KEY-CF-${buyerSeq}`, opts.licenceFeeds ?? ["london", "ny"]]
  );
  const s = await sql(
    `insert into server_registrations (license_id, user_id, server_name, vps_provider, server_location, declared_ip)
     values ($1, $2, $3, 'other', 'Chicago', $4) returning id`,
    [l.rows[0].id, userId, `cf-srv-${buyerSeq}`, `10.7.0.${buyerSeq}`]
  );
  return { userId, email: `cf${buyerSeq}@example.invalid`, serverId: s.rows[0].id as string, ip: `10.7.0.${buyerSeq}`, serverName: `cf-srv-${buyerSeq}` };
}

async function approve(buyer: Awaited<ReturnType<typeof makeBuyer>>, tierKey: string, decision: "trial" | "paid", endsAt: Date | null, invoiceRef: string | null) {
  const tier = (await sql(`select id from feed_tiers where tier_key = $1`, [tierKey])).rows[0].id;
  const { requestIds } = await lib.ar.createAccessRequestBatch({
    userId: buyer.userId,
    items: [{ kind: "feed_tier", serverRegistrationId: buyer.serverId, feedTierId: tier }],
  });
  await lib.ftr.approveFeedTierRequest(requestIds[0], ADMIN, "u", { decision, endsAt, invoiceRef });
  return (await sql(`select id from feed_subscriptions where access_request_id = $1`, [requestIds[0]])).rows[0].id as string;
}

const fx: Record<string, { sub: string; buyer: Awaited<ReturnType<typeof makeBuyer>> }> = {};
let baseline = 0;

before(async () => {
  db = new PGlite();
  const files = readdirSync(MIGRATIONS).filter((f) => f.endsWith(".sql") && !f.includes("rollback")).sort();
  for (const f of files) {
    if (SKIPPED.has(f)) continue;
    if (SEEDS[f]) await db.exec(SEEDS[f]);
    await db.exec(readFileSync(path.join(MIGRATIONS, f), "utf8"));
  }
  (globalThis as any)._pgPool = { query: sql, connect: async () => ({ query: sql, release() {} }) };
  delete process.env.TELEMETRY_BOT_TOKEN;
  delete process.env.TELEGRAM_HFT_ALERT_BOT_TOKEN;
  delete process.env.AUTH_RESEND_KEY;
  (globalThis as any).fetch = async () => new Response(JSON.stringify({ ok: true, result: {} }), { status: 200 });

  lib = {
    cf: await import("./client-feeds"),
    ftr: await import("./feed-tier-requests"),
    ar: await import("./access-requests"),
    fs: await import("./feed-subscriptions"),
  };

  await sql(`insert into users (id, email, role) values ($1, 'pip@example.invalid', 'feed_provider'), ($2, 'admin@example.invalid', 'admin')`, [PIP, ADMIN]);
  await sql(
    `insert into feed_tiers (region_key, tier_key, name, subtitle, speed_display, description, path_redundancy, support_level, provider_user_id)
     values ('cme', 'cme-ctrader-fix', 'CME Futures · cTrader FIX', 'cTrader FIX', '-', 'CME futures', 'Single path', 'Standard', $1)`,
    [PIP]
  );
  await sql(`update feed_tiers set provider_user_id = $1 where tier_key in ('ny-normal', 'ny-fast')`, [PIP]);
  // The migration chain's own rows (0081 seeds subscriptions for its seven pairs).
  baseline = (await lib.cf.listClientFeeds()).length;

  // 1. CME paid via the queue, priced; its allowlist record then revoked and a second one opened.
  fx.cmePaid = { buyer: await makeBuyer(), sub: "" };
  fx.cmePaid.sub = await approve(fx.cmePaid.buyer, "cme-ctrader-fix", "paid", new Date(Date.now() + 30 * DAY), "INV-CF-1");
  await sql(`update feed_subscriptions set price_cents = 5000 where id = $1`, [fx.cmePaid.sub]);

  // 2. CME trial via the queue, then pushed past its end: CME is ungated, so it still reads active.
  fx.cmePastEnd = { buyer: await makeBuyer(), sub: "" };
  fx.cmePastEnd.sub = await approve(fx.cmePastEnd.buyer, "cme-ctrader-fix", "trial", null, null);
  await sql(`update feed_subscriptions set ends_at = now() - interval '2 days' where id = $1`, [fx.cmePastEnd.sub]);
  const rec = (await sql(`select id from feed_allowlist_records where server_registration_id = $1`, [fx.cmePastEnd.buyer.serverId])).rows[0].id;
  await sql(`update feed_allowlist_records set revoked_at = now(), revoked_by = 'admin:test' where id = $1`, [rec]);

  // 3. NY direct grant (no envelope).
  fx.nyDirect = { buyer: await makeBuyer(), sub: "" };
  fx.nyDirect.sub = (await lib.fs.assignFeedTierSubscription(fx.nyDirect.buyer.userId, "ny-fast")).subscriptionId;

  // 4. NY ended: lapsed, and past its end. A lapsed row is not "still active".
  fx.nyLapsed = { buyer: await makeBuyer(), sub: "" };
  fx.nyLapsed.sub = (await lib.fs.assignFeedTierSubscription(fx.nyLapsed.buyer.userId, "ny-normal")).subscriptionId;
  await sql(`update feed_subscriptions set status = 'lapsed', lapsed_at = now(), ends_at = now() - interval '1 day' where id = $1`, [fx.nyLapsed.sub]);
});

const byId = (rows: Awaited<ReturnType<typeof lib.cf.listClientFeeds>>, id: string) => {
  const row = rows.find((r) => r.subscriptionId === id);
  assert.ok(row, `row ${id} listed`);
  return row!;
};

test("one row per subscription, with every column marcus listed", async () => {
  const rows = await lib.cf.listClientFeeds();
  assert.equal(rows.length, baseline + 4);
  assert.equal(new Set(rows.map((r) => r.subscriptionId)).size, rows.length, "no row twice (the allowlist join is aggregated)");

  const p = byId(rows, fx.cmePaid.sub);
  assert.equal(p.userId, fx.cmePaid.buyer.userId);
  assert.equal(p.email, fx.cmePaid.buyer.email);
  assert.equal(p.displayName, "Client 1");
  assert.equal(p.tierName, "CME Futures · cTrader FIX");
  assert.equal(p.region, "cme");
  assert.equal(p.status, "active");
  assert.equal(p.grant, "paid");
  assert.ok(p.startedAt instanceof Date);
  assert.ok(p.endsAt && p.endsAt.getTime() > Date.now());
  assert.equal(p.priceCents, 5000);
  assert.equal(p.serverName, fx.cmePaid.buyer.serverName);
  assert.equal(p.declaredIp, fx.cmePaid.buyer.ip);
  assert.deepEqual(p.allowlistOpenIps, [fx.cmePaid.buyer.ip]);
  assert.equal(p.allowlistRevokedCount, 0);
  assert.equal(p.pastEndStillActive, false);
});

test("trial / paid / direct grant: from the envelope's decision, 'direct grant' when there is no envelope", async () => {
  const rows = await lib.cf.listClientFeeds();
  assert.equal(byId(rows, fx.cmePastEnd.sub).grant, "trial");
  assert.equal(byId(rows, fx.nyDirect.sub).grant, "direct grant");
  assert.equal(byId(rows, fx.nyDirect.sub).priceCents, null);
});

test("EFFECTIVE status, and the past-end flag only on rows that still read active", async () => {
  const rows = await lib.cf.listClientFeeds();
  const past = byId(rows, fx.cmePastEnd.sub);
  assert.equal(past.status, "active", "CME is ungated: EFFECTIVE_STATUS_SQL ignores ends_at");
  assert.equal(past.pastEndStillActive, true);
  assert.deepEqual(past.allowlistOpenIps, []);
  assert.equal(past.allowlistRevokedCount, 1);

  const lapsed = byId(rows, fx.nyLapsed.sub);
  assert.equal(lapsed.status, "lapsed");
  assert.equal(lapsed.pastEndStillActive, false, "lapsed is not 'still active'");
  assert.equal(rows[0].subscriptionId, fx.cmePastEnd.sub, "past-end rows sort first, so they are seen");
});

test("region filter: cme shows only CME rows; an unknown region is no filter", async () => {
  const cme = await lib.cf.listClientFeeds({ region: "cme" });
  assert.deepEqual(new Set(cme.map((r) => r.subscriptionId)), new Set([fx.cmePaid.sub, fx.cmePastEnd.sub]));
  const ny = await lib.cf.listClientFeeds({ region: "ny" });
  assert.ok(ny.every((r) => r.region === "ny"));
  assert.ok([fx.nyDirect.sub, fx.nyLapsed.sub].every((id) => ny.some((r) => r.subscriptionId === id)));
  assert.equal((await lib.cf.listClientFeeds({ region: "nowhere" })).length, baseline + 4);
});

test("read-only: listing writes nothing (row counts of every table it touches, and pseudonyms, unchanged)", async () => {
  const tables = ["feed_subscriptions", "feed_allowlist_records", "access_requests", "admin_actions", "provider_client_pseudonyms", "provider_pseudonym_counters", "users"];
  const counts = async () => Promise.all(tables.map(async (t) => (await sql(`select count(*)::int as n from ${t}`)).rows[0].n));
  const before = await counts();
  const pseudonymsBefore = (await sql(`select * from provider_pseudonym_counters order by 1`)).rows;
  await lib.cf.listClientFeeds();
  await lib.cf.listClientFeeds({ region: "cme" });
  assert.deepEqual(await counts(), before);
  assert.deepEqual((await sql(`select * from provider_pseudonym_counters order by 1`)).rows, pseudonymsBefore);
});

test("the table renders the link to the client's admin page, the IP, the flag, and the price", async () => {
  const { ClientFeedsTable } = await import("../components/admin/client-feeds-table");
  const rows = await lib.cf.listClientFeeds();
  const html = renderToStaticMarkup(<ClientFeedsTable rows={rows} />);
  assert.ok(html.includes(`href="/admin/users/${fx.cmePaid.buyer.userId}"`), "client links to /admin/users/<id>");
  assert.ok(html.includes(fx.cmePaid.buyer.ip));
  assert.ok(html.includes("$50.00"));
  assert.equal((html.match(/past end, still active/g) ?? []).length, 1, "exactly the one past-end active row is flagged");
  assert.ok(html.includes("unpriced"), "a NULL price says so");
  assert.ok(html.includes("1 revoked"));
});
