/* Run: npx tsx --test src/lib/access-requests-admin-trial.test.ts
 *
 * The admin queue's trial on the CME tier, and its length (marcus m57688 + m57759/m57767).
 * Real Postgres, no prod: an in-memory PGlite carries the REAL migration chain from
 * db/migrations, and the shipped lib functions run against it through db.ts's global._pgPool
 * seam. PGlite is a pinned devDependency, so `npm install` is all a clean clone needs. The pin is
 * the last PGlite on PostgreSQL 17, prod's (Neon's) major, so the chain can't pass on SQL prod
 * would reject (Fable m57824). Re-pin when Neon moves to 18.
 *
 * The chain replays every migration file except the rollbacks. Three files carry prod-data
 * preflights; each gets the minimum seed its preflight asserts, and none is edited:
 *   0046 raises unless one named account exists (a payments backfill; seeds that account).
 *   0081 asserts one provider on the LD Base tiers, seven exact user/licence pairs, and inserts
 *        rows against three literal feed_tier ids (seeds all three facts).
 *   0082 asserts provider_pseudonym_counters.next_seq = 13 for one prod provider. It is a
 *        DATA-ONLY backfill of seven prod clients' pseudonyms, no DDL, so it is skipped and
 *        named here rather than faked.
 * Any other failure stops the run. */
import { test, before } from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { PGlite } from "@electric-sql/pglite";

const MIGRATIONS = path.join(process.cwd(), "db/migrations");
const DAY = 24 * 60 * 60 * 1000;

const PIP = "00000000-0000-4000-8000-00000000b001";
const ADMIN = "00000000-0000-4000-8000-00000000b002";
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
  ar: typeof import("./access-requests");
  ftr: typeof import("./feed-tier-requests");
  trials: typeof import("./feed-tier-trials");
  providers: typeof import("./feed-providers");
  cron: typeof import("../app/api/cron/expire-trials/route");
};
const telegramSends: { chatId: string; text: string }[] = [];

async function sql(text: string, params: unknown[] = []) {
  const r = await db.query(text, params);
  // PGlite reports affectedRows 0 for a SELECT, so a read's rowCount is its row count, as pg's is.
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

  // The shipped code's pool, pointed at PGlite. One connection: begin/commit run on it as they
  // would on a checked-out client, and the tests are sequential.
  (globalThis as any)._pgPool = { query: sql, connect: async () => ({ query: sql, release() {} }) };
  // Capture Telegram sends instead of making them; email has no key and fails closed (best-effort).
  process.env.TELEGRAM_HFT_ALERT_BOT_TOKEN = "test-token";
  process.env.CRON_SECRET = "test-cron";
  delete process.env.AUTH_RESEND_KEY;
  (globalThis as any).fetch = async (url: string, init?: { body?: string }) => {
    if (String(url).includes("/sendMessage") && init?.body) {
      const body = JSON.parse(init.body);
      telegramSends.push({ chatId: String(body.chat_id), text: String(body.text) });
    }
    return new Response(JSON.stringify({ ok: true, result: {} }), { status: 200 });
  };

  lib = {
    ar: await import("./access-requests"),
    ftr: await import("./feed-tier-requests"),
    trials: await import("./feed-tier-trials"),
    providers: await import("./feed-providers"),
    cron: await import("../app/api/cron/expire-trials/route"),
  };

  await sql(`insert into users (id, email, role) values ($1, 'pip@example.invalid', 'feed_provider'), ($2, 'admin@example.invalid', 'admin')`, [PIP, ADMIN]);
  // The CME row is marcus's hand INSERT on prod (provider_tiers dff16179), not a migration.
  await sql(
    `insert into feed_tiers (region_key, tier_key, name, subtitle, speed_display, description, path_redundancy, support_level, provider_user_id)
     values ('cme', 'cme-ctrader-fix', 'CME Futures · cTrader FIX', 'cTrader FIX', '-', 'CME futures', 'Single path', 'Standard', $1)`,
    [PIP]
  );
  await sql(`update feed_tiers set provider_user_id = $1 where tier_key in ('ny-normal', 'ny-fast')`, [PIP]);
});

let buyerSeq = 0;
/** A buyer with a live licence, a Telegram id and one registered server. */
async function makeBuyer() {
  buyerSeq++;
  const u = await sql(`insert into users (email, telegram_user_id) values ($1, $2) returning id`, [`buyer${buyerSeq}@example.invalid`, 9000 + buyerSeq]);
  const userId = u.rows[0].id as string;
  const l = await sql(
    `insert into licenses (user_id, license_key, expires_at) values ($1, $2, now() + interval '60 days') returning id`,
    [userId, `KEY-BUYER-${buyerSeq}`]
  );
  const licenseId = l.rows[0].id as string;
  const s = await sql(
    `insert into server_registrations (license_id, user_id, server_name, vps_provider, server_location, declared_ip)
     values ($1, $2, 'srv', 'other', 'Chicago', $3) returning id`,
    [licenseId, userId, `10.0.0.${buyerSeq}`]
  );
  return { userId, licenseId, serverId: s.rows[0].id as string, telegramId: String(9000 + buyerSeq) };
}

async function tierId(tierKey: string): Promise<string> {
  return (await sql(`select id from feed_tiers where tier_key = $1`, [tierKey])).rows[0].id;
}

async function requestOne(buyer: Awaited<ReturnType<typeof makeBuyer>>, tierKey: string): Promise<string> {
  const { requestIds } = await lib.ar.createAccessRequestBatch({
    userId: buyer.userId,
    items: [{ kind: "feed_tier", serverRegistrationId: buyer.serverId, feedTierId: await tierId(tierKey) }],
  });
  return requestIds[0];
}

/** What exists for one envelope after a decision: the envelope, its grant, and the trial mirror row. */
async function stateOf(requestId: string, userId: string, tierKey: string) {
  const envelope = (await sql(`select status, decision, ends_at from access_requests where id = $1`, [requestId])).rows[0];
  const grants = (await sql(`select ends_at from feed_subscriptions where access_request_id = $1`, [requestId])).rows;
  const trials = (await sql(
    `select id, region, tier_key, trial_status, trial_started_at, trial_ends_at from feed_tier_trials where user_id = $1 and tier_key = $2`,
    [userId, tierKey]
  )).rows;
  return { envelope, grants, trials };
}

function assertAbout(actual: Date, expectedMs: number, label: string) {
  assert.ok(Math.abs(new Date(actual).getTime() - expectedMs) < 5 * 60 * 1000, `${label}: ${new Date(actual).toISOString()} vs ${new Date(expectedMs).toISOString()}`);
}

async function runCron() {
  const req = new Request("https://feed.horizonhft.com/api/cron/expire-trials", { headers: { authorization: "Bearer test-cron" } });
  const res = await lib.cron.GET(req as any);
  assert.equal(res.status, 200);
}

/** The admin queue's call, as admin/feed-tier-requests/actions.ts makes it. */
function adminApprove(requestId: string, trialDays?: number) {
  return lib.ftr.approveFeedTierRequest(requestId, ADMIN, "https://feed.horizonhft.com/admin/feed-tier-trials", {
    decision: "trial",
    endsAt: null,
    invoiceRef: null,
    ...(trialDays === undefined ? {} : { trialDays }),
  } as any);
}

test("admin queue: a trial on cme-ctrader-fix is granted AND recorded (default 7 days), visible to the cron and Pip's Trials tab", async () => {
  const buyer = await makeBuyer();
  const id = await requestOne(buyer, "cme-ctrader-fix");
  const t0 = Date.now();
  await adminApprove(id);

  const s = await stateOf(id, buyer.userId, "cme-ctrader-fix");
  assert.equal(s.envelope.status, "approved");
  assert.equal(s.envelope.decision, "trial");
  assertAbout(s.envelope.ends_at, t0 + 7 * DAY, "envelope ends_at");
  assert.equal(s.grants.length, 1);
  assertAbout(s.grants[0].ends_at, t0 + 7 * DAY, "grant ends_at");
  assert.equal(s.trials.length, 1, "the feed_tier_trials mirror row must exist");
  assert.equal(s.trials[0].region, "cme");
  assert.equal(s.trials[0].trial_status, "active");
  assert.equal(new Date(s.trials[0].trial_ends_at).getTime(), new Date(s.envelope.ends_at).getTime(), "mirror ends when the grant ends");

  const pipTrials = await lib.providers.listActiveTrialsForProvider(PIP);
  assert.ok(pipTrials.some((t) => t.id === s.trials[0].id && t.region === "cme"), "on Pip's Trials tab");
});

test("admin queue: a 30-day CME trial ends at day 30 everywhere, the DM says 30, and the cron expires it at day 30, not day 7", async () => {
  const buyer = await makeBuyer();
  const id = await requestOne(buyer, "cme-ctrader-fix");
  const t0 = Date.now();
  await adminApprove(id, 30);

  const s = await stateOf(id, buyer.userId, "cme-ctrader-fix");
  assertAbout(s.envelope.ends_at, t0 + 30 * DAY, "envelope ends_at");
  assertAbout(s.grants[0].ends_at, t0 + 30 * DAY, "grant ends_at");
  assert.equal(s.trials.length, 1);
  assertAbout(s.trials[0].trial_ends_at, t0 + 30 * DAY, "trial_ends_at");
  const dm = telegramSends.filter((m) => m.chatId === buyer.telegramId).map((m) => m.text).join("\n");
  assert.match(dm, /30-day trial/);
  assert.doesNotMatch(dm, /7-day trial/);

  // Advance the clock by moving the row back: day 8, then day 30 + 1h.
  const trialId = s.trials[0].id;
  const shift = (days: number) =>
    sql(`update feed_tier_trials set trial_started_at = trial_started_at - make_interval(days => $2),
           trial_ends_at = trial_ends_at - make_interval(days => $2) where id = $1`, [trialId, days]);
  await shift(8);
  await runCron();
  assert.equal((await sql(`select trial_status from feed_tier_trials where id = $1`, [trialId])).rows[0].trial_status, "active", "still active on day 8");
  await shift(22);
  await sql(`update feed_tier_trials set trial_ends_at = trial_ends_at - interval '1 hour' where id = $1`, [trialId]);
  await runCron();
  assert.equal((await sql(`select trial_status from feed_tier_trials where id = $1`, [trialId])).rows[0].trial_status, "expired", "expired at day 30");
});

test("an admin trial length outside 7/14/30 is refused before anything is written", async () => {
  const buyer = await makeBuyer();
  const id = await requestOne(buyer, "ny-normal");
  await assert.rejects(adminApprove(id, 60));
  await assert.rejects(adminApprove(id, 0));
  const s = await stateOf(id, buyer.userId, "ny-normal");
  assert.equal(s.envelope.status, "pending");
  assert.equal(s.grants.length, 0);
  assert.equal(s.trials.length, 0);
});

test("Telegram card and provider panel (no decision input) on CME still refuse to the queue: nothing granted", async () => {
  const buyer = await makeBuyer();
  const id = await requestOne(buyer, "cme-ctrader-fix");
  await assert.rejects(lib.ftr.approveFeedTierRequest(id, ADMIN, "u"), lib.ar.PaidApprovalNeedsQueueError);
  await assert.rejects(lib.providers.providerApproveFeedTierRequest(PIP, id, "u"), lib.ar.PaidApprovalNeedsQueueError);
  const s = await stateOf(id, buyer.userId, "cme-ctrader-fix");
  assert.equal(s.envelope.status, "pending");
  assert.equal(s.grants.length, 0);
  assert.equal(s.trials.length, 0);
});

test("self-serve trial on CME stays refused, and writes no envelope", async () => {
  const buyer = await makeBuyer();
  await assert.rejects(
    lib.ftr.startSelfServeFeedTierTrial({ userId: buyer.userId, licenseId: buyer.licenseId, region: "cme", tierKey: "cme-ctrader-fix", adminUrl: "u" }),
    lib.trials.TrialNotEligibleError
  );
  assert.equal((await sql(`select count(*)::int as n from access_requests where user_id = $1`, [buyer.userId])).rows[0].n, 0);
});

test("NY unchanged: the Telegram card grants a 7-day trial with its row, and the admin queue's default is 7", async () => {
  const a = await makeBuyer();
  const idA = await requestOne(a, "ny-fast");
  const t0 = Date.now();
  await lib.ftr.approveFeedTierRequest(idA, ADMIN, "u");
  const sA = await stateOf(idA, a.userId, "ny-fast");
  assert.equal(sA.envelope.decision, "trial");
  assertAbout(sA.envelope.ends_at, t0 + 7 * DAY, "telegram ends_at");
  assert.equal(sA.trials.length, 1);
  assertAbout(sA.trials[0].trial_ends_at, t0 + 7 * DAY, "telegram trial_ends_at");

  const b = await makeBuyer();
  const idB = await requestOne(b, "ny-normal");
  await adminApprove(idB);
  const sB = await stateOf(idB, b.userId, "ny-normal");
  assertAbout(sB.envelope.ends_at, t0 + 7 * DAY, "queue default ends_at");
  assert.equal(sB.trials.length, 1);
});

test("a paid approval on CME is untouched: no trial row, ends on the given date", async () => {
  const buyer = await makeBuyer();
  const id = await requestOne(buyer, "cme-ctrader-fix");
  const end = new Date(Date.now() + 30 * DAY);
  await lib.ftr.approveFeedTierRequest(id, ADMIN, "u", { decision: "paid", endsAt: end, invoiceRef: "INV-1" });
  const s = await stateOf(id, buyer.userId, "cme-ctrader-fix");
  assert.equal(s.envelope.decision, "paid");
  assert.equal(new Date(s.grants[0].ends_at).getTime(), end.getTime());
  assert.equal(s.trials.length, 0);
});

// Last: it runs DDL against the shared database.
test("0092_rollback refuses while a CME trial row exists, and leaves the 5-key check in place", async () => {
  const checkDef = async () =>
    (await sql(`select pg_get_constraintdef(oid) as def from pg_constraint where conname = 'feed_tier_trials_tier_key_check'`)).rows[0].def as string;
  assert.ok((await sql(`select 1 from feed_tier_trials where tier_key = 'cme-ctrader-fix'`)).rows.length > 0, "earlier tests left CME rows");
  assert.match(await checkDef(), /cme-ctrader-fix/);
  await assert.rejects(db.exec(readFileSync(path.join(MIGRATIONS, "0092_rollback.sql"), "utf8")), /feed_tier_trials_tier_key_check/);
  await db.exec("rollback");
  assert.match(await checkDef(), /cme-ctrader-fix/);
  assert.equal((await sql(`select count(*)::int as n from schema_migrations where version = '0092'`)).rows[0].n, 1);
});
