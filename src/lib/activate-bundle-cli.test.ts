/* Run: npx tsx --test --experimental-test-module-mocks src/lib/activate-bundle-cli.test.ts
 *
 * scripts/activate-bundle.mts (plan m69164 section 4, BUILD GO marcus m69165): T-A the dry run writes nothing;
 * T-B execute writes 1 licence, 1 bundle, 0 or 1 payment and 1 key delivery row, by EMAIL for a client with no
 * Telegram (fails if step 2, the key send, is dropped); T-C the basket row reads handled. Plus the refusals,
 * --grant-feed (step 2), the script itself, and a send the provider refuses (Fable S1 m69343: KEY SEND FAILED, exit 1).
 * In-memory PGlite on the REAL migration chain, the bundles.test.ts harness: a pool query while a client holds an
 * open transaction THROWS, so nothing here can escape activateBundle's tx unseen. Sends are captured, never made. */
import { test, before, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
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
const ENV = {
  NEON_DATABASE_URL: "postgres://unused",
  HORIZON_PORTAL_BOT_TOKEN: "portal-token",
  AUTH_RESEND_KEY: "re_test",
  EMAIL_FROM: "Horizon <noreply@example.invalid>",
  TELEMETRY_BOT_TOKEN: "telemetry-token",
};
const DAY = 24 * 60 * 60 * 1000;

/* eslint-disable @typescript-eslint/no-explicit-any */
let db: any;
let cli: typeof import("./activate-bundle-cli");
let at: typeof import("./assign-trial");
let lic: typeof import("./licenses");
let actorId = "";
let poolEnded = false;
let portalThrows = false;
/** Resend answers 422, as in Fable's probe 2 (m69343): sendEmail returns ok:false, nothing throws. */
let emailRefused = false;
const sends: { kind: "portal" | "telemetry" | "email"; to: string; text: string; subject?: string }[] = [];

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
  let openTx = 0;
  const clientQuery = async (text: string, params: unknown[] = []) => {
    const verb = text.trim().toLowerCase();
    if (verb === "begin") openTx++;
    const r = await sql(text, params);
    if (verb === "commit" || verb === "rollback") openTx--;
    return r;
  };
  (globalThis as any)._pgPool = {
    query: async (text: string, params: unknown[] = []) => {
      if (openTx > 0) throw new Error(`pool query inside an open transaction: ${text.trim().slice(0, 80)}`);
      return sql(text, params);
    },
    connect: async () => ({ query: clientQuery, release() {} }),
    end: async () => {
      poolEnded = true;
    },
  };
  Object.assign(process.env, ENV);
  (globalThis as any).fetch = async (url: string, init?: { body?: string }) => {
    const u = String(url);
    const body = init?.body ? JSON.parse(init.body) : {};
    if (u.includes(`/bot${ENV.HORIZON_PORTAL_BOT_TOKEN}/sendMessage`)) {
      if (portalThrows) throw new TypeError("fetch failed");
      sends.push({ kind: "portal", to: String(body.chat_id), text: body.text });
    } else if (u.includes(`/bot${ENV.TELEMETRY_BOT_TOKEN}/sendMessage`)) {
      sends.push({ kind: "telemetry", to: String(body.chat_id), text: body.text });
    } else if (u.includes("resend.com")) {
      if (emailRefused) {
        return new Response(JSON.stringify({ statusCode: 422, name: "validation_error", message: "Invalid `to` field." }), {
          status: 422,
          headers: { "content-type": "application/json" },
        });
      }
      sends.push({ kind: "email", to: [body.to].flat().join(","), text: body.text, subject: body.subject });
    } else {
      throw new Error(`unexpected outbound fetch: ${u}`);
    }
    return new Response(JSON.stringify({ ok: true, result: { message_id: 4242 }, id: "email-id" }), { status: 200 });
  };
  cli = await import("./activate-bundle-cli");
  at = await import("./assign-trial");
  lic = await import("./licenses");
  await sql(`insert into users (id, email, role) values ($1, 'hfthorizon@keemail.me', 'admin')`, [ADMIN]);
  await db.exec(readFileSync(path.join(process.cwd(), "scripts/seed-agent-actor.sql"), "utf8"));
  actorId = (await sql(`select id from users where email = $1`, [at.AGENT_ACTOR_EMAIL])).rows[0].id;
});

beforeEach(async () => {
  await sql(`delete from portal_config where key = 'bundle_feed_share_cents'`);
});

let seq = 0;
/** A client like Albin (m69164): email, no Telegram, unless asked. */
async function makeUser(opts: { telegram?: boolean; email?: string | null } = {}) {
  seq++;
  const email = opts.email === undefined ? `bundlecli${seq}@example.invalid` : opts.email;
  const tg = opts.telegram ? 8000 + seq : null;
  const r = await sql(`insert into users (email, telegram_user_id) values ($1, $2) returning id`, [email, tg]);
  return { id: r.rows[0].id as string, email, telegramId: tg === null ? null : String(tg) };
}

async function makeBasket(userId: string, line: Record<string, unknown> = { kind: "bundle", key: "horizon-complete", name: "Horizon Complete (feed: London · Base)", feed: "ld-base" }) {
  return (await sql(`insert into basket_requests (user_id, lines) values ($1, $2) returning id`, [userId, JSON.stringify([line])])).rows[0].id as string;
}

async function makeServer(licenceId: string, userId: string) {
  seq++;
  return (
    await sql(
      `insert into server_registrations (license_id, user_id, server_name, vps_provider, server_location, declared_ip)
       values ($1, $2, $3, 'other', 'London', $4) returning id`,
      [licenceId, userId, `cli-box-${seq}`, `203.0.113.${seq % 250}`]
    )
  ).rows[0].id as string;
}

/** Every table a run can write, plus the sends. */
async function counts() {
  const r = await sql(
    `select (select count(*) from licenses)::int as licences,
            (select count(*) from bundle_subscriptions)::int as bundles,
            (select count(*) from payments)::int as payments,
            (select count(*) from admin_actions)::int as actions,
            (select count(*) from client_notices)::int as notices,
            (select count(*) from feed_subscriptions)::int as subs,
            (select count(*) from basket_requests where status = 'handled')::int as handled`
  );
  return { ...r.rows[0], sends: sends.length };
}

const args = (user: string, basketId: string, extra: Partial<import("./activate-bundle-cli").ActivateArgs> = {}): import("./activate-bundle-cli").ActivateArgs => ({
  mode: "activate",
  user,
  bundleKey: "horizon-complete",
  feedChoice: "ld-base",
  days: 30,
  isTrial: true,
  amountUsd: null,
  receivedAt: null,
  basketId,
  allowRepeatTrial: false,
  allowInternal: false,
  execute: true,
  ...extra,
});

async function deliveryRows(licenceId: string) {
  return (await sql(`select admin_user_id, details_json from admin_actions where target_license_id = $1 and action_type = 'license_key_delivery'`, [licenceId])).rows;
}

test("T-A dry run: reads only -- no row in any table, no send; the plan shows the email channel, the trial text and the args", async () => {
  const u = await makeUser();
  const basketId = await makeBasket(u.id);
  const c0 = await counts();
  const plan = await cli.planActivation(args(u.id, basketId, { execute: false }));
  assert.deepEqual(await counts(), c0, "nothing written, nothing sent");
  assert.deepEqual(plan.refusals, []);
  assert.equal(plan.delivery, "email");
  assert.equal(plan.subject, "Your 30-day Horizon HFT trial is active");
  assert.match(plan.maskedMessage, /trial license key: HHFT-XXXXXX-XXXXXX-XXXXXX/);
  assert.match(plan.maskedMessage, /Feeds included: London/);
  assert.equal(plan.basket?.status, "new");
  assert.deepEqual(plan.tiers.map((t) => t.tierKey), ["ld-beta-56", "ld-gamma-19", "ld-delta-18"]);
  assert.ok(plan.tiers.every((t) => t.providerUserId === SEED_PROVIDER));
  assert.equal(plan.shareCents, null, "a trial never reads the share");
  assert.deepEqual(plan.activateArgs, {
    actorUserId: actorId, userId: u.id, bundleKey: "horizon-complete", feedChoice: "ld-base", termDays: 30, isTrial: true, amountUsd: null, basketRequestId: basketId,
  });
  assert.equal(plan.adminAction.action_type, "bundle_activate");
});

test("T-B + T-C trial, email-only client: 1 licence, 1 bundle, 0 payments, the key BY EMAIL with its delivery row, the bundle_activate row, the basket handled", async () => {
  const u = await makeUser();
  const basketId = await makeBasket(u.id);
  const before = sends.length;
  const out = await cli.executeActivation(await cli.planActivation(args(u.id, basketId)));
  await lic.settleLicenseBackgroundTasks();
  const r = out.result;

  const licences = (await sql(`select id, tier, status, feed_types, notes, license_key, expires_at from licenses where user_id = $1`, [u.id])).rows;
  assert.equal(licences.length, 1);
  assert.equal(licences[0].id, r.licenseId);
  assert.equal(licences[0].tier, "trial");
  assert.deepEqual(licences[0].feed_types, ["london"]);
  assert.equal(licences[0].notes, "Horizon Complete (ld-base)");
  assert.equal(r.licenseKey, licences[0].license_key, "the additive licenseKey is the row's key");
  assert.equal(new Date(r.expiresAt).getTime(), new Date(licences[0].expires_at).getTime(), "and expiresAt the row's expiry");
  assert.ok(Math.abs(new Date(licences[0].expires_at).getTime() - (Date.now() + 30 * DAY)) < 60_000);

  const bundles = (await sql(`select id, is_trial, status, basket_request_id, activated_by, license_id from bundle_subscriptions where user_id = $1`, [u.id])).rows;
  assert.equal(bundles.length, 1);
  assert.deepEqual(bundles[0], { id: r.bundleId, is_trial: true, status: "active", basket_request_id: basketId, activated_by: actorId, license_id: r.licenseId });
  assert.equal((await sql(`select count(*)::int as n from payments where user_id = $1`, [u.id])).rows[0].n, 0, "a trial writes no payment");
  assert.equal(r.paymentId, null);

  // Step 2: the key, by email (no Telegram), with the full key, the trial subject, and its delivery row.
  const mine = sends.slice(before);
  const emails = mine.filter((s) => s.kind === "email" && s.to === u.email);
  assert.equal(emails.length, 1, JSON.stringify(mine));
  assert.equal(emails[0].subject, "Your 30-day Horizon HFT trial is active");
  assert.ok(emails[0].text.includes(`trial license key: ${r.licenseKey}`));
  assert.equal(mine.filter((s) => s.kind === "portal").length, 0, "no DM: there is no Telegram id");
  const delivered = await deliveryRows(r.licenseId);
  assert.equal(delivered.length, 1);
  assert.equal(delivered[0].admin_user_id, actorId);
  assert.deepEqual(delivered[0].details_json, { licenseId: r.licenseId, channel: "email", ok: true, resendEmailId: "email-id" });
  assert.equal(out.delivery, "email");
  assert.equal(out.sendError, null);
  assert.equal(out.keySend?.ok, true);
  assert.equal(out.keySend?.channel, "email");
  const notices = (await sql(`select kind, what from client_notices where user_id = $1`, [u.id])).rows;
  assert.deepEqual(notices, [{ kind: "approved", what: "London trial, 30 days" }]);
  // activateBundle's own ops ping, to the sink, unchanged.
  assert.equal(mine.filter((s) => s.kind === "telemetry" && s.text.includes("trial issued")).length, 1);

  // Step 3.
  const logged = (await sql(`select admin_user_id, target_user_id, target_license_id, details_json from admin_actions where action_type = 'bundle_activate' and target_user_id = $1`, [u.id])).rows;
  assert.equal(logged.length, 1);
  assert.deepEqual(logged[0], {
    admin_user_id: actorId,
    target_user_id: u.id,
    target_license_id: r.licenseId,
    details_json: { bundleId: r.bundleId, licenseId: r.licenseId, isTrial: true, amountUsd: null, basketRequestId: basketId },
  });

  // Step 4 = T-C.
  const basket = (await sql(`select status, handled_by, handled_at from basket_requests where id = $1`, [basketId])).rows[0];
  assert.equal(basket.status, "handled");
  assert.equal(basket.handled_by, actorId);
  assert.ok(basket.handled_at);
  assert.equal(out.basketMarked, true);
});

test("T-B paid: ONE 'bundle' payment of the amount received, the paid key text by email; no share needed at activate (no server yet)", async () => {
  const u = await makeUser();
  const basketId = await makeBasket(u.id);
  const before = sends.length;
  const plan = await cli.planActivation(args(u.id, basketId, { isTrial: false, amountUsd: 100, receivedAt: new Date("2026-10-14T12:00:00Z") }));
  assert.deepEqual(plan.refusals, [], "an unset share does not refuse an activation");
  assert.equal(plan.shareCents, null);
  const out = await cli.executeActivation(plan);
  await lic.settleLicenseBackgroundTasks();

  assert.equal((await sql(`select tier from licenses where id = $1`, [out.result.licenseId])).rows[0].tier, "paid");
  const pays = (await sql(`select id, category, amount_usd, bundle_subscription_id, received_at from payments where user_id = $1`, [u.id])).rows;
  assert.equal(pays.length, 1);
  assert.equal(pays[0].id, out.result.paymentId);
  assert.equal(pays[0].category, "bundle");
  assert.equal(Number(pays[0].amount_usd), 100);
  assert.equal(pays[0].bundle_subscription_id, out.result.bundleId);
  assert.equal(new Date(pays[0].received_at).toISOString().slice(0, 10), "2026-10-14");
  const emails = sends.slice(before).filter((s) => s.kind === "email" && s.to === u.email);
  assert.equal(emails.length, 1);
  assert.equal(emails[0].subject, "Your Horizon HFT license is ready");
  assert.ok(emails[0].text.includes(out.result.licenseKey));
  assert.equal((await deliveryRows(out.result.licenseId)).length, 1);
  const logged = (await sql(`select details_json from admin_actions where action_type = 'bundle_activate' and target_user_id = $1`, [u.id])).rows;
  assert.equal(logged[0].details_json.amountUsd, 100);
});

test("a key send that THROWS: recorded, and steps 3 + 4 still run; the outcome carries the error", async () => {
  const u = await makeUser({ telegram: true });
  const basketId = await makeBasket(u.id);
  portalThrows = true;
  let out: Awaited<ReturnType<typeof cli.executeActivation>>;
  try {
    out = await cli.executeActivation(await cli.planActivation(args(u.id, basketId)));
  } finally {
    portalThrows = false;
  }
  await lic.settleLicenseBackgroundTasks();
  assert.match(String(out.sendError?.message), /fetch failed/);
  assert.equal(out.keySend, null, "a throw leaves no outcome");
  assert.deepEqual((await deliveryRows(out.result.licenseId))[0].details_json, { licenseId: out.result.licenseId, channel: "telegram", ok: false, error: "threw TypeError" });
  assert.equal((await sql(`select count(*)::int as n from admin_actions where action_type = 'bundle_activate' and target_user_id = $1`, [u.id])).rows[0].n, 1);
  assert.equal((await sql(`select status from basket_requests where id = $1`, [basketId])).rows[0].status, "handled");
});

test("an email the provider REFUSES (Resend 422, no throw): keySend ok false with the error, the delivery row ok false, the unreachable alert; steps 3 + 4 still run", async () => {
  const u = await makeUser();
  const basketId = await makeBasket(u.id);
  emailRefused = true;
  let out: Awaited<ReturnType<typeof cli.executeActivation>>;
  try {
    out = await cli.executeActivation(await cli.planActivation(args(u.id, basketId)));
  } finally {
    emailRefused = false;
  }
  await lic.settleLicenseBackgroundTasks();
  assert.equal(out.sendError, null, "nothing threw");
  assert.equal(out.keySend?.ok, false);
  assert.equal(out.keySend?.channel, "email");
  assert.match(String((out.keySend as { error?: string }).error), /validation_error/);
  const row = (await deliveryRows(out.result.licenseId))[0].details_json;
  assert.equal(row.ok, false);
  assert.equal(row.error, (out.keySend as { error?: string }).error, "the outcome is the row's");
  assert.equal((await sql(`select count(*)::int as n from client_unreachable_alerts where user_id = $1`, [u.id])).rows[0].n, 1);
  assert.equal((await sql(`select count(*)::int as n from admin_actions where action_type = 'bundle_activate' and target_user_id = $1`, [u.id])).rows[0].n, 1);
  assert.equal((await sql(`select status from basket_requests where id = $1`, [basketId])).rows[0].status, "handled");
});

test("each refusal refuses before any write", async (t) => {
  const refuses = async (label: string, a: import("./activate-bundle-cli").ActivateArgs, match: RegExp, env?: Record<string, string>) => {
    const c0 = await counts();
    const plan = await cli.planActivation(a, env);
    assert.ok(plan.refusals.some((r) => match.test(r)), `${label}: ${plan.refusals.join(" | ")}`);
    await assert.rejects(cli.executeActivation(plan), cli.RefusedError, label);
    assert.deepEqual(await counts(), c0, `${label}: nothing written or sent`);
  };

  await t.test("missing env, each var", async () => {
    for (const name of at.REQUIRED_ENV) {
      const u = await makeUser();
      await refuses(name, args(u.id, await makeBasket(u.id)), new RegExp(`Missing env: .*${name}`), { ...ENV, [name]: "" });
    }
  });
  await t.test("an active licence (this script never adopts)", async () => {
    const u = await makeUser();
    await sql(`insert into licenses (user_id, license_key, expires_at, tier) values ($1, $2, now() + interval '5 days', 'paid')`, [u.id, `CLI-ACT-${seq}`]);
    await refuses("active", args(u.id, await makeBasket(u.id), { isTrial: false, amountUsd: 100 }), /active licence.*new licence only/);
  });
  await t.test("an active bundle", async () => {
    const u = await makeUser();
    await cli.executeActivation(await cli.planActivation(args(u.id, await makeBasket(u.id))));
    await lic.settleLicenseBackgroundTasks();
    await refuses("bundle", args(u.id, await makeBasket(u.id), { allowRepeatTrial: true }), /already has an active bundle/);
  });
  await t.test("a past trial without --allow-repeat-trial", async () => {
    const u = await makeUser();
    await sql(`insert into licenses (user_id, license_key, expires_at, tier) values ($1, $2, now() - interval '20 days', 'trial')`, [u.id, `CLI-OLD-${seq}`]);
    await refuses("repeat", args(u.id, await makeBasket(u.id)), /trial licence\(s\) before/);
  });
  await t.test("the basket: missing, another user's, already handled, a different feed, no bundle line", async () => {
    const u = await makeUser();
    await refuses("missing", args(u.id, "00000000-0000-4000-8000-00000000beef"), /No basket request/);
    const other = await makeUser();
    await refuses("other", args(u.id, await makeBasket(other.id)), /belongs to another user/);
    const handled = await makeBasket(u.id);
    await sql(`update basket_requests set status = 'handled', handled_at = now() where id = $1`, [handled]);
    await refuses("handled", args(u.id, handled), /already 'handled'/);
    await refuses("feed", args(u.id, await makeBasket(u.id, { kind: "bundle", key: "horizon-complete", name: "x", feed: "ny-base" })), /asked for horizon-complete \(ny-base\)/);
    await refuses("no line", args(u.id, await makeBasket(u.id, { kind: "software", key: "horizon", name: "Horizon" })), /no bundle line/);
  });
  await t.test("no Telegram and no email", async () => {
    const u = await makeUser({ email: null });
    await refuses("no channel", args(u.id, await makeBasket(u.id)), /could not be delivered/);
  });
  await t.test("an internal account without --allow-internal", async () => {
    const u = await makeUser({ email: `qa${seq + 1}@horizonhft.internal` });
    await refuses("internal", args(u.id, await makeBasket(u.id)), /internal or test account/);
  });
});

test("--grant-feed: refuses with no server; a trial grants the 3 LD Base rows at 0 with allowlist records; a paid one refuses until the share is set", async () => {
  // Trial.
  const u = await makeUser();
  const out = await cli.executeActivation(await cli.planActivation(args(u.id, await makeBasket(u.id))));
  await lic.settleLicenseBackgroundTasks();
  const grant = { mode: "grant-feed" as const, bundleId: out.result.bundleId, execute: true };
  const c0 = await counts();
  const noServer = await cli.planGrant(grant);
  assert.ok(noServer.refusals.some((r) => /No server registered/.test(r)), noServer.refusals.join(" | "));
  await assert.rejects(cli.executeGrant(noServer), cli.RefusedError);
  assert.deepEqual(await counts(), c0);

  const serverId = await makeServer(out.result.licenseId, u.id);
  const plan = await cli.planGrant(grant);
  assert.deepEqual(plan.refusals, []);
  assert.equal(plan.shareCents, null, "a trial reads no share");
  const g = await cli.executeGrant(plan);
  assert.deepEqual(g.stamped.map((s) => [s.tierKey, s.outcome]), [["ld-beta-56", "created"], ["ld-gamma-19", "created"], ["ld-delta-18", "created"]]);
  const rows = (await sql(`select price_cents, bundle_subscription_id, status from feed_subscriptions where subscriber_user_id = $1`, [u.id])).rows;
  assert.equal(rows.length, 3);
  assert.ok(rows.every((r) => r.price_cents === 0 && r.bundle_subscription_id === out.result.bundleId && r.status === "active"));
  assert.equal((await sql(`select count(*)::int as n from feed_allowlist_records where server_registration_id = $1`, [serverId])).rows[0].n, 3);

  // Paid, with a server: refused on the unset share, then priced from it.
  const p = await makeUser();
  const paid = await cli.executeActivation(await cli.planActivation(args(p.id, await makeBasket(p.id), { isTrial: false, amountUsd: 100 })));
  await lic.settleLicenseBackgroundTasks();
  await makeServer(paid.result.licenseId, p.id);
  const pGrant = { mode: "grant-feed" as const, bundleId: paid.result.bundleId, execute: true };
  const unset = await cli.planGrant(pGrant);
  assert.ok(unset.refusals.some((r) => /bundle_feed_share_cents has no share for ld-base/.test(r)), unset.refusals.join(" | "));
  await sql(`insert into portal_config (key, value) values ('bundle_feed_share_cents', $1)`, [JSON.stringify({ "ld-base": 3000 })]);
  const set = await cli.planGrant(pGrant);
  assert.deepEqual(set.refusals, []);
  assert.equal(set.shareCents, 3000);
  await cli.executeGrant(set);
  const prices = (await sql(`select price_cents from feed_subscriptions where subscriber_user_id = $1`, [p.id])).rows.map((r) => r.price_cents);
  assert.deepEqual(prices, [3000, 3000, 3000]);
});

test("argv: the run marcus will make parses; trial XOR amount; no defaults; --grant-feed stands alone", () => {
  const p = (s: string) => cli.parseActivateBundleArgs(s.split(" "));
  const albin =
    "--user ca67dddd-597e-48bb-9e33-aa52ea21afc0 --bundle horizon-complete --feed ld-base --days 30 --trial --basket d9552c8b-a536-49d6-a9ed-8e4b48feeeb8";
  assert.deepEqual(p(albin), {
    mode: "activate",
    user: "ca67dddd-597e-48bb-9e33-aa52ea21afc0",
    bundleKey: "horizon-complete",
    feedChoice: "ld-base",
    days: 30,
    isTrial: true,
    amountUsd: null,
    receivedAt: null,
    basketId: "d9552c8b-a536-49d6-a9ed-8e4b48feeeb8",
    allowRepeatTrial: false,
    allowInternal: false,
    execute: false,
  });
  assert.equal((p(`${albin} --execute`) as import("./activate-bundle-cli").ActivateArgs).execute, true);
  const base = "--user x --bundle horizon-complete --feed ld-base --days 30 --basket d9552c8b-a536-49d6-a9ed-8e4b48feeeb8";
  assert.throws(() => p(base), /Pass --trial, or --amount-usd/);
  assert.throws(() => p(`${base} --trial --amount-usd 100`), /--trial records no payment/);
  assert.throws(() => p(`${base} --amount-usd 0`), /dollar amount above 0/);
  assert.throws(() => p(`${base} --amount-usd 99.999`), /dollar amount above 0/);
  assert.throws(() => p(`${base} --amount-usd 100 --received-at 2999-01-01`), /in the future/);
  assert.equal((p(`${base} --amount-usd 99.50`) as import("./activate-bundle-cli").ActivateArgs).amountUsd, 99.5);
  assert.throws(() => p(base.replace("--days 30", "--days 0") + " --trial"), /whole number/);
  assert.throws(() => p(base.replace(" --days 30", "") + " --trial"), /--days is required/);
  assert.throws(() => p(base.replace("ld-base", "eu-base") + " --trial"), /Unknown feed for Horizon Complete: eu-base/);
  assert.throws(() => p(base.replace("horizon-complete", "horizon-max") + " --trial"), /Unknown bundle/);
  assert.throws(() => p(base.replace(/ --basket \S+/, "") + " --trial"), /--basket is required/);
  assert.throws(() => p(`${base} --trial --force`), /Unknown argument/);
  assert.deepEqual(p("--grant-feed 11111111-2222-4333-8444-555555555555"), { mode: "grant-feed", bundleId: "11111111-2222-4333-8444-555555555555", execute: false });
  assert.throws(() => p("--grant-feed 11111111-2222-4333-8444-555555555555 --trial"), /takes only --execute/);
  assert.throws(() => p("--grant-feed not-a-uuid"), /needs a bundle id/);
});

/** Runs the script once, --execute, for a fresh Albin-shaped client. The module runs on import and is cached per
 * specifier, so each run passes its own (a query string). Returns the stdout lines' text and the user. */
async function runScript(specifier: string) {
  const u = await makeUser();
  const basketId = await makeBasket(u.id);
  const lines: string[] = [];
  const [argv, log, error] = [process.argv, console.log, console.error];
  process.argv = [argv[0], "scripts/activate-bundle.mts", "--user", u.id, "--bundle", "horizon-complete", "--feed", "ld-base", "--days", "30", "--trial", "--basket", basketId, "--execute"];
  console.log = (...a: unknown[]) => void lines.push(a.join(" "));
  console.error = () => {};
  poolEnded = false;
  try {
    await import(specifier);
  } finally {
    process.argv = argv;
    console.log = log;
    console.error = error;
  }
  return { out: lines.join("\n"), u };
}

// Last: the script ends the pool on the way out.
test("the script itself, --execute on an Albin-shaped client: prints the masked key, never the full one, sets no failure code, ends the pool", async () => {
  const { out, u } = await runScript("../../scripts/activate-bundle.mjs");
  assert.ok(poolEnded, "the script ended the pool");
  const row = (await sql(`select id, license_key from licenses where user_id = $1`, [u.id])).rows;
  assert.equal(row.length, 1, out);
  assert.ok(!out.includes(row[0].license_key), "full key never printed");
  assert.ok(out.includes(lic.maskLicenseKey(row[0].license_key)), out);
  assert.match(out, new RegExp(`ACTIVATED  bundle \\S+  licence ${row[0].id}`));
  assert.match(out, /Key sent by email\./);
  assert.match(out, /Basket: {4}marked handled/);
  assert.match(out, /--grant-feed [0-9a-f-]{36}/);
  assert.ok(!process.exitCode, out);
});

test("the script, Resend 422 on the only channel (Fable S1 m69343): prints KEY SEND FAILED with the channel and error, never 'Key sent', and exits 1", async () => {
  emailRefused = true;
  let run: Awaited<ReturnType<typeof runScript>>;
  try {
    run = await runScript("../../scripts/activate-bundle.mjs?send-refused");
  } finally {
    emailRefused = false;
  }
  const { out, u } = run;
  const exitCode = process.exitCode;
  process.exitCode = 0;
  assert.ok(poolEnded, "the script ended the pool");
  assert.equal((await sql(`select count(*)::int as n from licenses where user_id = $1`, [u.id])).rows[0].n, 1, out);
  assert.match(out, /KEY SEND FAILED \(email: validation_error [^)]*\): unreachable alert raised, see admin_actions license_key_delivery/);
  assert.doesNotMatch(out, /Key sent by/);
  assert.match(out, /Basket: {4}marked handled/, "step 4 still ran");
  assert.equal(exitCode, 1, out);
});
