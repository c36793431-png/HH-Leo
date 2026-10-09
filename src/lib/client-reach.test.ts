/* Run: npx tsx --test src/lib/client-reach.test.ts
 *
 * Client reach (coxwell 10-06 via marcus m61849 + parts 7/8 m61859/m61866, design m61875/m61876).
 * Fail-first: run against the code before this branch, the notify, unreachable-alert and contact-block
 * tests must FAIL (dmuzs: Telegram login, never pressed Start, no email; trial granted, never told).
 * Real Postgres, no prod: the same harness as assign-trial.test.ts (PGlite carrying the REAL migration chain,
 * the shipped lib through db.ts's global._pgPool seam), every outbound send captured instead of made. */
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
const IPV4 = /\b(?:\d{1,3}\.){3}\d{1,3}\b/;

/* eslint-disable @typescript-eslint/no-explicit-any */
let db: any;
type Send = { kind: "portal" | "telemetry" | "email"; to: string; text: string; subject?: string };
const sends: Send[] = [];
let portalRefuses = false; // Telegram's answer to a bot DM the user never allowed: 403
let portalThrows = false;
let telemetryFails = false;

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
  (globalThis as any).fetch = async (url: string, init?: { body?: string }) => {
    const u = String(url);
    const body = init?.body ? JSON.parse(init.body) : {};
    if (u.includes(`/bot${ENV.HORIZON_PORTAL_BOT_TOKEN}/`)) {
      if (portalThrows) throw new TypeError("fetch failed");
      if (portalRefuses) {
        return new Response(JSON.stringify({ ok: false, error_code: 403, description: "Forbidden: bot can't initiate conversation with a user" }), { status: 403 });
      }
      if (u.endsWith("/sendMessage")) sends.push({ kind: "portal", to: String(body.chat_id), text: body.text });
    } else if (u.includes(`/bot${ENV.TELEMETRY_BOT_TOKEN}/`)) {
      if (telemetryFails) return new Response("{}", { status: 500 });
      sends.push({ kind: "telemetry", to: String(body.chat_id), text: body.text });
    } else if (u.includes("resend.com")) {
      sends.push({ kind: "email", to: [body.to].flat().join(","), text: body.text, subject: body.subject });
    }
    return new Response(JSON.stringify({ ok: true, result: { message_id: 4242, username: "HorizonPortalBot" }, id: "email-id" }), { status: 200 });
  };
  await sql(`insert into users (id, email, role) values ($1, 'hfthorizon@keemail.me', 'admin')`, [ADMIN]);
});

beforeEach(() => {
  sends.length = 0;
  portalRefuses = false;
  portalThrows = false;
  telemetryFails = false;
});

let seq = 0;
/** A client like dmuzs: Telegram login, never pressed Start, no email (unless given). */
async function client(opts: { email?: string | null; tg?: boolean; username?: string | null; botStarted?: boolean } = {}) {
  seq++;
  const tgId = opts.tg === false ? null : String(900000 + seq);
  const r = await sql(
    `insert into users (email, display_name, telegram_user_id, telegram_username, telegram_bot_started_at)
     values ($1, $2, $3, $4, $5) returning id`,
    [opts.email ?? null, `client ${seq}`, tgId, opts.username === undefined ? `client${seq}` : opts.username, opts.botStarted ? new Date() : null]
  );
  return { id: r.rows[0].id as string, tgId };
}

// ---------- Part 1: notifyUser never fails silently ----------

test("part 1: Telegram refused (403) + email on file -> falls back to email", async () => {
  const { notifyUser } = await import("./notify");
  portalRefuses = true;
  const out: any = await notifyUser({ telegramUserId: "777", email: "c@example.invalid" }, "Subj", "Body");
  assert.equal(out.ok, true, `expected delivery by email, got ${JSON.stringify(out)}`);
  assert.equal(out.channel, "email");
  assert.equal(sends.filter((s) => s.kind === "email").length, 1);
});

test("part 1: Telegram throws (network) + email on file -> falls back to email, never throws", async () => {
  const { notifyUser } = await import("./notify");
  portalThrows = true;
  const out: any = await notifyUser({ telegramUserId: "777", email: "c@example.invalid" }, "Subj", "Body");
  assert.equal(out.ok, true);
  assert.equal(out.channel, "email");
});

test("part 1: Telegram refused + no email -> 'unreachable', with both reasons recorded", async () => {
  const { notifyUser } = await import("./notify");
  portalRefuses = true;
  const out: any = await notifyUser({ telegramUserId: "777", email: null }, "Subj", "Body");
  assert.equal(out.ok, false);
  assert.equal(out.unreachable, true);
  assert.match(out.error, /^403 /);
  assert.equal(out.attempts.length, 1);
  assert.equal(sends.length, 0);
});

test("part 1: no Telegram id + email -> email only (unchanged)", async () => {
  const { notifyUser } = await import("./notify");
  const out: any = await notifyUser({ telegramUserId: null, email: "c@example.invalid" }, "Subj", "Body");
  assert.equal(out.channel, "email");
  assert.equal(sends.filter((s) => s.kind === "portal").length, 0);
});

test("part 1: Telegram delivered -> no email, and the user's last-DM result is recorded", async () => {
  const { notifyUser } = await import("./notify");
  const c = await client({ email: "c2@example.invalid" });
  const out: any = await notifyUser({ userId: c.id, telegramUserId: c.tgId, email: "c2@example.invalid" } as any, "Subj", "Body");
  assert.equal(out.channel, "telegram");
  assert.equal(sends.filter((s) => s.kind === "email").length, 0);
  const u = (await sql(`select tg_last_dm_ok, tg_last_dm_at, tg_last_dm_error from users where id = $1`, [c.id])).rows[0];
  assert.equal(u.tg_last_dm_ok, true);
  assert.ok(u.tg_last_dm_at);
  assert.equal(u.tg_last_dm_error, null);
});

// ---------- Part 2: unreachable -> persisted row + admin alert ----------

test("part 2: trial granted to a client we can't reach -> DB row + approvals alert naming the client", async () => {
  const inl = await import("./issue-new-license");
  const c = await client({ username: "dmuzsrdfx" });
  portalRefuses = true;
  await inl.issueNewLicenseForUser({ actorUserId: ADMIN, userId: c.id, expiresAt: new Date(Date.now() + 30 * 864e5), feedTypes: ["london"], tier: "trial" });
  const rows = (await sql(`select what, attempts, alert_sent_at from client_unreachable_alerts where user_id = $1`, [c.id])).rows;
  assert.equal(rows.length, 1, "one unreachable row");
  assert.match(rows[0].what, /trial/i);
  assert.ok(rows[0].alert_sent_at, "alert sent");
  const alert = sends.find((s) => s.kind === "telemetry" && /can't be reached/.test(s.text));
  assert.ok(alert, `approvals alert, got ${JSON.stringify(sends)}`);
  assert.match(alert!.text, /Approved but client can't be reached/);
  assert.match(alert!.text, /client: @dmuzsrdfx https:\/\/t\.me\/dmuzsrdfx \(no email\)/, "named by Leo's clientLine (marcus m62162)");
  const u = (await sql(`select tg_last_dm_ok, tg_last_dm_error from users where id = $1`, [c.id])).rows[0];
  assert.equal(u.tg_last_dm_ok, false);
  assert.match(u.tg_last_dm_error, /403/);
});

test("part 2: the alert send failing still keeps the row (alert_sent_at null)", async () => {
  const reach = await import("./client-reach");
  const c = await client();
  telemetryFails = true;
  await reach.reportUnreachable(c.id, "London trial, 30 days", [{ channel: "telegram", ok: false, error: "403 Forbidden" }]);
  const rows = (await sql(`select alert_sent_at from client_unreachable_alerts where user_id = $1`, [c.id])).rows;
  assert.equal(rows.length, 1);
  assert.equal(rows[0].alert_sent_at, null);
});

// ---------- Part 8: the client is named by the ONE formatter (Leo's clientLine, marcus m62162) ----------

test("part 8: the unreachable alert names a Telegram-only client by @username, never 'email: -'", async () => {
  const reach = await import("./client-reach");
  const c = await client({ username: "tg_only_one" });
  await reach.reportUnreachable(c.id, "London trial, 30 days", [{ channel: "telegram", ok: false, error: "403 Forbidden" }]);
  const t = sends.find((x) => x.kind === "telemetry" && /can't be reached/.test(x.text))!;
  assert.ok(t);
  assert.match(t.text, /client: @tg_only_one https:\/\/t\.me\/tg_only_one \(no email\)/);
  assert.doesNotMatch(t.text, /email: -/);
});

test("part 8: a client with no email and no @username is named by the short user id", async () => {
  const reach = await import("./client-reach");
  const c = await client({ username: null });
  await reach.reportUnreachable(c.id, "London trial, 30 days");
  const t = sends.find((x) => x.kind === "telemetry" && /can't be reached/.test(x.text))!;
  assert.ok(t.text.includes(`client: user ${c.id.slice(0, 8)} (no email, no telegram username)`), t.text);
});

// ---------- Parts 4/7: approval notice + reachability badge ----------

test("part 4: approval -> client message with the next step + dashboard notice; no IP anywhere", async () => {
  const reach = await import("./client-reach");
  const c = await client({ botStarted: true });
  await reach.notifyApproved(c.id, "London trial, 30 days");
  const dm = sends.find((s) => s.kind === "portal");
  assert.ok(dm, "client DM sent");
  assert.match(dm!.text, /horizonhft\.com\/education/);
  assert.match(dm!.text, /\/servers/);
  assert.doesNotMatch(dm!.text, IPV4);
  const n = (await sql(`select kind, what from client_notices where user_id = $1 and dismissed_at is null`, [c.id])).rows;
  assert.deepEqual(n.map((r: any) => r.kind), ["approved"]);
});

test("part 7: reachability label says what it's based on", async () => {
  const { reachability } = await import("./client-reach");
  assert.match(reachability({ email: null, telegramUserId: "1", botStartedAt: null, tgLastDmAt: null, tgLastDmOk: null }).label, /never tried, bot not started/);
  assert.match(reachability({ email: null, telegramUserId: "1", botStartedAt: null, tgLastDmAt: new Date("2026-10-05T10:00:00Z"), tgLastDmOk: false, tgLastDmError: "403 Forbidden" }).label, /blocked \(403\) 10-05/);
  assert.match(reachability({ email: null, telegramUserId: "1", botStartedAt: null, tgLastDmAt: new Date("2026-10-06T10:00:00Z"), tgLastDmOk: true }).label, /delivered 10-06/);
  assert.equal(reachability({ email: null, telegramUserId: null, botStartedAt: null, tgLastDmAt: null, tgLastDmOk: null }).reachable, false);
  assert.equal(reachability({ email: "a@b.c", telegramUserId: "1", botStartedAt: null, tgLastDmAt: new Date(), tgLastDmOk: false }).reachable, true);
});

// ---------- Part 5: stale basket request reminder ----------

test("part 5: a request still 'new' after 24h -> one admin reminder, then none", async () => {
  const reach = await import("./client-reach");
  const c = await client({ username: "late_one" });
  await sql(`insert into basket_requests (user_id, lines, submitted_at) values ($1, '[{"kind":"feed","label":"London"}]'::jsonb, now() - interval '25 hours')`, [c.id]);
  const first = await reach.runStaleBasketReminders();
  const reminders = sends.filter((s) => s.kind === "telemetry" && /still new/i.test(s.text));
  assert.ok(first >= 1);
  assert.ok(reminders.some((r) => /@late_one/.test(r.text)));
  sends.length = 0;
  await reach.runStaleBasketReminders();
  assert.equal(sends.filter((s) => s.kind === "telemetry" && /@late_one/.test(s.text)).length, 0, "no second reminder");
});

// ---------- Part 6: welcome on first login ----------

test("part 6: welcome asks the one question; the answer is stored on the user", async () => {
  const reach = await import("./client-reach");
  const c = await client({ email: "w@example.invalid", tg: false });
  await reach.sendWelcome(c.id);
  const mail = sends.find((s) => s.kind === "email");
  assert.ok(mail);
  assert.match(mail!.text, /What are you looking to do with Horizon\?/);
  await reach.setOnboardingGoal(c.id, "prop_challenge");
  const u = (await sql(`select onboarding_goal, onboarding_goal_at from users where id = $1`, [c.id])).rows[0];
  assert.equal(u.onboarding_goal, "prop_challenge");
  assert.ok(u.onboarding_goal_at);
  await assert.rejects(() => reach.setOnboardingGoal(c.id, "nonsense" as any));
});

test("part 6: welcome to an unreachable user does not alert the admin (the dashboard card covers it)", async () => {
  const reach = await import("./client-reach");
  const c = await client();
  portalRefuses = true;
  await reach.sendWelcome(c.id);
  assert.equal(sends.filter((s) => /can't be reached/.test(s.text)).length, 0);
  assert.equal((await sql(`select count(*)::int as n from client_unreachable_alerts where user_id = $1`, [c.id])).rows[0].n, 0);
});

// ---------- marcus m62167: the 5 user alerts are named by clientLine, no less than before ----------

test("m62167: a Telegram-only client is named by @username (+ link) on the expiry, basket and linked alerts", async () => {
  const sink = await import("./telemetry-sink");
  const client = { email: null, telegramUsername: "tg_alerts", userId: "0d5672ca-1111-4222-8333-444455556666", telegramUserId: "77" };
  await sink.notifyLicenseExpiringSoon({ client, licenseKey: "HHFT-AAAA-BBBB-CCCC", tier: "trial", expiresAt: new Date() });
  await sink.notifyLicenseExpired({ client, licenseKey: "HHFT-AAAA-BBBB-CCCC", tier: "trial", expiredAt: new Date() });
  await sink.notifyTelegramLinked({ client, linkedAt: new Date() });
  await sink.notifyBasketRequestSubmitted({ reference: "REQ-1", client, lines: [], hasTrial: false, adminUrl: "https://x" });
  const texts = sends.filter((x) => x.kind === "telemetry").map((x) => x.text);
  assert.equal(texts.length, 4);
  for (const t of texts) {
    assert.match(t, /client: @tg_alerts https:\/\/t\.me\/tg_alerts \(no email\)/, t);
    assert.doesNotMatch(t, /email: -/);
  }
});

test("m62167: an account with no Telegram at all still says 'telegram: none on file' on the expiry and basket alerts", async () => {
  const sink = await import("./telemetry-sink");
  const client = { email: "e@example.invalid", telegramUsername: null, userId: null, telegramUserId: null };
  await sink.notifyLicenseExpired({ client, licenseKey: "HHFT-AAAA-BBBB-CCCC", tier: "trial", expiredAt: new Date() });
  await sink.notifyBasketRequestSubmitted({ reference: "REQ-2", client, lines: [], hasTrial: false, adminUrl: "https://x" });
  for (const t of sends.filter((x) => x.kind === "telemetry").map((x) => x.text)) assert.match(t, /\nemail: e@example\.invalid\ntelegram: none on file\n/);
});

test("m62167: a free signup keeps a typed handle that differs from the account's @username", async () => {
  const sink = await import("./telemetry-sink");
  await sink.notifyFreeSignup({ client: { email: "f@example.invalid", telegramUsername: "real_name", userId: null }, telegramHandle: "@typed_other", joinedAt: new Date() });
  await sink.notifyFreeSignup({ client: { email: "g@example.invalid", telegramUsername: "same_one", userId: null }, telegramHandle: "same_one", joinedAt: new Date() });
  const [a, b] = sends.filter((x) => x.kind === "telemetry").map((x) => x.text);
  assert.match(a, /email: f@example\.invalid · telegram: @real_name https:\/\/t\.me\/real_name/);
  assert.match(a, /\ntyped telegram: @typed_other\n/);
  assert.doesNotMatch(b, /typed telegram/);
});

test("part 6: a Telegram signup's welcome skips the greeting (it already got the signup DM)", async () => {
  const reach = await import("./client-reach");
  assert.match(reach.welcomeMessage().message, /^Welcome to Horizon\./);
  assert.match(reach.welcomeMessage({ greet: false }).message, /^One question so we can help you/);
});
