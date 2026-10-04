/* Run: npx tsx --test src/lib/basket-requests.test.ts
 *
 * The marketplace request basket (coxwell via marcus m59124, rulings m59146): line validation,
 * the five-source trial predicate, the one-trial index, the Telegram field, the admin toggle and
 * 0093's rollback. Real Postgres, no prod: the same harness as access-requests-admin-trial.test.ts
 * (an in-memory PGlite carrying the REAL migration chain, the shipped lib through db.ts's
 * global._pgPool seam). The three prod-data preflights get the same minimum seeds, named there. */
import { test, before } from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { PGlite } from "@electric-sql/pglite";

const MIGRATIONS = path.join(process.cwd(), "db/migrations");
const SEED_PROVIDER = "00000000-0000-4000-8000-0000000000a1";
const ADMIN = "00000000-0000-4000-8000-00000000c002";
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
let cat: typeof import("./basket-catalogue");
let br: typeof import("./basket-requests");
const telegramSends: { chatId: string; threadId: unknown; text: string; hasButtons: boolean }[] = [];

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
  (globalThis as any)._pgPool = {
    // pg puts a failed statement's SQLSTATE on err.code; PGlite does too, so the unique-violation
    // branch runs as it would on Neon.
    query: sql,
    connect: async () => ({ query: sql, release() {} }),
  };
  process.env.TELEMETRY_BOT_TOKEN = "test-token";
  (globalThis as any).fetch = async (url: string, init?: { body?: string }) => {
    if (String(url).includes("/sendMessage") && init?.body) {
      const body = JSON.parse(init.body);
      telegramSends.push({ chatId: String(body.chat_id), threadId: body.message_thread_id, text: String(body.text), hasButtons: body.reply_markup != null });
    }
    return new Response(JSON.stringify({ ok: true, result: {} }), { status: 200 });
  };
  cat = await import("./basket-catalogue");
  br = await import("./basket-requests");
  await sql(`insert into users (id, email, role) values ($1, 'admin@example.invalid', 'admin')`, [ADMIN]);
});

let seq = 0;
/** A fresh account: no licence, no trial, no Telegram unless asked. */
async function makeUser(opts: { telegram?: boolean; email?: string } = {}) {
  seq++;
  const email = opts.email ?? `client${seq}@example.invalid`;
  const r = await sql(`insert into users (email, telegram_username) values ($1, $2) returning id`, [email, opts.telegram ? `client_${seq}` : null]);
  return { id: r.rows[0].id as string, email };
}
async function licenceFor(userId: string, opts: { status?: string; expired?: boolean } = {}) {
  const r = await sql(
    `insert into licenses (user_id, license_key, status, expires_at) values ($1, $2, $3, now() + $4::interval) returning id`,
    [userId, `KEY-${++seq}`, opts.status ?? "active", opts.expired ? "-1 day" : "60 days"]
  );
  return r.rows[0].id as string;
}
async function serverFor(userId: string, licenseId: string) {
  await sql(
    `insert into server_registrations (license_id, user_id, server_name, vps_provider, server_location, declared_ip)
     values ($1, $2, 'srv', 'other', 'London', $3)`,
    [licenseId, userId, `10.9.0.${++seq}`]
  );
}
const LINES = [
  { kind: "software", key: "horizon-terminal" },
  { kind: "feed", key: "ld-base", servers: 2 },
  { kind: "strategy", key: "1leg" },
];

// ---- lines ----

test("lines: available software, feed and strategy resolve to snapshots with catalogue names", () => {
  const lines = cat.resolveBasketLines(LINES);
  assert.deepEqual(lines.map((l) => [l.kind, l.key, l.servers ?? null]), [
    ["software", "horizon-terminal", null],
    ["feed", "ld-base", 2],
    ["strategy", "1leg", null],
  ]);
  assert.equal(lines[0].name, "Horizon Terminal");
  assert.equal(lines[2].name, "1 LEG — Latency Arbitrage");
  assert.equal(lines[2].note, "Included with a Horizon licence");
  // A feed line with no count is one server.
  assert.equal(cat.resolveBasketLines([{ kind: "feed", key: "ny-base" }])[0].servers, 1);
});

test("lines: Black, Alpha and Ultra are refused server-side, as is anything unknown or mis-kinded", () => {
  for (const key of ["black", "ld-alpha", "ld-ultra"]) {
    assert.throws(() => cat.resolveBasketLines([{ kind: "feed", key }]), cat.BasketLineError, key);
  }
  assert.throws(() => cat.resolveBasketLines([{ kind: "feed", key: "nope" }]), cat.BasketLineError);
  assert.throws(() => cat.resolveBasketLines([{ kind: "software", key: "ld-base" }]), cat.BasketLineError, "a feed sent as software");
  assert.throws(() => cat.resolveBasketLines([{ kind: "feed", key: "horizon-terminal" }]), cat.BasketLineError, "software sent as a feed");
  assert.throws(() => cat.resolveBasketLines([{ kind: "strategy", key: "martingale" }]), cat.BasketLineError);
  assert.throws(() => cat.resolveBasketLines([{ kind: "licence", key: "x" }]), cat.BasketLineError);
});

test("lines: empty, over 20, a repeated product, and bad server counts are refused", () => {
  assert.throws(() => cat.resolveBasketLines([]), cat.BasketLineError);
  assert.throws(() => cat.resolveBasketLines("not an array"), cat.BasketLineError);
  assert.throws(() => cat.resolveBasketLines(Array.from({ length: 21 }, () => ({ kind: "strategy", key: "1leg" }))), cat.BasketLineError);
  assert.throws(() => cat.resolveBasketLines([{ kind: "strategy", key: "obi" }, { kind: "strategy", key: "obi" }]), cat.BasketLineError);
  for (const servers of [0, 21, 1.5, "2", -1]) {
    assert.throws(() => cat.resolveBasketLines([{ kind: "feed", key: "ld-base", servers }]), cat.BasketLineError, String(servers));
  }
});

test("catalogue: what the basket offers is exactly the available listings plus the strategy entries", () => {
  const keys = cat.basketCatalogue().map((e) => `${e.kind}:${e.key}`);
  assert.deepEqual(keys, [
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
});

test("chips: a strategy line's type comes from its catalogue name; feed chips are region and tier only", () => {
  const chips = new Map(cat.basketCatalogue().map((e) => [`${e.kind}:${e.key}`, e.chips]));
  assert.deepEqual(chips.get("strategy:1leg"), ["Strategy Latency Arbitrage"]);
  assert.deepEqual(chips.get("strategy:2leg_lock"), ["Strategy Hedge Arbitrage"]);
  assert.deepEqual(chips.get("strategy:trend_impulse"), ["Strategy Fast-Feed Momentum"]);
  assert.deepEqual(chips.get("strategy:obi"), ["Strategy Order Book Imbalance"]);
  assert.deepEqual(chips.get("strategy:grid"), ["Strategy Progressive Basket"]);
  // No data-centre chip: no catalogue field holds a feed's location (marcus m59367).
  assert.deepEqual(chips.get("feed:ld-base"), ["Region London", "Tier Base"]);
  assert.deepEqual(chips.get("feed:ny-base"), ["Region New York", "Tier Base"]);
});

test("?strategy=: each of www's five slugs lands on its entry; anything else lands on nothing", () => {
  assert.deepEqual(
    ["1-leg", "2-leg-lock", "trend-impulse", "order-book-imbalance", "grid-arbitrage"].map(cat.strategyEntryKeyForSlug),
    ["1leg", "2leg_lock", "trend_impulse", "obi", "grid"],
  );
  for (const slug of [undefined, "", "1leg", "obi", "1-Leg", "constructor", "__proto__", "grid-arbitrage "]) {
    assert.equal(cat.strategyEntryKeyForSlug(slug), null, String(slug));
  }
});

test("See more: each strategy card links to its own www page; the basket line stays unlinked and on the plate; Iris's image per card", () => {
  const strategies = cat.basketCatalogue().filter((e) => e.kind === "strategy");
  assert.deepEqual(
    strategies.map((e) => [e.key, e.aboutHref]),
    [
      ["1leg", "https://www.horizonhft.com/strategies/1-leg"],
      ["2leg_lock", "https://www.horizonhft.com/strategies/2-leg-lock"],
      ["trend_impulse", "https://www.horizonhft.com/strategies/trend-impulse"],
      ["obi", "https://www.horizonhft.com/strategies/order-book-imbalance"],
      ["grid", "https://www.horizonhft.com/strategies/grid-arbitrage"],
    ],
  );
  // The line thumb reads image, so no strategy sets it: the line keeps the plate (marcus m59724).
  for (const e of strategies) {
    assert.equal(e.detailHref, undefined, e.key);
    assert.equal(e.image, undefined, e.key);
  }
  // README card id -> file map (marcus m59654), and every file is in /public.
  const files = { "1leg": "1-leg", "2leg_lock": "2-leg-lock", trend_impulse: "trend-impulse", obi: "obi", grid: "grid-arbitrage" };
  for (const e of strategies) {
    const f = files[e.key as keyof typeof files];
    assert.equal(e.cardImage, `/marketplace/strategies/${f}.png`, e.key);
    assert.equal(e.cardImage2x, `/marketplace/strategies/${f}@2x.png`, e.key);
    for (const p of [e.cardImage!, e.cardImage2x!]) assert.ok(readdirSync(path.join("public", path.dirname(p))).includes(path.basename(p)), p);
  }
});

// ---- trial predicate ----

test("trial: a fresh account is eligible; each of the five sources alone makes it ineligible", async () => {
  const fresh = await makeUser();
  assert.equal(await br.isBasketTrialEligible(fresh.id), true);

  // 1a. a licence on the account, even a revoked or expired one ("never had").
  for (const opts of [{}, { status: "revoked" }, { expired: true }]) {
    const u = await makeUser();
    await licenceFor(u.id, opts);
    assert.equal(await br.isBasketTrialEligible(u.id), false, `licence ${JSON.stringify(opts)}`);
  }
  // 1b. an unclaimed licence issued to their email, matched case-insensitively.
  const claimed = await makeUser({ email: "Mixed.Case@example.invalid" });
  await sql(`insert into licenses (claim_email, license_key, expires_at) values ('mixed.case@EXAMPLE.invalid', 'KEY-CLAIM', now() + interval '30 days')`);
  assert.equal(await br.isBasketTrialEligible(claimed.id), false, "unclaimed licence by email");
  // 2. an access_requests row decided as a trial.
  const ar = await makeUser();
  await sql(`insert into access_requests (user_id, product_kind, batch_id, status, decision) values ($1, 'feed_tier', gen_random_uuid(), 'approved', 'trial')`, [ar.id]);
  assert.equal(await br.isBasketTrialEligible(ar.id), false, "access_requests trial");
  // ...but a paid decision or a pending request is not a trial.
  const arPaid = await makeUser();
  await sql(`insert into access_requests (user_id, product_kind, batch_id, status, decision) values ($1, 'feed_tier', gen_random_uuid(), 'approved', 'paid'), ($1, 'feed_tier', gen_random_uuid(), 'pending', null)`, [arPaid.id]);
  assert.equal(await br.isBasketTrialEligible(arPaid.id), true, "paid / pending are not trials");
  // 3. a feed_tier_trials row. Its licence is the seeded one's shape; the row alone is the test,
  // so it borrows another account's licence rather than giving this one a licence (source 1).
  const ftt = await makeUser();
  const otherLicence = await licenceFor((await makeUser()).id);
  await sql(`insert into feed_tier_trials (user_id, license_id, region, tier_key, trial_ends_at) values ($1, $2, 'london', 'ld-alpha-85', now() + interval '7 days')`, [ftt.id, otherLicence]);
  assert.equal(await br.isBasketTrialEligible(ftt.id), false, "feed_tier_trials");
  // 4. a black_trials row (same licence trick).
  const bt = await makeUser();
  const otherLicence2 = await licenceFor((await makeUser()).id);
  await sql(`insert into black_trials (user_id, license_id) values ($1, $2)`, [bt.id, otherLicence2]);
  assert.equal(await br.isBasketTrialEligible(bt.id), false, "black_trials");
  // 5. an earlier basket with the trial; a basket without one doesn't count.
  const b5 = await makeUser({ telegram: true });
  await br.createBasketRequest({ userId: b5.id, lines: LINES, wantTrial: false });
  assert.equal(await br.isBasketTrialEligible(b5.id), true, "a trial-less basket keeps eligibility");
  await br.createBasketRequest({ userId: b5.id, lines: LINES, wantTrial: true });
  assert.equal(await br.isBasketTrialEligible(b5.id), false, "an earlier basket trial");
});

// ---- create ----

test("create: one row with the snapshot, one approvals-topic card, no envelope, no licence, nothing granted", async () => {
  const u = await makeUser({ telegram: true });
  const before = telegramSends.length;
  const counts = async () =>
    (await sql(`select (select count(*)::int from access_requests) a, (select count(*)::int from licenses) l,
                       (select count(*)::int from feed_subscriptions) s, (select count(*)::int from feed_tier_trials) t`)).rows[0];
  const c0 = await counts();
  const { id } = await br.createBasketRequest({ userId: u.id, lines: LINES, wantTrial: true });

  const row = (await sql(`select * from basket_requests where id = $1`, [id])).rows[0];
  assert.equal(row.user_id, u.id);
  assert.equal(row.status, "new");
  assert.equal(row.has_trial, true);
  assert.equal(row.handled_at, null);
  assert.equal(row.telegram_handle, null, "Telegram on file: nothing copied onto the row");
  assert.deepEqual(row.lines, [
    { kind: "software", key: "horizon-terminal", name: "Horizon Terminal" },
    { kind: "feed", key: "ld-base", name: "London · Base", servers: 2, note: "no licence/server yet" },
    { kind: "strategy", key: "1leg", name: "1 LEG — Latency Arbitrage", note: "Included with a Horizon licence" },
  ]);
  assert.deepEqual(await counts(), c0, "no access_requests / licence / subscription / trial row written");

  const sent = telegramSends.slice(before);
  assert.equal(sent.length, 1, "exactly one card");
  assert.equal(sent[0].chatId, "-1003914182493", "the approvals chat");
  assert.ok(sent[0].threadId != null, "the approvals topic");
  assert.equal(sent[0].hasButtons, false, "no Approve/Decline");
  assert.equal(
    sent[0].text,
    [
      `🧺 new basket request ${br.basketReference(id)}`,
      `email: ${u.email}`,
      `telegram: @client_${u.email.match(/client(\d+)/)![1]}`,
      `lines (3):`,
      `• Horizon Terminal (software)`,
      `• London · Base (feed, 2 servers): no licence/server yet`,
      `• 1 LEG — Latency Arbitrage (strategy)`,
      `trial: 30-day trial requested (first on this account)`,
      `nothing granted, fulfil by hand then mark handled:`,
      `https://portal.horizonhft.com/admin/basket-requests`,
    ].join("\n")
  );
});

test("create: a feed line says 'ready' only for an active licence with a registered server", async () => {
  const u = await makeUser({ telegram: true });
  const lic = await licenceFor(u.id);
  const noServer = await br.createBasketRequest({ userId: u.id, lines: [{ kind: "feed", key: "ny-base" }], wantTrial: false });
  assert.equal(noServer.lines[0].note, "no licence/server yet", "licence but no server");
  await serverFor(u.id, lic);
  const ready = await br.createBasketRequest({ userId: u.id, lines: [{ kind: "feed", key: "ny-base" }], wantTrial: false });
  assert.equal(ready.lines[0].note, "ready (licence + server)");
  assert.match(telegramSends.at(-1)!.text, /trial: none/);
});

test("create: Black in a basket is refused before anything is written or sent", async () => {
  const u = await makeUser({ telegram: true });
  const before = telegramSends.length;
  await assert.rejects(
    br.createBasketRequest({ userId: u.id, lines: [{ kind: "software", key: "horizon-terminal" }, { kind: "feed", key: "black" }], wantTrial: false }),
    cat.BasketLineError
  );
  assert.equal((await sql(`select count(*)::int n from basket_requests where user_id = $1`, [u.id])).rows[0].n, 0);
  assert.equal(telegramSends.length, before);
});

test("trial: an ineligible account's trial is refused and nothing is written", async () => {
  const u = await makeUser({ telegram: true });
  await licenceFor(u.id, { expired: true });
  await assert.rejects(br.createBasketRequest({ userId: u.id, lines: LINES, wantTrial: true }), br.TrialNotEligibleError);
  assert.equal((await sql(`select count(*)::int n from basket_requests where user_id = $1`, [u.id])).rows[0].n, 0);
  // The same basket without the trial goes through.
  await br.createBasketRequest({ userId: u.id, lines: LINES, wantTrial: false });
});

test("trial: two trial baskets from one account: the second is refused, and the index holds even if the read is skipped", async () => {
  const u = await makeUser({ telegram: true });
  await br.createBasketRequest({ userId: u.id, lines: LINES, wantTrial: true });
  await assert.rejects(br.createBasketRequest({ userId: u.id, lines: LINES, wantTrial: true }), br.TrialNotEligibleError);
  // A double submit that passed the eligibility read twice reaches the INSERT twice: the partial
  // unique index is what stops the second.
  await assert.rejects(
    sql(`insert into basket_requests (user_id, lines, has_trial) values ($1, '[{"kind":"strategy","key":"obi","name":"x"}]', true)`, [u.id]),
    /basket_requests_one_trial_per_user_uidx/
  );
  assert.equal((await sql(`select count(*)::int n from basket_requests where user_id = $1 and has_trial`, [u.id])).rows[0].n, 1);
  // Trial-less baskets are unlimited.
  await sql(`insert into basket_requests (user_id, lines) values ($1, '[{"kind":"strategy","key":"obi","name":"x"}]'), ($1, '[{"kind":"strategy","key":"obi","name":"x"}]')`, [u.id]);
});

test("Telegram: required (and valid) only when the account has none; stored on the row, never on users", async () => {
  const u = await makeUser();
  await assert.rejects(br.createBasketRequest({ userId: u.id, lines: LINES, wantTrial: false }), br.TelegramHandleRequiredError);
  await assert.rejects(br.createBasketRequest({ userId: u.id, lines: LINES, wantTrial: false, telegramHandle: "@ab" }), br.TelegramHandleRequiredError);
  await assert.rejects(br.createBasketRequest({ userId: u.id, lines: LINES, wantTrial: false, telegramHandle: "has space" }), br.TelegramHandleRequiredError);
  const { id } = await br.createBasketRequest({ userId: u.id, lines: LINES, wantTrial: false, telegramHandle: " @Real_Handle1 " });
  assert.equal((await sql(`select telegram_handle from basket_requests where id = $1`, [id])).rows[0].telegram_handle, "Real_Handle1");
  assert.equal((await sql(`select telegram_username from users where id = $1`, [u.id])).rows[0].telegram_username, null);
  assert.match(telegramSends.at(-1)!.text, /telegram: @Real_Handle1/);
  const [listed] = await br.listBasketRequests({ userId: u.id });
  assert.equal(listed.telegram, "Real_Handle1");
  // A handle typed by an account that already has one is ignored.
  const v = await makeUser({ telegram: true });
  const r = await br.createBasketRequest({ userId: v.id, lines: LINES, wantTrial: false, telegramHandle: "someone_else" });
  assert.equal((await sql(`select telegram_handle from basket_requests where id = $1`, [r.id])).rows[0].telegram_handle, null);
});

// ---- admin ----

test("admin: mark handled stamps who/when, back to new clears both; the check forbids a half-stamped row", async () => {
  const u = await makeUser({ telegram: true });
  const { id } = await br.createBasketRequest({ userId: u.id, lines: LINES, wantTrial: false });
  assert.deepEqual(await br.setBasketRequestHandled(id, ADMIN, true), { userId: u.id });
  let row = (await sql(`select status, handled_at, handled_by from basket_requests where id = $1`, [id])).rows[0];
  assert.equal(row.status, "handled");
  assert.ok(row.handled_at);
  assert.equal(row.handled_by, ADMIN);
  assert.equal(await br.setBasketRequestHandled(id, ADMIN, true), null, "already handled: no change");
  const [listed] = (await br.listBasketRequests({ status: "handled" })).filter((r) => r.id === id);
  assert.equal(listed.handledByEmail, "admin@example.invalid");

  assert.deepEqual(await br.setBasketRequestHandled(id, ADMIN, false), { userId: u.id });
  row = (await sql(`select status, handled_at, handled_by from basket_requests where id = $1`, [id])).rows[0];
  assert.deepEqual([row.status, row.handled_at, row.handled_by], ["new", null, null]);

  await assert.rejects(sql(`update basket_requests set status = 'handled' where id = $1`, [id]), /basket_requests_handled_stamp/);
  await assert.rejects(sql(`update basket_requests set status = 'approved' where id = $1`, [id]), /basket_requests_status_check/);
  await assert.rejects(sql(`insert into basket_requests (user_id, lines) values ($1, '[]')`, [u.id]), /basket_requests_lines_check/);
});

test("lists: a client sees only their own requests, newest first; the admin list filters by status", async () => {
  const a = await makeUser({ telegram: true });
  const b = await makeUser({ telegram: true });
  const first = await br.createBasketRequest({ userId: a.id, lines: [{ kind: "strategy", key: "grid" }], wantTrial: false });
  await sql(`update basket_requests set submitted_at = now() - interval '1 hour' where id = $1`, [first.id]);
  const second = await br.createBasketRequest({ userId: a.id, lines: [{ kind: "strategy", key: "obi" }], wantTrial: false });
  await br.createBasketRequest({ userId: b.id, lines: [{ kind: "strategy", key: "obi" }], wantTrial: false });
  const mine = await br.listBasketRequests({ userId: a.id });
  assert.deepEqual(mine.map((r) => r.id), [second.id, first.id]);
  assert.match(mine[0].reference, /^REQ-[0-9A-F]{8}$/);
  const news = await br.listBasketRequests({ status: "new" });
  assert.ok(news.every((r) => r.status === "new"));
  assert.ok(news.some((r) => r.userId === b.id));
});

// Last: it runs DDL against the shared database.
test("0093_rollback drops the table and its ledger row", async () => {
  assert.equal((await sql(`select count(*)::int n from schema_migrations where version = '0093'`)).rows[0].n, 1);
  await db.exec(readFileSync(path.join(MIGRATIONS, "0093_rollback.sql"), "utf8"));
  assert.equal((await sql(`select to_regclass('basket_requests') as t`)).rows[0].t, null);
  assert.equal((await sql(`select count(*)::int n from schema_migrations where version = '0093'`)).rows[0].n, 0);
});
