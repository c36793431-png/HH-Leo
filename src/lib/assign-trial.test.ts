/* Run: npx tsx --test src/lib/assign-trial.test.ts
 *
 * The agent trial-assign CLI (marcus m60729, scope m60728): the panel's "Issue new license" and
 * scripts/assign-trial.mts write the same licence and admin_actions rows and send the same DM,
 * differing only in the actor; the dry run writes nothing; every refusal refuses before a write;
 * the actor never falls back to coxwell; the script prints only the masked key.
 * Real Postgres, no prod: the same harness as access-requests-admin-trial.test.ts (an in-memory
 * PGlite carrying the REAL migration chain, the shipped lib through db.ts's global._pgPool seam).
 * The three prod-data preflights get the same minimum seeds, named there. */
import { test, before } from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { PGlite } from "@electric-sql/pglite";

const MIGRATIONS = path.join(process.cwd(), "db/migrations");
const DAY = 24 * 60 * 60 * 1000;
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

/* eslint-disable @typescript-eslint/no-explicit-any */
let db: any;
let at: typeof import("./assign-trial");
let inl: typeof import("./issue-new-license");
let licenses: typeof import("./licenses");
let admin: typeof import("./admin");
const sends: { kind: "portal" | "telemetry" | "email"; to: string; text: string }[] = [];
let actorId = "";
let telemetryDelayMs = 0;

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
  Object.assign(process.env, ENV);
  // Capture every outbound send instead of making it: portal bot (the key DM), telemetry bot (the
  // ops ping) and Resend (the email fallback).
  (globalThis as any).fetch = async (url: string, init?: { body?: string }) => {
    const u = String(url);
    const body = init?.body ? JSON.parse(init.body) : {};
    if (u.includes(`/bot${ENV.HORIZON_PORTAL_BOT_TOKEN}/sendMessage`)) sends.push({ kind: "portal", to: String(body.chat_id), text: body.text });
    else if (u.includes(`/bot${ENV.TELEMETRY_BOT_TOKEN}/sendMessage`)) {
      if (telemetryDelayMs) await new Promise((r) => setTimeout(r, telemetryDelayMs));
      sends.push({ kind: "telemetry", to: String(body.chat_id), text: body.text });
    }
    else if (u.includes("resend.com")) sends.push({ kind: "email", to: [body.to].flat().join(","), text: body.text });
    return new Response(JSON.stringify({ ok: true, result: {}, id: "email-id" }), { status: 200 });
  };
  at = await import("./assign-trial");
  inl = await import("./issue-new-license");
  licenses = await import("./licenses");
  admin = await import("./admin");

  await sql(`insert into users (id, email, role) values ($1, 'hfthorizon@keemail.me', 'admin')`, [ADMIN]);
  // The real seed file, so the test proves what marcus will apply.
  await db.exec(readFileSync(path.join(process.cwd(), "scripts/seed-agent-actor.sql"), "utf8"));
  actorId = (await sql(`select id from users where email = $1`, [at.AGENT_ACTOR_EMAIL])).rows[0].id;
});

let seq = 0;
async function makeUser(opts: { telegram?: boolean; email?: string | null } = {}) {
  seq++;
  const email = opts.email === undefined ? `client${seq}@example.invalid` : opts.email;
  const tg = opts.telegram === false ? null : 7000 + seq;
  const r = await sql(`insert into users (email, telegram_user_id) values ($1, $2) returning id`, [email, tg]);
  return { id: r.rows[0].id as string, email, telegramId: tg === null ? null : String(tg) };
}

async function counts() {
  const r = await sql(`select (select count(*) from licenses)::int as l, (select count(*) from admin_actions)::int as a`);
  return { licences: r.rows[0].l, actions: r.rows[0].a, sends: sends.length };
}

async function licenceRow(id: string) {
  return (await sql(`select user_id, claim_email, claim_telegram_user_id, status, tier, feed_types, notes, expires_at from licenses where id = $1`, [id])).rows[0];
}

async function actionRow(licenceId: string) {
  return (await sql(`select admin_user_id, action_type, target_user_id, target_license_id, details_json from admin_actions where target_license_id = $1`, [licenceId])).rows;
}

const args = (user: string, extra: Partial<import("./assign-trial").AssignTrialArgs> = {}) => ({
  user,
  days: 7,
  feeds: ["london", "ny"] as import("./licenses").FeedType[],
  execute: true,
  allowRepeatTrial: false,
  ...extra,
});

test("UI vs CLI: the same licence row, admin_actions row and DM; only the actor (and via) differ", async () => {
  const a = await makeUser();
  const b = await makeUser();
  const before = sends.length;

  // The panel's call, as issueNewLicenseAction makes it (hidden tier=trial, 7 days, two feeds).
  const t0 = Date.now();
  const ui = await inl.issueNewLicenseForUser({
    actorUserId: ADMIN,
    userId: a.id,
    expiresAt: new Date(t0 + 7 * DAY),
    feedTypes: ["london", "ny"],
    tier: "trial",
  });
  const cli = await at.executeTrial(await at.planTrial(args(b.id)));
  await licenses.settleLicenseBackgroundTasks();

  const [la, lb] = [await licenceRow(ui.license.id), await licenceRow(cli.license.id)];
  assert.equal(la.user_id, a.id);
  assert.equal(lb.user_id, b.id);
  for (const k of ["claim_email", "claim_telegram_user_id", "status", "tier", "notes"]) assert.deepEqual(lb[k], la[k], k);
  assert.deepEqual(lb.feed_types, la.feed_types);
  assert.equal(lb.tier, "trial");
  assert.ok(Math.abs(new Date(lb.expires_at).getTime() - new Date(la.expires_at).getTime()) < 60_000, "same 7-day expiry");

  const [aa, ab] = [await actionRow(ui.license.id), await actionRow(cli.license.id)];
  assert.equal(aa.length, 1);
  assert.equal(ab.length, 1);
  assert.equal(aa[0].admin_user_id, ADMIN);
  assert.equal(ab[0].admin_user_id, actorId, "CLI rows carry the agent actor");
  assert.equal(aa[0].action_type, ab[0].action_type);
  assert.equal(ab[0].target_user_id, b.id);
  const { via, ...cliDetails } = ab[0].details_json;
  assert.equal(via, "cli");
  assert.equal(aa[0].details_json.via, undefined, "the panel's details are unchanged: no via key");
  assert.deepEqual(Object.keys(cliDetails), Object.keys(aa[0].details_json));
  assert.deepEqual({ ...cliDetails, licenseId: "x", expiresAt: "x" }, { ...aa[0].details_json, licenseId: "x", expiresAt: "x" });

  const mine = sends.slice(before);
  const dmA = mine.filter((s) => s.kind === "portal" && s.to === a.telegramId);
  const dmB = mine.filter((s) => s.kind === "portal" && s.to === b.telegramId);
  assert.equal(dmA.length, 1);
  assert.equal(dmB.length, 1);
  assert.equal(dmB[0].text.replace(cli.license.licenseKey, "KEY"), dmA[0].text.replace(ui.license.licenseKey, "KEY"));
  assert.ok(dmB[0].text.includes(cli.license.licenseKey), "the client gets the full key");
  // The ops ping, which runs in the background, landed for both.
  const pings = mine.filter((s) => s.kind === "telemetry" && s.text.includes("trial issued"));
  assert.equal(pings.length, 2);
  assert.ok(pings.some((p) => p.text.includes(b.email!)));
  assert.equal(cli.delivery, "telegram");
});

test("settleLicenseBackgroundTasks waits for the background ops ping (what the script awaits before ending the pool)", async () => {
  const u = await makeUser();
  telemetryDelayMs = 300;
  try {
    const before = sends.length;
    await at.executeTrial(await at.planTrial(args(u.id)));
    assert.equal(sends.slice(before).filter((s) => s.kind === "telemetry").length, 0, "still in flight when execute returns");
    await licenses.settleLicenseBackgroundTasks();
    assert.equal(sends.slice(before).filter((s) => s.kind === "telemetry" && s.text.includes(u.email!)).length, 1, "landed by the time settle resolves");
  } finally {
    telemetryDelayMs = 0;
  }
});

test("an email-only user: the key goes by Resend, and the plan said so", async () => {
  const u = await makeUser({ telegram: false });
  const plan = await at.planTrial(args(u.email!));
  assert.equal(plan.delivery, "email");
  const before = sends.length;
  const r = await at.executeTrial(plan);
  const emails = sends.slice(before).filter((s) => s.kind === "email");
  assert.equal(emails.length, 1);
  assert.equal(emails[0].to, u.email);
  assert.ok(emails[0].text.includes(r.license.licenseKey));
  await licenses.settleLicenseBackgroundTasks();
});

test("dry run: reads only; the plan shows history, expiry, channel, the masked DM and the admin row", async () => {
  const u = await makeUser();
  await sql(`insert into licenses (user_id, license_key, status, expires_at, tier, feed_types) values ($1, 'OLD-PAID', 'revoked', now() - interval '3 days', 'paid', array['london'])`, [u.id]);
  const c0 = await counts();
  const t0 = Date.now();
  const plan = await at.planTrial(args(u.id, { execute: false, days: 10 }));
  assert.deepEqual(await counts(), c0, "no row and no send");
  assert.equal(plan.refusals.length, 0);
  assert.equal(plan.licences.length, 1);
  assert.equal(plan.licences[0].tier, "paid");
  assert.ok(Math.abs(plan.expiresAt.getTime() - (t0 + 10 * DAY)) < 60_000);
  assert.equal(plan.delivery, "telegram");
  assert.match(plan.maskedMessage, /license key: HHFT-XXXXXX-XXXXXX-XXXXXX/);
  assert.equal(plan.adminAction.admin_user_id, actorId);
  assert.equal(plan.adminAction.details.via, "cli");
});

test("each refusal refuses before any write", async (t) => {
  const refusesWithNoWrite = async (label: string, a: import("./assign-trial").AssignTrialArgs, match: RegExp, env?: Record<string, string>) => {
    const c0 = await counts();
    const plan = await at.planTrial(a, env);
    assert.ok(plan.refusals.some((r) => match.test(r)), `${label}: ${plan.refusals.join(" | ")}`);
    await assert.rejects(at.executeTrial(plan), at.RefusedError, label);
    assert.deepEqual(await counts(), c0, `${label}: nothing written or sent`);
  };

  await t.test("missing env, each var", async () => {
    for (const name of at.REQUIRED_ENV) {
      const u = await makeUser();
      await refusesWithNoWrite(name, args(u.id), new RegExp(`Missing env: .*${name}`), { ...ENV, [name]: "" });
    }
  });
  await t.test("active licence", async () => {
    const u = await makeUser();
    await sql(`insert into licenses (user_id, license_key, expires_at, tier) values ($1, $2, now() + interval '5 days', 'paid')`, [u.id, `ACT-${seq}`]);
    await refusesWithNoWrite("active", args(u.id), /already has an active licence/);
  });
  await t.test("past trial without --allow-repeat-trial; allowed with it", async () => {
    const u = await makeUser();
    await sql(`insert into licenses (user_id, license_key, expires_at, tier) values ($1, $2, now() - interval '20 days', 'trial')`, [u.id, `OLDTRIAL-${seq}`]);
    await refusesWithNoWrite("repeat", args(u.id), /trial licence\(s\) before/);
    const plan = await at.planTrial(args(u.id, { allowRepeatTrial: true }));
    assert.deepEqual(plan.refusals, []);
    assert.equal(plan.licences.filter((l) => l.tier === "trial").length, 1, "history shown");
    const r = await at.executeTrial(plan);
    assert.equal((await licenceRow(r.license.id)).tier, "trial");
    await licenses.settleLicenseBackgroundTasks();
  });
  await t.test("no Telegram id and no email", async () => {
    const u = await makeUser({ telegram: false, email: null });
    await refusesWithNoWrite("no channel", args(u.id), /could not be delivered/);
  });
  await t.test("user lookup: none, or several by case-insensitive email", async () => {
    await assert.rejects(at.planTrial(args("nobody@example.invalid")), at.RefusedError);
    await makeUser({ email: "Twin@example.invalid" });
    await makeUser({ email: "twin@example.invalid" });
    await assert.rejects(at.planTrial(args("TWIN@example.invalid")), /2 users match/);
  });
});

test("argv: --days required, unknown feed refused, unknown flag refused", () => {
  const p = (s: string) => at.parseAssignTrialArgs(s.split(" "));
  assert.throws(() => p("--user x --feeds london"), /--days is required/);
  assert.throws(() => p("--user x --days 0 --feeds london"), /whole number/);
  assert.throws(() => p("--user x --days 7.5 --feeds london"), /whole number/);
  assert.throws(() => p("--user x --days 7 --feeds london,londn"), /Unknown feed\(s\): londn/);
  assert.throws(() => p("--user x --days 7"), /--feeds is required/);
  assert.throws(() => p("--user x --days 7 --feeds london --force"), /Unknown argument/);
  assert.deepEqual(p("--user x --days=7 --feeds London,ny,london --execute"), {
    user: "x", days: 7, feeds: ["london", "ny"], execute: true, allowRepeatTrial: false,
  });
  assert.equal(p("--user x --days 7 --feeds ny").execute, false, "dry run by default");
});

test("the actor never falls back to coxwell: with the seed row gone, the CLI refuses", async () => {
  const u = await makeUser();
  // Control: the fallback is real. logAdminAction with an unknown id writes coxwell's row.
  await admin.logAdminAction("00000000-0000-4000-8000-0000000000ff", "test_fallback_control", u.id, null, null);
  const control = (await sql(`select admin_user_id from admin_actions where action_type = 'test_fallback_control'`)).rows;
  assert.equal(control[0].admin_user_id, ADMIN);

  await sql(`update users set email = 'parked-agent@example.invalid' where id = $1`, [actorId]);
  try {
    const c0 = await counts();
    const plan = await at.planTrial(args(u.id));
    assert.equal(plan.actor, null);
    assert.ok(plan.refusals.some((r) => /seed-agent-actor\.sql/.test(r)));
    await assert.rejects(at.executeTrial(plan), at.RefusedError);
    assert.deepEqual(await counts(), c0);
  } finally {
    await sql(`update users set email = $2 where id = $1`, [actorId, at.AGENT_ACTOR_EMAIL]);
  }
});

// Last: the script runs once per process (its module is cached) and ends the pool on the way out.
test("the script itself, --execute: prints the masked key, never the full one, and sets no failure code", async () => {
  const u = await makeUser();
  const lines: string[] = [];
  const [argv, log] = [process.argv, console.log];
  process.argv = [argv[0], "scripts/assign-trial.mts", "--user", u.email!, "--days", "14", "--feeds", "ny", "--execute"];
  console.log = (...a: unknown[]) => void lines.push(a.join(" "));
  try {
    await import("../../scripts/assign-trial.mjs");
  } finally {
    process.argv = argv;
    console.log = log;
  }
  const out = lines.join("\n");
  const row = (await sql(`select id, license_key, tier, feed_types from licenses where user_id = $1`, [u.id])).rows;
  assert.equal(row.length, 1, out);
  assert.equal(row[0].tier, "trial");
  assert.deepEqual(row[0].feed_types, ["ny"]);
  assert.ok(!out.includes(row[0].license_key), "full key never printed");
  assert.ok(out.includes(licenses.maskLicenseKey(row[0].license_key)), out);
  assert.match(out, new RegExp(`ISSUED  licence ${row[0].id}`));
  assert.ok(!process.exitCode, out);
});
