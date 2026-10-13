/* Run: npx tsx --test src/lib/bundles.test.ts
 *
 * Horizon Complete bundle, slice 1 (plan m66837-9 part 3 T1-T6, T9 + folds m66997/m67030/m67035, Fable combined
 * verdict m67049 C5/C6, 5d-2 C10 = T11). In-memory PGlite on the REAL migration chain (0107 included), the same
 * harness as assign-feed.test.ts. No prod writes. Telegram sends are captured, never made. */
import { test, before, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { PGlite } from "@electric-sql/pglite";

const MIGRATIONS = path.join(process.cwd(), "db/migrations");
const SEED_PROVIDER = "00000000-0000-4000-8000-0000000000a1";
const ADMIN = "00000000-0000-4000-8000-00000000d002";
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
const LD = ["ld-beta-56", "ld-gamma-19", "ld-delta-18"];
const NY = ["ny-fast", "ny-normal"];
const DAY = 24 * 60 * 60 * 1000;

/* eslint-disable @typescript-eslint/no-explicit-any */
let db: any;
let b: typeof import("./bundles");
let lic: typeof import("./licenses");
let fs: typeof import("./feed-subscriptions");

async function replayChain(target: any) {
  const files = readdirSync(MIGRATIONS).filter((f) => f.endsWith(".sql") && !f.includes("rollback")).sort();
  for (const f of files) {
    if (SKIPPED.has(f)) continue;
    if (SEEDS[f]) await target.exec(SEEDS[f]);
    await target.exec(readFileSync(path.join(MIGRATIONS, f), "utf8"));
  }
}

async function sql(text: string, params: unknown[] = []) {
  const r = await db.query(text, params);
  return { rows: r.rows as any[], rowCount: (r.rows.length || r.affectedRows || 0) as number };
}

/** Every Telegram message the code tried to send, by its text. */
let sends: string[] = [];
const sent = (prefix: string) => sends.filter((t) => t.startsWith(prefix)).length;

before(async () => {
  db = new PGlite();
  await replayChain(db);
  (globalThis as any)._pgPool = {
    query: sql,
    connect: async () => ({ query: sql, release() {} }),
    end: async () => {},
  };
  process.env.NEON_DATABASE_URL = "postgres://unused";
  process.env.TELEMETRY_BOT_TOKEN = "test-token";
  (globalThis as any).fetch = async (url: string, init?: { body?: string }) => {
    if (!String(url).includes("api.telegram.org")) throw new Error(`unexpected outbound fetch: ${url}`);
    sends.push(JSON.parse(init?.body ?? "{}").text ?? "");
    return new Response(JSON.stringify({ ok: true }), { status: 200 });
  };
  b = await import("./bundles");
  lic = await import("./licenses");
  fs = await import("./feed-subscriptions");
  await db.query(`insert into users (id, email, role) values ($1, 'hfthorizon@keemail.me', 'admin')`, [ADMIN]);
});

beforeEach(async () => {
  sends = [];
  await setShare({ "ld-base": 3000, "ny-base": 3000 });
});

async function setShare(value: unknown) {
  await db.query(`delete from portal_config where key = 'bundle_feed_share_cents'`);
  if (value !== null) await db.query(`insert into portal_config (key, value) values ('bundle_feed_share_cents', $1)`, [JSON.stringify(value)]);
}

let seq = 0;
async function makeUser(email?: string): Promise<string> {
  seq++;
  return (await db.query(`insert into users (email) values ($1) returning id`, [email ?? `bundleclient${seq}@example.invalid`])).rows[0].id;
}

async function makeLicence(userId: string, opts: { tier?: string; days?: number; feeds?: string[] } = {}): Promise<string> {
  seq++;
  return (
    await db.query(
      `insert into licenses (user_id, license_key, expires_at, feed_types, tier) values ($1, $2, now() + make_interval(days => $3), $4, $5) returning id`,
      [userId, `HHFT-BNDL${seq}-KEY-${seq}`, opts.days ?? 30, opts.feeds ?? [], opts.tier ?? "paid"]
    )
  ).rows[0].id;
}

async function makeServer(licenceId: string, userId: string): Promise<string> {
  seq++;
  return (
    await db.query(
      `insert into server_registrations (license_id, user_id, server_name, vps_provider, server_location, declared_ip)
       values ($1, $2, $3, 'other', 'London', $4) returning id`,
      [licenceId, userId, `bundle-box-${seq}`, `198.51.100.${seq % 250}`]
    )
  ).rows[0].id;
}

const paid = (userId: string, extra: Partial<import("./bundles").ActivateBundleArgs> = {}) =>
  b.activateBundle({
    actorUserId: ADMIN,
    userId,
    bundleKey: "horizon-complete",
    feedChoice: "ld-base",
    termDays: 30,
    isTrial: false,
    amountUsd: 100,
    ...extra,
  });

async function counts(userId: string) {
  return (
    await db.query(
      `select
         (select count(*) from licenses where user_id = $1)::int as licences,
         (select count(*) from bundle_subscriptions where user_id = $1)::int as bundles,
         (select count(*) from payments where user_id = $1)::int as payments,
         (select count(*) from feed_subscriptions where subscriber_user_id = $1)::int as subs,
         (select count(*) from feed_allowlist_records a join server_registrations sr on sr.id = a.server_registration_id where sr.user_id = $1)::int as allow`,
      [userId]
    )
  ).rows[0];
}

async function subs(userId: string) {
  return (
    await db.query(
      `select s.id, ft.tier_key, s.status, s.bundle_subscription_id, s.price_cents, s.ends_at, s.license_id, s.updated_at,
              (${fs.EFFECTIVE_STATUS_SQL}) as effective
       from feed_subscriptions s left join feed_tiers ft on ft.id = s.feed_tier_id
       where s.subscriber_user_id = $1 order by ft.tier_key`,
      [userId]
    )
  ).rows;
}

async function allowlist(serverId: string) {
  return (
    await db.query(
      `select ft.tier_key, a.revoked_at, a.revoked_by from feed_allowlist_records a join feed_tiers ft on ft.id = a.feed_tier_id
       where a.server_registration_id = $1 order by ft.tier_key, a.told_at`,
      [serverId]
    )
  ).rows;
}

async function rejectsWith(p: Promise<unknown>, name: string) {
  await assert.rejects(p, (err: Error) => {
    assert.equal(err.name, name, err.message);
    return true;
  });
}

test("T1 activate, new licence: licence + bundle + ONE 'bundle' payment in one tx; zero auto rows; exactly one activation notify; referral parked", async () => {
  const referrer = await makeUser();
  const u = await makeUser();
  await db.query(`update users set referred_by_user_id = $2 where id = $1`, [u, referrer]);

  const r = await paid(u);
  await lic.settleLicenseBackgroundTasks();

  assert.equal(r.outcome, "new-licence");
  assert.equal(r.feed, null, "no server yet: the feed waits (F3)");
  const l = (await db.query(`select tier, status, feed_types, expires_at from licenses where id = $1`, [r.licenseId])).rows[0];
  assert.equal(l.tier, "paid");
  assert.equal(l.status, "active");
  assert.deepEqual(l.feed_types, ["london"]);
  assert.ok(Math.abs(new Date(l.expires_at).getTime() - (Date.now() + 30 * DAY)) < 60_000);

  const bundle = (await db.query(`select * from bundle_subscriptions where id = $1`, [r.bundleId])).rows[0];
  assert.equal(bundle.status, "active");
  assert.equal(bundle.license_adopted, false);
  assert.equal(bundle.is_trial, false);
  assert.equal(bundle.end_mode, null);
  assert.equal(bundle.activated_by, ADMIN);
  assert.equal(bundle.license_id, r.licenseId);

  const pays = (await db.query(`select category, amount_usd, bundle_subscription_id, created_by, direction from payments where user_id = $1`, [u])).rows;
  assert.equal(pays.length, 1, "ONE payment, and no auto list-price row");
  assert.equal(pays[0].category, "bundle");
  assert.equal(Number(pays[0].amount_usd), 100);
  assert.equal(pays[0].bundle_subscription_id, r.bundleId);
  assert.equal(pays[0].created_by, ADMIN);
  assert.equal(pays[0].direction, "in");

  assert.equal(sent("💰 new paid signup"), 1, "exactly one activation notify");
  assert.equal(sends.length, 1, "and nothing else");

  const earnings = (await db.query(`select count(*)::int as n from referral_earnings where referred_user_id = $1`, [u])).rows[0].n;
  assert.equal(earnings, 0, "'bundle' is not in REFERRAL_CATEGORIES until coxwell rules the referral split");
});

test("T1/T3 grant: refuses with no server; LD then writes 3 stamped rows + 3 open allowlist records at the configured share", async () => {
  const u = await makeUser();
  const r = await paid(u);
  await rejectsWith(b.grantBundleFeed(r.bundleId), "NoServerForFeedGrantError");
  assert.equal((await counts(u)).subs, 0);

  const server = await makeServer(r.licenseId, u);
  const g = await b.grantBundleFeed(r.bundleId);
  assert.deepEqual(g.stamped.map((s) => [s.tierKey, s.outcome]), LD.map((k) => [k, "created"]));
  assert.deepEqual(g.covered, []);
  const rows = await subs(u);
  const expires = (await db.query(`select expires_at from licenses where id = $1`, [r.licenseId])).rows[0].expires_at;
  assert.equal(rows.length, 3);
  for (const s of rows) {
    assert.equal(s.bundle_subscription_id, r.bundleId);
    assert.equal(s.price_cents, 3000, "the feed share, written explicitly on every member");
    assert.equal(s.status, "active");
    assert.equal(s.effective, "active");
    assert.equal(s.license_id, r.licenseId);
    assert.equal(new Date(s.ends_at).getTime(), new Date(expires).getTime());
  }
  const al = await allowlist(server);
  assert.deepEqual(al.map((a: any) => [a.tier_key, a.revoked_at]), [...LD].sort().map((k) => [k, null]));

  const again = await b.grantBundleFeed(r.bundleId);
  assert.deepEqual(again.stamped.map((s) => s.outcome), ["refreshed", "refreshed", "refreshed"]);
  assert.equal((await counts(u)).subs, 3, "idempotent: no second row");
  assert.equal((await allowlist(server)).length, 3, "no second allowlist record");
});

test("T3 NY writes 2 stamped rows + 2 allowlist records", async () => {
  const u = await makeUser();
  const l = await makeLicence(u);
  const server = await makeServer(l, u);
  const r = await paid(u, { feedChoice: "ny-base" });
  assert.equal(r.outcome, "adopted-paid");
  assert.deepEqual(r.feed?.stamped.map((s) => s.tierKey), NY);
  assert.equal((await subs(u)).filter((s: any) => s.bundle_subscription_id === r.bundleId).length, 2);
  assert.equal((await allowlist(server)).length, 2);
});

test("T3 one provider-less member rolls the whole grant back: zero rows", async () => {
  const u = await makeUser();
  const r = await paid(u);
  await makeServer(r.licenseId, u);
  await db.query(`update feed_tiers set provider_user_id = null where tier_key = 'ld-delta-18'`);
  try {
    await rejectsWith(b.grantBundleFeed(r.bundleId), "FeedTierNotAssignedError");
    const c = await counts(u);
    assert.equal(c.subs, 0);
    assert.equal(c.allow, 0);
  } finally {
    await db.query(`update feed_tiers set provider_user_id = $1 where tier_key = 'ld-delta-18'`, [SEED_PROVIDER]);
  }
});

test("T3 2 active licences: the grant follows the bundle's licence and never throws MultipleActive; a non-live licence refuses", async () => {
  const u = await makeUser();
  const l1 = await makeLicence(u, { days: 60 });
  const l2 = await makeLicence(u, { days: 20 });
  await makeServer(l1, u);
  const s2 = await makeServer(l2, u);
  await rejectsWith(paid(u), "BundleLicencePickRequiredError");
  assert.equal((await counts(u)).bundles, 0, "refused before any write");

  const r = await paid(u, { licenseId: l2 });
  assert.equal(r.licenseId, l2);
  assert.equal(r.feed?.stamped.length, 3);
  for (const s of await subs(u)) assert.equal(s.license_id, l2);
  assert.equal((await allowlist(s2)).length, 3);

  await db.query(`update licenses set expires_at = now() - interval '1 day' where id = $1`, [l2]);
  await rejectsWith(b.grantBundleFeed(r.bundleId), "BundleLicenceNotLiveError");
});

test("T-S2 plain assign refuses a live row of an active bundle; after End it reactivates the ex-bundle row and clears the stamp", async () => {
  const u = await makeUser();
  const l = await makeLicence(u, { feeds: ["london"] });
  await makeServer(l, u);
  const r = await paid(u);
  await rejectsWith(fs.assignFeedTierSubscription(u, "ld-beta-56"), "BundleOwnedTierGrantError");
  assert.equal((await subs(u)).find((s: any) => s.tier_key === "ld-beta-56").bundle_subscription_id, r.bundleId, "refusal wrote nothing");

  await b.endBundle({ actorUserId: ADMIN, bundleId: r.bundleId, mode: "unbundle" });
  const g = await fs.assignFeedTierSubscription(u, "ld-beta-56");
  assert.equal(g.outcome, "reactivated");
  const row = (await subs(u)).find((s: any) => s.tier_key === "ld-beta-56");
  assert.equal(row.status, "active");
  assert.equal(row.bundle_subscription_id, null, "re-sold separately: no longer the bundle's row");
});

test("T-S1 a live row the client holds separately is covered: never stamped or updated, and End never reaches it", async () => {
  const u = await makeUser();
  const l = await makeLicence(u, { feeds: ["london"] });
  const server = await makeServer(l, u);
  await fs.assignFeedTierSubscription(u, "ld-beta-56");
  const before = (await subs(u))[0];

  const r = await paid(u);
  assert.deepEqual(r.feed?.covered.map((c) => c.tierKey), ["ld-beta-56"]);
  assert.deepEqual(r.feed?.stamped.map((s) => s.tierKey), ["ld-gamma-19", "ld-delta-18"]);
  const after = (await subs(u)).find((s: any) => s.tier_key === "ld-beta-56");
  assert.equal(after.bundle_subscription_id, null);
  assert.equal(new Date(after.updated_at).getTime(), new Date(before.updated_at).getTime(), "no UPDATE on a covered row");
  assert.equal(after.price_cents, null);

  await b.endBundle({ actorUserId: ADMIN, bundleId: r.bundleId, mode: "unbundle" });
  const rows = await subs(u);
  assert.equal(rows.find((s: any) => s.tier_key === "ld-beta-56").effective, "active", "covered row untouched by End");
  const al = await allowlist(server);
  assert.equal(al.find((a: any) => a.tier_key === "ld-beta-56").revoked_at, null);
  assert.ok(al.filter((a: any) => a.tier_key !== "ld-beta-56").every((a: any) => a.revoked_by === "bundle-end"));
});

test("T4 one clock: past expiry every stamped row reads EFFECTIVE lapsed; Renew makes them active again with ends_at = the new expiry", async () => {
  const u = await makeUser();
  const l = await makeLicence(u);
  await makeServer(l, u);
  const r = await paid(u);
  await db.query(`update licenses set expires_at = now() - interval '2 days' where id = $1`, [l]);
  for (const s of await subs(u)) {
    assert.equal(s.status, "active", "no write on expiry");
    assert.equal(s.effective, "lapsed");
  }

  const renewed = await b.renewBundle({ actorUserId: ADMIN, bundleId: r.bundleId, termDays: 30, amountUsd: 100 });
  assert.ok(Math.abs(new Date(renewed.expiresAt).getTime() - (Date.now() + 30 * DAY)) < 60_000, "from now, since it had expired");
  for (const s of await subs(u)) {
    assert.equal(s.effective, "active");
    assert.equal(new Date(s.ends_at).getTime(), new Date(renewed.expiresAt).getTime());
  }
  const pays = (await db.query(`select category, bundle_subscription_id from payments where user_id = $1`, [u])).rows;
  assert.equal(pays.length, 2);
  assert.ok(pays.every((p: any) => p.category === "bundle" && p.bundle_subscription_id === r.bundleId));
  assert.equal(sends.length, 0, "renew notifies no one");
});

test("T5 unbundle: licence stays active, the other region's unstamped Base stays active, stamped rows lapse with revoked_by 'bundle-end'; zero notifies", async () => {
  const u = await makeUser();
  const l = await makeLicence(u, { feeds: ["ny"] });
  const server = await makeServer(l, u);
  await fs.assignFeedTierSubscription(u, "ny-fast");
  await fs.assignFeedTierSubscription(u, "ny-normal");
  const r = await paid(u);
  assert.equal(r.outcome, "adopted-paid");

  await rejectsWith(b.endBundle({ actorUserId: ADMIN, bundleId: r.bundleId, mode: "cancel" }), "BundleCancelRefusedError");
  assert.equal((await db.query(`select status from bundle_subscriptions where id = $1`, [r.bundleId])).rows[0].status, "active");

  sends = [];
  const e = await b.endBundle({ actorUserId: ADMIN, bundleId: r.bundleId, mode: "unbundle", reason: "client asked" });
  assert.equal(e.lapsedRows, 3);
  assert.equal(e.allowlistRevoked, 3);
  assert.equal((await db.query(`select status, revoked_at from licenses where id = $1`, [l])).rows[0].status, "active");
  for (const s of await subs(u)) {
    if (NY.includes(s.tier_key)) {
      assert.equal(s.effective, "active", `${s.tier_key} untouched`);
      assert.equal(s.bundle_subscription_id, null);
    } else {
      assert.equal(s.status, "lapsed");
      assert.equal(s.effective, "lapsed");
    }
  }
  for (const a of await allowlist(server)) {
    if (NY.includes(a.tier_key)) assert.equal(a.revoked_at, null);
    else assert.equal(a.revoked_by, "bundle-end");
  }
  const ended = (await db.query(`select status, end_mode, ended_by, end_reason, ended_at from bundle_subscriptions where id = $1`, [r.bundleId])).rows[0];
  assert.deepEqual([ended.status, ended.end_mode, ended.ended_by, ended.end_reason], ["ended", "unbundle", ADMIN, "client asked"]);
  assert.ok(ended.ended_at);
  assert.equal(sends.length, 0);
  await rejectsWith(b.endBundle({ actorUserId: ADMIN, bundleId: r.bundleId, mode: "unbundle" }), "BundleNotActiveError");
});

test("T5 cancel: refuses while an unstamped live row sits on the licence; then revokes (revoked_at), lapses only stamped rows, one revoked notify", async () => {
  const u = await makeUser();
  const r = await paid(u);
  const server = await makeServer(r.licenseId, u);
  await b.grantBundleFeed(r.bundleId);
  await db.query(`update licenses set feed_types = array['london','ny'] where id = $1`, [r.licenseId]);
  await fs.assignFeedTierSubscription(u, "ny-fast");

  await rejectsWith(b.endBundle({ actorUserId: ADMIN, bundleId: r.bundleId, mode: "cancel" }), "BundleCancelRefusedError");
  assert.equal((await db.query(`select status from licenses where id = $1`, [r.licenseId])).rows[0].status, "active");

  await fs.deactivateFeedTierSubscription(u, "ny-fast");
  sends = [];
  const e = await b.endBundle({ actorUserId: ADMIN, bundleId: r.bundleId, mode: "cancel" });
  assert.equal(e.licenceRevoked, true);
  const l = (await db.query(`select status, revoked_at from licenses where id = $1`, [r.licenseId])).rows[0];
  assert.equal(l.status, "revoked");
  assert.ok(l.revoked_at, "0107 revoked_at written");
  const rows = await subs(u);
  assert.ok(rows.filter((s: any) => LD.includes(s.tier_key)).every((s: any) => s.status === "lapsed"));
  assert.ok((await allowlist(server)).filter((a: any) => LD.includes(a.tier_key)).every((a: any) => a.revoked_by === "bundle-end"));
  assert.equal(sent("🚫 license revoked"), 1);
  assert.equal(sends.length, 1);
});

test("T6 adopt paid: no new licence, expiry extended by the term, region added, zero notifies", async () => {
  const u = await makeUser();
  const l = await makeLicence(u, { days: 10, feeds: ["ny"] });
  const before = (await db.query(`select expires_at from licenses where id = $1`, [l])).rows[0].expires_at;
  const r = await paid(u);
  assert.equal(r.outcome, "adopted-paid");
  assert.equal(r.licenseId, l);
  assert.equal((await counts(u)).licences, 1);
  const after = (await db.query(`select expires_at, feed_types, tier from licenses where id = $1`, [l])).rows[0];
  assert.equal(new Date(after.expires_at).getTime() - new Date(before).getTime(), 30 * DAY);
  assert.deepEqual(after.feed_types, ["ny", "london"]);
  assert.equal(after.tier, "paid");
  assert.equal((await db.query(`select license_adopted from bundle_subscriptions where id = $1`, [r.bundleId])).rows[0].license_adopted, true);
  assert.equal(sends.length, 0);

  // Nothing else is on this licence, so only the adopted rule can refuse: revoking a licence the client held
  // before the bundle stays a licence-page action (5a B2b).
  await rejectsWith(b.endBundle({ actorUserId: ADMIN, bundleId: r.bundleId, mode: "cancel" }), "BundleCancelRefusedError");
  assert.equal((await db.query(`select status from licenses where id = $1`, [l])).rows[0].status, "active");
});

test("T6 adopt trial: tier -> paid, one upgraded notify, zero activation notifies", async () => {
  const u = await makeUser();
  const l = await makeLicence(u, { tier: "trial", days: 5 });
  const r = await paid(u);
  await lic.settleLicenseBackgroundTasks();
  assert.equal(r.outcome, "adopted-trial");
  assert.equal((await db.query(`select tier from licenses where id = $1`, [l])).rows[0].tier, "paid");
  assert.equal(sent("⬆️ license upgraded"), 1);
  assert.equal(sent("💰 new paid signup") + sent("🎁 trial issued"), 0);
  assert.equal(sends.length, 1);
});

test("T2/T6 a throw after the licence write rolls everything back: no licence, tier untouched, no bundle, payment or notify", async () => {
  const fresh = await makeUser();
  await assert.rejects(paid(fresh, { basketRequestId: randomUUID() }));
  const c = await counts(fresh);
  assert.deepEqual([c.licences, c.bundles, c.payments], [0, 0, 0]);

  const trialUser = await makeUser();
  const l = await makeLicence(trialUser, { tier: "trial" });
  await assert.rejects(paid(trialUser, { basketRequestId: randomUUID() }));
  assert.equal((await db.query(`select tier from licenses where id = $1`, [l])).rows[0].tier, "trial");
  const t = await counts(trialUser);
  assert.deepEqual([t.licences, t.bundles, t.payments], [1, 0, 0]);
  await lic.settleLicenseBackgroundTasks();
  assert.equal(sends.length, 0, "a rolled-back activation notified no one");
});

test("Activate refusals: trial onto a licence, a second bundle per client, bad amounts, unknown feed", async () => {
  const u = await makeUser();
  await makeLicence(u);
  await rejectsWith(paid(u, { isTrial: true, amountUsd: null }), "BundleTrialNeedsNoLicenceError");
  await paid(u);
  await rejectsWith(paid(u), "BundleAlreadyActiveError");
  const v = await makeUser();
  await assert.rejects(paid(v, { amountUsd: null }), /amount received/);
  await assert.rejects(paid(v, { amountUsd: 0 }), /above 0/);
  await assert.rejects(paid(v, { isTrial: true, amountUsd: 50 }), /no payment/);
  await assert.rejects(paid(v, { feedChoice: "ld-alpha" as any }), /Unknown feed choice/);
  await assert.rejects(paid(v, { termDays: 0 }), /whole number of days/);
  assert.equal((await counts(v)).licences, 0);
});

test("T11 trial bundle: tier 'trial' licence, no payment, one trial notify; stamped rows price_cents = 0 even with no share config", async () => {
  const u = await makeUser();
  const r = await paid(u, { isTrial: true, amountUsd: null, termDays: 14 });
  assert.equal((await db.query(`select tier from licenses where id = $1`, [r.licenseId])).rows[0].tier, "trial");
  assert.equal(r.paymentId, null);
  assert.equal((await counts(u)).payments, 0);
  assert.equal(sent("🎁 trial issued"), 1);
  assert.equal(sends.length, 1);

  await setShare(null);
  await makeServer(r.licenseId, u);
  await b.grantBundleFeed(r.bundleId);
  const rows = await subs(u);
  assert.equal(rows.length, 3);
  assert.ok(rows.every((s: any) => s.price_cents === 0), "0 explicitly, not NULL and not 3000");
  await rejectsWith(b.renewBundle({ actorUserId: ADMIN, bundleId: r.bundleId, termDays: 30, amountUsd: 100 }), "BundleTrialRenewError");
});

test("T11 a paid bundle with no usable feed share refuses the grant and writes no row (no list-price fallback)", async () => {
  for (const bad of [null, {}, { "ld-base": 0 }, { "ld-base": "3000" }, { "ld-base": 12.5 }]) {
    await setShare(bad);
    const u = await makeUser();
    const l = await makeLicence(u);
    await makeServer(l, u);
    await rejectsWith(paid(u), "BundleFeedShareUnsetError");
    const c = await counts(u);
    assert.deepEqual([c.bundles, c.payments, c.subs], [0, 0, 0], `share ${JSON.stringify(bad)}: whole activation rolled back`);
  }
});

test("C6 Renew refuses a revoked licence before any write; revokeLicense keeps the first revoked_at", async () => {
  const u = await makeUser();
  const r = await paid(u);
  await lic.revokeLicense(r.licenseId);
  const first = (await db.query(`select revoked_at, expires_at from licenses where id = $1`, [r.licenseId])).rows[0];
  assert.ok(first.revoked_at, "revoked outside endBundle: 0107 revoked_at still written");
  await lic.revokeLicense(r.licenseId);
  const second = (await db.query(`select revoked_at from licenses where id = $1`, [r.licenseId])).rows[0];
  assert.equal(new Date(second.revoked_at).getTime(), new Date(first.revoked_at).getTime());

  await rejectsWith(b.renewBundle({ actorUserId: ADMIN, bundleId: r.bundleId, termDays: 30, amountUsd: 100 }), "LicenceRevokedError");
  const after = (await db.query(`select expires_at from licenses where id = $1`, [r.licenseId])).rows[0];
  assert.equal(new Date(after.expires_at).getTime(), new Date(first.expires_at).getTime());
  assert.equal((await counts(u)).payments, 1, "only the activation payment");
});

test("T9 0107 on a fresh chain: uniques, the stamp CHECK, and a rollback that refuses on rows, on a later value and on an absent constraint", async () => {
  const d = new PGlite();
  await replayChain(d);
  const u = (await d.query(`insert into users (email) values ('t9@example.invalid') returning id`)).rows[0] as any;
  const [l1, l2] = await Promise.all(
    ["T9-A", "T9-B"].map(async (k) => ((await d.query(`insert into licenses (user_id, license_key, expires_at) values ($1, $2, now() + interval '30 days') returning id`, [u.id, k])).rows[0] as any).id)
  );
  const ins = (lid: string, extra = "'active', null, null") =>
    d.query(
      `insert into bundle_subscriptions (user_id, bundle_key, feed_choice, license_id, license_adopted, activated_by, status, ended_at, end_mode)
       values ($1, 'horizon-complete', 'ld-base', $2, false, $1, ${extra}) returning id`,
      [u.id, lid]
    );
  await assert.rejects(d.query(`insert into bundle_subscriptions (user_id, bundle_key, feed_choice, license_id, activated_by, status) values ($1, 'horizon-complete', 'ld-base', $2, $1, 'active')`, [u.id, l1]), /license_adopted/, "license_adopted has no default");
  for (const bad of ["'active', now(), null", "'active', null, 'cancel'", "'ended', null, 'cancel'", "'ended', now(), null"]) {
    await assert.rejects(ins(l1, bad), /bundle_subscriptions_ended_stamp/, bad);
  }
  await ins(l1, "'ended', now(), 'unbundle'");
  await ins(l1);
  await assert.rejects(ins(l1), /bundle_subscriptions_license_active_uidx/, "one active bundle per licence");
  await assert.rejects(ins(l2), /bundle_subscriptions_user_active_uidx/, "one active bundle per client (Q-H)");

  const rollback = readFileSync(path.join(MIGRATIONS, "0107_rollback.sql"), "utf8");
  const forward = readFileSync(path.join(MIGRATIONS, "0107_bundle_subscriptions.sql"), "utf8");
  await assert.rejects(d.exec(rollback), /bundle_subscriptions has rows/);
  await d.exec(`rollback; delete from bundle_subscriptions;`);
  await d.exec(`insert into payments (received_at, amount_usd, currency, direction, category) values (now(), 1, 'USD', 'in', 'bundle')`);
  await assert.rejects(d.exec(rollback), /payments has bundle rows/);
  await d.exec(`rollback; delete from payments where category = 'bundle';`);

  await d.exec(`alter table payments drop constraint payments_category_check;
    alter table payments add constraint payments_category_check check (category in ('customer','partner','affiliate','feed_provider','infra','other','referral_payout','feed_access','bundle','nova'))`);
  await assert.rejects(d.exec(rollback), /not the set 0107 created/, "a later 'nova' blocks it");
  await d.exec(`rollback; alter table payments drop constraint payments_category_check;`);
  await assert.rejects(d.exec(rollback), /not the set 0107 created/, "an ABSENT constraint blocks it too (Fable C5)");
  await d.exec(`rollback; alter table payments add constraint payments_category_check check (category in ('bundle','feed_access','referral_payout','other','infra','feed_provider','affiliate','partner','customer'))`);

  await d.exec(rollback);
  const def = ((await d.query(`select pg_get_constraintdef(oid) as def from pg_constraint where conname = 'payments_category_check'`)).rows[0] as any).def;
  assert.ok(!def.includes("bundle") && def.includes("feed_access"));
  const gone = (await d.query(`select count(*)::int as n from information_schema.columns where (table_name, column_name) in (('licenses','revoked_at'),('feed_subscriptions','bundle_subscription_id'),('payments','bundle_subscription_id'))`)).rows[0] as any;
  assert.equal(gone.n, 0);
  assert.equal(((await d.query(`select count(*)::int as n from schema_migrations where version = '0107'`)).rows[0] as any).n, 0);
  await d.exec(forward);
  assert.equal(((await d.query(`select count(*)::int as n from schema_migrations where version = '0107'`)).rows[0] as any).n, 1, "re-applies cleanly");
});
