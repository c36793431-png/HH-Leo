/* Run: npx tsx --test src/lib/feed-collected.test.tsx
 *
 * COLLECTED tile + "Amount received" on the admin queue's paid approve, and the admin tiles counting request groups
 * (marcus m64288 GO on plan m64286: rulings 1-4). Fail-first: on the code before this branch every test here fails
 * (no 'feed_access' category, no payments.access_request_id, no amount on the approve, tiles count feed rows).
 * Real Postgres, no prod: PGlite with the REAL migration chain through db.ts's global._pgPool seam (the
 * access-requests-admin-trial.test.ts harness, same seeds and skip). Approvals go through the shipped admin path
 * (approveFeedTierRequest with a decision), so the payments row has the shape prod would write. Sends are stubbed. */
import { test, before } from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { renderToStaticMarkup } from "react-dom/server";
import { PGlite } from "@electric-sql/pglite";
import type { FeedTierRequestRow } from "./feed-tier-requests";

const MIGRATIONS = path.join(process.cwd(), "db/migrations");
const DAY = 24 * 60 * 60 * 1000;
const PIP = "00000000-0000-4000-8000-00000000c001";
const ADMIN = "00000000-0000-4000-8000-00000000c002";
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
/** 0014's list, the one prod holds before 0100 (read 2026-10-11 00:48Z). */
const PRE_0100_CHECK = `check (category in ('customer', 'partner', 'affiliate', 'feed_provider', 'infra', 'other', 'referral_payout'))`;

/* eslint-disable @typescript-eslint/no-explicit-any */
let db: any;
let lib: {
  ftr: typeof import("./feed-tier-requests");
  payments: typeof import("./payments");
};

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
  process.env.TELEGRAM_HFT_ALERT_BOT_TOKEN = "test-token";
  process.env.TELEMETRY_BOT_TOKEN = "test-sink-token";
  delete process.env.AUTH_RESEND_KEY;
  (globalThis as any).fetch = async () => new Response(JSON.stringify({ ok: true, result: {} }), { status: 200 });
  lib = { ftr: await import("./feed-tier-requests"), payments: await import("./payments") };
  await sql(`insert into users (id, email, role) values ($1, 'pip@example.invalid', 'feed_provider'), ($2, 'admin@example.invalid', 'admin')`, [PIP, ADMIN]);
  await sql(`update feed_tiers set provider_user_id = $1 where tier_key in ('ny-normal', 'ny-fast')`, [PIP]);
});

let buyerSeq = 0;
/** A buyer with a live licence and one registered server, and one pending request for `tierKey` on it. */
async function pendingRequest(tierKey: string) {
  buyerSeq++;
  const u = await sql(`insert into users (email, telegram_user_id) values ($1, $2) returning id`, [`col${buyerSeq}@example.invalid`, 8800 + buyerSeq]);
  const userId = u.rows[0].id as string;
  const l = await sql(`insert into licenses (user_id, license_key, expires_at) values ($1, $2, now() + interval '60 days') returning id`, [userId, `KEY-COL-${buyerSeq}`]);
  const s = await sql(
    `insert into server_registrations (license_id, user_id, server_name, vps_provider, server_location, declared_ip)
     values ($1, $2, 'srv', 'other', 'New York', $3) returning id`,
    [l.rows[0].id, userId, `10.9.0.${buyerSeq}`]
  );
  const ar = await import("./access-requests");
  const tier = (await sql(`select id from feed_tiers where tier_key = $1`, [tierKey])).rows[0].id;
  const { requestIds } = await ar.createAccessRequestBatch({ userId, items: [{ kind: "feed_tier", serverRegistrationId: s.rows[0].id, feedTierId: tier }] });
  return { userId, email: `col${buyerSeq}@example.invalid`, serverId: s.rows[0].id as string, requestId: requestIds[0] };
}

const paid = (amountReceivedUsd?: number | null) => ({
  decision: "paid" as const,
  endsAt: new Date(Date.now() + 30 * DAY),
  invoiceRef: "INV-COL",
  amountReceivedUsd,
});

async function paymentsFor(requestId: string) {
  return (await sql(`select * from payments where access_request_id = $1`, [requestId])).rows;
}
async function envelope(requestId: string) {
  return (await sql(`select status, decision from access_requests where id = $1`, [requestId])).rows[0];
}
async function grants(requestId: string) {
  return (await sql(`select id from feed_subscriptions where access_request_id = $1`, [requestId])).rows;
}

test("0100: the category check allows feed_access and payments.access_request_id exists, FK to access_requests", async () => {
  const def = (await sql(`select pg_get_constraintdef(oid) as def from pg_constraint where conname = 'payments_category_check'`)).rows[0].def;
  assert.match(def, /'feed_access'/);
  for (const c of ["customer", "partner", "affiliate", "feed_provider", "infra", "other", "referral_payout"]) assert.match(def, new RegExp(`'${c}'`));
  const col = (await sql(`select data_type, is_nullable from information_schema.columns where table_name = 'payments' and column_name = 'access_request_id'`)).rows[0];
  assert.deepEqual(col, { data_type: "uuid", is_nullable: "YES" });
  const fk = (await sql(`select pg_get_constraintdef(oid) as def from pg_constraint where conrelid = 'payments'::regclass and contype = 'f' and pg_get_constraintdef(oid) like '%access_request_id%'`)).rows;
  assert.equal(fk.length, 1);
  assert.match(fk[0].def, /REFERENCES access_requests\(id\)/);
});

test("COLLECTED with zero feed_access rows: both figures are null and the tile shows — (not $0)", async () => {
  // A 'customer' row this month is licence money: never counted.
  await sql(`insert into payments (amount_usd, direction, category) values (99, 'in', 'customer')`);
  const c = await lib.payments.getFeedAccessCollected();
  assert.deepEqual(c, { monthUsd: null, allTimeUsd: null });
  const { FeedCollectedTile } = await import("../components/admin/feed-collected-tile");
  const html = renderToStaticMarkup(<FeedCollectedTile collected={c} />).replace(/<!-- -->/g, "");
  assert.match(html, />—</);
  assert.match(html, /all-time —/);
  assert.doesNotMatch(html, /\$0/);
  assert.match(html, /collected/i);
});

test("paid + amount: the approve writes ONE payments row in its own transaction, with the envelope's facts", async () => {
  const b = await pendingRequest("ny-normal");
  await lib.ftr.approveFeedTierRequest(b.requestId, ADMIN, "", paid(50));
  assert.equal((await envelope(b.requestId)).status, "approved");
  const rows = await paymentsFor(b.requestId);
  assert.equal(rows.length, 1);
  const p = rows[0];
  assert.equal(Number(p.amount_usd), 50);
  assert.equal(p.currency, "USD");
  assert.equal(p.direction, "in");
  assert.equal(p.category, "feed_access");
  assert.equal(p.activation_source, "paid");
  assert.equal(p.user_id, b.userId);
  assert.equal(p.memo, "INV-COL");
  assert.equal(p.counterparty, b.email);
  assert.equal(p.created_by, "admin@example.invalid");
  assert.ok(Math.abs(new Date(p.received_at).getTime() - Date.now()) < 60_000, "received_at = the approve's now()");
});

test("paid with no amount (empty field): approved, NO payments row", async () => {
  for (const amount of [undefined, null]) {
    const b = await pendingRequest("ny-fast");
    await lib.ftr.approveFeedTierRequest(b.requestId, ADMIN, "", paid(amount));
    assert.equal((await envelope(b.requestId)).status, "approved");
    assert.equal((await paymentsFor(b.requestId)).length, 0);
  }
});

test("trial + amount: refused, nothing written (envelope still pending, no grant, no payment)", async () => {
  const b = await pendingRequest("ny-normal");
  await assert.rejects(
    lib.ftr.approveFeedTierRequest(b.requestId, ADMIN, "", { decision: "trial", endsAt: null, invoiceRef: null, amountReceivedUsd: 50 }),
    /trial has no amount received/i
  );
  assert.equal((await envelope(b.requestId)).status, "pending");
  assert.equal((await grants(b.requestId)).length, 0);
  assert.equal((await paymentsFor(b.requestId)).length, 0);
});

test("a bad amount (0, negative, sub-cent, not a number, over numeric(12,2)) is refused before anything is written", async () => {
  const b = await pendingRequest("ny-fast");
  for (const amount of [0, -5, 12.345, Number.NaN, Infinity, 1e10]) {
    await assert.rejects(lib.ftr.approveFeedTierRequest(b.requestId, ADMIN, "", paid(amount)), /amount received/i, String(amount));
  }
  assert.equal((await envelope(b.requestId)).status, "pending");
  assert.equal((await grants(b.requestId)).length, 0);
});

test("the form's text: '' = no amount; '50', '49.99', ' 1,250.5 ' parse; '0', '-1', '1.234', 'abc', '$50' are refused", () => {
  const { parseAmountReceivedUsd } = lib.payments;
  assert.equal(parseAmountReceivedUsd(""), null);
  assert.equal(parseAmountReceivedUsd("   "), null);
  assert.equal(parseAmountReceivedUsd("50"), 50);
  assert.equal(parseAmountReceivedUsd("49.99"), 49.99);
  assert.equal(parseAmountReceivedUsd(" 1,250.5 "), 1250.5);
  for (const bad of ["0", "0.00", "-1", "1.234", "abc", "$50", "1e3", "50 USD"]) {
    assert.throws(() => parseAmountReceivedUsd(bad), /amount received/i, bad);
  }
});

test("the payment write fails -> the WHOLE approve rolls back (the deploy-order hazard: code on a DB without 0100)", async () => {
  // Put back the pre-0100 check: exactly what prod holds if the code deploys before the migration. NOT VALID only
  // because earlier tests here left feed_access rows (prod has none); it still checks every new insert.
  await sql(`alter table payments drop constraint payments_category_check`);
  await sql(`alter table payments add constraint payments_category_check ${PRE_0100_CHECK} not valid`);
  try {
    const b = await pendingRequest("ny-normal");
    await assert.rejects(lib.ftr.approveFeedTierRequest(b.requestId, ADMIN, "", paid(30)), /payments_category_check/);
    assert.equal((await envelope(b.requestId)).status, "pending", "the envelope is not approved");
    assert.equal((await grants(b.requestId)).length, 0, "no grant");
    assert.equal((await sql(`select id from feed_allowlist_records where server_registration_id = $1`, [b.serverId])).rows.length, 0, "no allowlist record");
    assert.equal((await paymentsFor(b.requestId)).length, 0, "no payment");
    // The same DB, no amount: the approve does not touch payments, so it still works pre-0100.
    await lib.ftr.approveFeedTierRequest(b.requestId, ADMIN, "", paid(null));
    assert.equal((await envelope(b.requestId)).status, "approved");
  } finally {
    await sql(`alter table payments drop constraint payments_category_check`);
    const def = readFileSync(path.join(MIGRATIONS, "0100_payments_feed_access.sql"), "utf8").match(/check \(category in \([^)]*\)\)/)![0];
    await sql(`alter table payments add constraint payments_category_check ${def}`);
  }
});

test("the approve fails -> no payment row (approving an already-decided envelope with an amount)", async () => {
  const b = await pendingRequest("ny-fast");
  await lib.ftr.approveFeedTierRequest(b.requestId, ADMIN, "", paid(20));
  await assert.rejects(lib.ftr.approveFeedTierRequest(b.requestId, ADMIN, "", paid(20)), /already/i);
  assert.equal((await paymentsFor(b.requestId)).length, 1, "still only the first approve's row");
});

test("COLLECTED sums feed_access + in only: this month vs all-time; customer rows, out rows and last month kept apart", async () => {
  await sql(`delete from payments`);
  const b = await pendingRequest("ny-normal");
  await lib.ftr.approveFeedTierRequest(b.requestId, ADMIN, "", paid(50));
  await sql(`insert into payments (amount_usd, direction, category) values (25.5, 'in', 'feed_access')`);
  await sql(`insert into payments (amount_usd, direction, category) values (1000, 'in', 'customer')`);
  await sql(`insert into payments (amount_usd, direction, category) values (7, 'out', 'feed_access')`);
  await sql(`insert into payments (amount_usd, direction, category, received_at) values (30, 'in', 'feed_access', date_trunc('month', now()) - interval '1 day')`);
  const c = await lib.payments.getFeedAccessCollected();
  assert.deepEqual(c, { monthUsd: 75.5, allTimeUsd: 105.5 });
  const { FeedCollectedTile } = await import("../components/admin/feed-collected-tile");
  const html = renderToStaticMarkup(<FeedCollectedTile collected={c} />).replace(/<!-- -->/g, "");
  assert.match(html, /\$75\.50/);
  assert.match(html, /all-time \$105\.50/);
});

test("COLLECTED with rows only before this month: the month shows —, the all-time line shows the sum", async () => {
  await sql(`delete from payments`);
  await sql(`insert into payments (amount_usd, direction, category, received_at) values (30, 'in', 'feed_access', date_trunc('month', now()) - interval '1 day')`);
  const c = await lib.payments.getFeedAccessCollected();
  assert.deepEqual(c, { monthUsd: null, allTimeUsd: 30 });
});

function fixtureRow(id: string, batchId: string, tierKey: string, status: FeedTierRequestRow["status"]): FeedTierRequestRow {
  return { id, batchId, tierKey, status } as FeedTierRequestRow;
}

test("admin tiles: a 2-feed pending NY Base package counts 1 (control: 2 envelopes); a part-decided package counts per row", async () => {
  const { countRequestGroupsByStatus } = await import("./request-package-groups");
  const { FEED_TIER_REQUEST_STATUSES } = lib.ftr;
  const rows = [
    fixtureRow("p1", "pkg", "ny-fast", "pending"),
    fixtureRow("p2", "pkg", "ny-normal", "pending"),
    fixtureRow("s1", "solo", "ny-fast", "pending"),
    fixtureRow("h1", "half", "ny-fast", "approved"),
    fixtureRow("h2", "half", "ny-normal", "pending"),
    fixtureRow("r1", "rej", "cme-ctrader-fix", "rejected"),
  ];
  assert.equal(rows.filter((r) => r.batchId === "pkg").length, 2, "control: the package is 2 envelopes");
  assert.deepEqual(countRequestGroupsByStatus(rows, FEED_TIER_REQUEST_STATUSES), { pending: 3, approved: 1, rejected: 1 });
});

test("0100_rollback refuses while feed_access rows exist, then reverts to 0014's check with the column gone (runs last)", async () => {
  const rollback = readFileSync(path.join(MIGRATIONS, "0100_rollback.sql"), "utf8");
  await sql(`insert into payments (amount_usd, direction, category) values (1, 'in', 'feed_access')`);
  await assert.rejects(db.exec(rollback), /feed_access rows/);
  await db.exec("rollback");
  assert.equal((await sql(`select 1 from schema_migrations where version = '0100'`)).rows.length, 1, "nothing rolled back");
  await sql(`delete from payments where category = 'feed_access'`);
  await db.exec(rollback);
  const def = (await sql(`select pg_get_constraintdef(oid) as def from pg_constraint where conname = 'payments_category_check'`)).rows[0].def;
  assert.doesNotMatch(def, /feed_access/);
  assert.match(def, /'referral_payout'/);
  assert.equal((await sql(`select 1 from information_schema.columns where table_name = 'payments' and column_name = 'access_request_id'`)).rows.length, 0);
  assert.equal((await sql(`select 1 from schema_migrations where version = '0100'`)).rows.length, 0);
});
