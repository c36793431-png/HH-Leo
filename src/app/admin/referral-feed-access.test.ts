/* Run: npx tsx --test --experimental-test-module-mocks src/app/admin/referral-feed-access.test.ts
 *
 * Referral commission on feed purchases (coxwell via marcus m64643 (c); plan m64760, ruling m64769: R1-R4). A referred
 * client's feed payment (category 'feed_access') earns the referrer 30% of the amount received, in the plain
 * referral_earnings ledger -- never the partner-deal path, even for a partner-linked referrer (R4). Software
 * ('customer') is unchanged. Fail-first on aafd40c: the feed tests fail there (the gate takes 'customer' only, the
 * approve never calls the earning, Finance's Add leaves a feed_access row with no user); the controls pass on both.
 * Real Postgres, no prod: PGlite with the REAL migration chain (the feed-collected.test.tsx harness), approvals
 * through the shipped admin path, Finance's Add through the REAL server action with auth() and next/cache mocked. */
import { test, before, mock } from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { PGlite } from "@electric-sql/pglite";

const MIGRATIONS = path.join(process.cwd(), "db/migrations");
const DAY = 24 * 60 * 60 * 1000;
const PIP = "00000000-0000-4000-8000-00000000e001";
const ADMIN = "00000000-0000-4000-8000-00000000e002";
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
let ftr: typeof import("../../lib/feed-tier-requests");
let referrals: typeof import("../../lib/referrals");
let finance: typeof import("./finance/actions");

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
  (globalThis as any)._pgPool = { query: sql, connect: async () => ({ query: sql, release() {} }), end: async () => {} };
  process.env.TELEGRAM_HFT_ALERT_BOT_TOKEN = "test-token";
  process.env.TELEMETRY_BOT_TOKEN = "test-sink-token";
  delete process.env.AUTH_RESEND_KEY;
  (globalThis as any).fetch = async () => new Response(JSON.stringify({ ok: true, result: {} }), { status: 200 });
  const session = { user: { id: ADMIN, email: "admin@example.invalid", role: "admin", roles: ["admin"] } };
  mock.module("@/lib/auth", { namedExports: { auth: async () => session } });
  mock.module("next/cache", { namedExports: { revalidatePath: () => {} } });
  ftr = await import("../../lib/feed-tier-requests");
  referrals = await import("../../lib/referrals");
  finance = await import("./finance/actions");
  await sql(`insert into users (id, email, role) values ($1, 'pip@example.invalid', 'feed_provider'), ($2, 'admin@example.invalid', 'admin')`, [PIP, ADMIN]);
  await sql(`update feed_tiers set provider_user_id = $1 where tier_key in ('ny-normal', 'ny-fast')`, [PIP]);
});

let seq = 0;
async function makeUser(referrerId: string | null = null) {
  seq++;
  const email = `ref${seq}@example.invalid`;
  const u = await sql(`insert into users (email, telegram_user_id, referred_by_user_id) values ($1, $2, $3) returning id`, [email, 7700 + seq, referrerId]);
  return { id: u.rows[0].id as string, email };
}
/** A plain referrer, or one linked to an active partner row (the partner-deal path for software). */
async function makeReferrer(partnerLinked = false) {
  const r = await makeUser();
  if (partnerLinked) await sql(`insert into partners (name, user_id, status) values ($1, $2, 'active')`, [`Partner ${seq}`, r.id]);
  return r;
}

/** A buyer (referred by `referrerId`, or not) with a live licence, one server and one pending ny-normal request. */
async function pendingRequest(referrerId: string | null) {
  const buyer = await makeUser(referrerId);
  const l = await sql(`insert into licenses (user_id, license_key, expires_at) values ($1, $2, now() + interval '60 days') returning id`, [buyer.id, `KEY-REF-${seq}`]);
  const s = await sql(
    `insert into server_registrations (license_id, user_id, server_name, vps_provider, server_location, declared_ip)
     values ($1, $2, 'srv', 'other', 'New York', $3) returning id`,
    [l.rows[0].id, buyer.id, `10.8.0.${seq}`]
  );
  const serverId = s.rows[0].id as string;
  return { buyer, serverId, requestId: await requestTier(buyer.id, serverId, "ny-normal") };
}
/** One more pending feed request from an existing buyer's server, on `tierKey`. */
async function requestTier(buyerId: string, serverId: string, tierKey: string) {
  const ar = await import("../../lib/access-requests");
  const tier = (await sql(`select id from feed_tiers where tier_key = $1`, [tierKey])).rows[0].id;
  const { requestIds } = await ar.createAccessRequestBatch({ userId: buyerId, items: [{ kind: "feed_tier", serverRegistrationId: serverId, feedTierId: tier }] });
  return requestIds[0];
}

const paid = (amountReceivedUsd?: number | null) => ({
  decision: "paid" as const,
  endsAt: new Date(Date.now() + 30 * DAY),
  invoiceRef: "INV-REF",
  amountReceivedUsd,
});

async function paymentFor(requestId: string) {
  return (await sql(`select * from payments where access_request_id = $1`, [requestId])).rows;
}
async function earningsFor(referredUserId: string) {
  return (await sql(`select * from referral_earnings where referred_user_id = $1`, [referredUserId])).rows;
}
async function dealsFor(clientUserId: string) {
  return (await sql(`select d.*, (select count(*)::int from deal_payments dp where dp.deal_id = d.id) as payments from partner_deals d where d.client_user_id = $1`, [clientUserId])).rows;
}

test("R1+R2: a referred client's paid feed approve with $50 received earns the referrer $15.00 (30%), pending, on that payment", async () => {
  const referrer = await makeReferrer();
  const { buyer, requestId } = await pendingRequest(referrer.id);
  await ftr.approveFeedTierRequest(requestId, ADMIN, "", paid(50));
  const [payment] = await paymentFor(requestId);
  assert.equal(payment.category, "feed_access");
  const earnings = await earningsFor(buyer.id);
  assert.equal(earnings.length, 1);
  assert.equal(earnings[0].referrer_user_id, referrer.id);
  assert.equal(earnings[0].payment_id, payment.id);
  assert.equal(Number(earnings[0].amount_usd), 15);
  assert.equal(Number(earnings[0].rate), 0.3);
  assert.equal(earnings[0].status, "pending");
});

test("Q1: 30% of what was RECEIVED (amount_usd), whatever the tier's list price: $40 received earns $12.00", async () => {
  const referrer = await makeReferrer();
  const { buyer, requestId } = await pendingRequest(referrer.id);
  await ftr.approveFeedTierRequest(requestId, ADMIN, "", paid(40));
  const earnings = await earningsFor(buyer.id);
  assert.equal(earnings.length, 1);
  assert.equal(Number(earnings[0].amount_usd), 12);
});

test("the earning is once per payment: running it again for the same feed payment adds nothing", async () => {
  const referrer = await makeReferrer();
  const { buyer, requestId } = await pendingRequest(referrer.id);
  await ftr.approveFeedTierRequest(requestId, ADMIN, "", paid(50));
  const [payment] = await paymentFor(requestId);
  await referrals.maybeCreateReferralEarning(payment.id);
  await referrals.maybeCreateReferralEarning(payment.id);
  assert.equal((await earningsFor(buyer.id)).length, 1);
});

test("R4: a PARTNER-linked referrer's feed client earns the plain 30% ledger row, and NO partner deal (never the 60% path)", async () => {
  const partnerReferrer = await makeReferrer(true);
  const { buyer, requestId } = await pendingRequest(partnerReferrer.id);
  await ftr.approveFeedTierRequest(requestId, ADMIN, "", paid(50));
  const earnings = await earningsFor(buyer.id);
  assert.equal(earnings.length, 1);
  assert.equal(Number(earnings[0].amount_usd), 15);
  assert.equal((await dealsFor(buyer.id)).length, 0, "no partner_deals row for a feed payment");
});

test("control: no referrer -> the feed approve writes its payment and no earning", async () => {
  const { buyer, requestId } = await pendingRequest(null);
  await ftr.approveFeedTierRequest(requestId, ADMIN, "", paid(50));
  assert.equal((await paymentFor(requestId)).length, 1);
  assert.equal((await earningsFor(buyer.id)).length, 0);
});

test("control: a paid approve with no amount and a trial approve write no payment, so no earning", async () => {
  const referrer = await makeReferrer();
  const a = await pendingRequest(referrer.id);
  await ftr.approveFeedTierRequest(a.requestId, ADMIN, "", paid(null));
  const b = await pendingRequest(referrer.id);
  await ftr.approveFeedTierRequest(b.requestId, ADMIN, "", { decision: "trial", endsAt: null, invoiceRef: null });
  for (const r of [a, b]) {
    assert.equal((await paymentFor(r.requestId)).length, 0);
    assert.equal((await earningsFor(r.buyer.id)).length, 0);
  }
});

test("control: software ('customer') is unchanged -- plain referrer 30% ledger, partner-linked referrer the 60% deal", async () => {
  const plain = await makeReferrer();
  const partner = await makeReferrer(true);
  const a = await makeUser(plain.id);
  const b = await makeUser(partner.id);
  for (const u of [a, b]) {
    const p = await sql(`insert into payments (amount_usd, direction, category, user_id) values (100, 'in', 'customer', $1) returning id`, [u.id]);
    await referrals.maybeCreateReferralEarning(p.rows[0].id);
  }
  const ea = await earningsFor(a.id);
  assert.equal(ea.length, 1);
  assert.equal(Number(ea[0].amount_usd), 30);
  assert.equal((await earningsFor(b.id)).length, 0);
  const deals = await dealsFor(b.id);
  assert.equal(deals.length, 1);
  assert.equal(Number(deals[0].partner_pct), 0.6);
  assert.equal(deals[0].payments, 1);
});

test("control: an 'out' feed_access row and an 'in' row of another category never earn", async () => {
  const referrer = await makeReferrer();
  const u = await makeUser(referrer.id);
  for (const [direction, category] of [["out", "feed_access"], ["in", "infra"], ["in", "partner"]]) {
    const p = await sql(`insert into payments (amount_usd, direction, category, user_id) values (50, $1, $2, $3) returning id`, [direction, category, u.id]);
    await referrals.maybeCreateReferralEarning(p.rows[0].id);
  }
  assert.equal((await earningsFor(u.id)).length, 0);
});

test("R2: the earning failing never undoes the approve -- envelope approved, payment kept, an admin_actions miss row names the payment", async () => {
  const referrer = await makeReferrer();
  const { buyer, requestId } = await pendingRequest(referrer.id);
  await sql(`alter table referral_earnings rename to referral_earnings_off`);
  try {
    await ftr.approveFeedTierRequest(requestId, ADMIN, "", paid(50));
  } finally {
    await sql(`alter table referral_earnings_off rename to referral_earnings`);
  }
  assert.equal((await sql(`select status from access_requests where id = $1`, [requestId])).rows[0].status, "approved");
  const [payment] = await paymentFor(requestId);
  assert.ok(payment, "the payment row is kept");
  assert.equal((await earningsFor(buyer.id)).length, 0);
  const miss = (await sql(`select admin_user_id, details_json from admin_actions where action_type = 'referral_earning_failed'`)).rows;
  assert.equal(miss.length, 1);
  assert.equal(miss[0].admin_user_id, ADMIN);
  assert.equal(miss[0].details_json.paymentId, payment.id);
  // Re-running it once the cause is fixed books it, once.
  await referrals.maybeCreateReferralEarning(payment.id);
  assert.equal((await earningsFor(buyer.id)).length, 1);
});

function form(fields: Record<string, string>): FormData {
  const f = new FormData();
  for (const [k, v] of Object.entries(fields)) f.set(k, v);
  return f;
}

test("R3: Finance's Add payment, category Feed access, in, from a referred client's email: the row gets the client's user_id and earns 30%", async () => {
  const referrer = await makeReferrer();
  const buyer = await makeUser(referrer.id);
  const result = await finance.addPaymentAction(
    null,
    form({ receivedAt: "2026-10-10", amountUsd: "50", currency: "USD", direction: "in", category: "feed_access", counterparty: buyer.email, memo: "crypto" })
  );
  assert.equal(result.ok, true, JSON.stringify(result));
  const rows = (await sql(`select * from payments where counterparty = $1`, [buyer.email])).rows;
  assert.equal(rows.length, 1);
  assert.equal(rows[0].user_id, buyer.id);
  const earnings = await earningsFor(buyer.id);
  assert.equal(earnings.length, 1);
  assert.equal(Number(earnings[0].amount_usd), 15);
});

test("control: Finance's Add payment for 'customer' still links the user and earns 30%; an 'infra' row links nobody", async () => {
  const referrer = await makeReferrer();
  const buyer = await makeUser(referrer.id);
  await finance.addPaymentAction(null, form({ receivedAt: "2026-10-10", amountUsd: "100", direction: "in", category: "customer", counterparty: buyer.email }));
  const infraBuyer = await makeUser(referrer.id);
  await finance.addPaymentAction(null, form({ receivedAt: "2026-10-10", amountUsd: "100", direction: "in", category: "infra", counterparty: infraBuyer.email }));
  assert.equal(Number((await earningsFor(buyer.id))[0].amount_usd), 30);
  assert.equal((await sql(`select user_id from payments where counterparty = $1`, [infraBuyer.email])).rows[0].user_id, null);
  assert.equal((await earningsFor(infraBuyer.id)).length, 0);
});

// Q4 interim (a) (marcus m64826, m64880; Fable m64882): a referrer earns on a client's FIRST feed_access payment per
// tier, not on every payment for life. A Finance (R3) feed row carries no tier, so it counts as the first for every
// tier, and earns only if the client has no feed earning at all. Earning status is ignored: a clawed-back first
// earning still counts as the first. Software ('customer') is untouched.
async function lapseGrant(requestId: string) {
  await sql(`update feed_subscriptions set status = 'lapsed', ends_at = now() - interval '1 day' where access_request_id = $1`, [requestId]);
}
/** Finance's hand-entered rows for a client (the approve's own payment carries the same counterparty email). */
async function financeRows(email: string) {
  return (await sql(`select * from payments where counterparty = $1 and access_request_id is null`, [email])).rows;
}
const financeFeedRow = (email: string) =>
  finance.addPaymentAction(null, form({ receivedAt: "2026-10-10", amountUsd: "50", direction: "in", category: "feed_access", counterparty: email }));

test("Q4: a second paid approve for the same client and tier (re-approve after lapse) writes its payment and NO earning", async () => {
  const referrer = await makeReferrer();
  const { buyer, serverId, requestId } = await pendingRequest(referrer.id);
  await ftr.approveFeedTierRequest(requestId, ADMIN, "", paid(50));
  await lapseGrant(requestId);
  const second = await requestTier(buyer.id, serverId, "ny-normal");
  await ftr.approveFeedTierRequest(second, ADMIN, "", paid(50));
  assert.equal((await paymentFor(second)).length, 1, "the second payment is still recorded");
  const earnings = await earningsFor(buyer.id);
  assert.equal(earnings.length, 1);
  assert.equal(earnings[0].payment_id, (await paymentFor(requestId))[0].id);
});

test("Q4: a clawed-back first earning still counts as the first -- the re-approve on that tier writes none", async () => {
  const referrer = await makeReferrer();
  const { buyer, serverId, requestId } = await pendingRequest(referrer.id);
  await ftr.approveFeedTierRequest(requestId, ADMIN, "", paid(50));
  await referrals.clawbackEarning((await earningsFor(buyer.id))[0].id);
  await lapseGrant(requestId);
  const second = await requestTier(buyer.id, serverId, "ny-normal");
  await ftr.approveFeedTierRequest(second, ADMIN, "", paid(50));
  const earnings = await earningsFor(buyer.id);
  assert.equal(earnings.length, 1);
  assert.equal(earnings[0].status, "clawback");
});

test("Q4: a different tier for the same client earns once, on its own first payment", async () => {
  const referrer = await makeReferrer();
  const { buyer, serverId, requestId } = await pendingRequest(referrer.id);
  await ftr.approveFeedTierRequest(requestId, ADMIN, "", paid(50));
  const fast = await requestTier(buyer.id, serverId, "ny-fast");
  await ftr.approveFeedTierRequest(fast, ADMIN, "", paid(40));
  const earnings = await earningsFor(buyer.id);
  assert.equal(earnings.length, 2);
  const fastPayment = (await paymentFor(fast))[0];
  const fastEarnings = earnings.filter((e) => e.payment_id === fastPayment.id);
  assert.equal(fastEarnings.length, 1);
  assert.equal(Number(fastEarnings[0].amount_usd), 12);
});

test("Q4-1: a Finance feed row after an approve-earning writes NO earning (a tierless row needs no feed earning at all)", async () => {
  const referrer = await makeReferrer();
  const { buyer, requestId } = await pendingRequest(referrer.id);
  await ftr.approveFeedTierRequest(requestId, ADMIN, "", paid(50));
  const result = await financeFeedRow(buyer.email);
  assert.equal(result.ok, true, JSON.stringify(result));
  assert.equal((await financeRows(buyer.email)).length, 1, "the Finance row is kept");
  assert.equal((await earningsFor(buyer.id)).length, 1);
});

test("Q4-1b: a Finance feed row earns first, then a paid approve for the same client writes NO earning", async () => {
  const referrer = await makeReferrer();
  const { buyer, requestId } = await pendingRequest(referrer.id);
  await financeFeedRow(buyer.email);
  assert.equal((await earningsFor(buyer.id)).length, 1, "the Finance row is the first feed earning");
  await ftr.approveFeedTierRequest(requestId, ADMIN, "", paid(50));
  assert.equal((await paymentFor(requestId)).length, 1);
  const earnings = await earningsFor(buyer.id);
  assert.equal(earnings.length, 1);
  assert.equal(earnings[0].payment_id, (await financeRows(buyer.email))[0].id);
});

test("control (pinned): software is untouched by Q4 -- every 'customer' row for the same client earns 30%", async () => {
  const referrer = await makeReferrer();
  const buyer = await makeUser(referrer.id);
  for (let i = 0; i < 2; i++) {
    await finance.addPaymentAction(null, form({ receivedAt: "2026-10-10", amountUsd: "100", direction: "in", category: "customer", counterparty: buyer.email }));
  }
  const earnings = await earningsFor(buyer.id);
  assert.equal(earnings.length, 2);
  assert.deepEqual(earnings.map((e) => Number(e.amount_usd)), [30, 30]);
});
