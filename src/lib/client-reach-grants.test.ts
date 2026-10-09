/* Run: npx tsx --test src/lib/client-reach-grants.test.ts
 *
 * Fable's strikes on fb41fac (m62193), ruled by marcus m62190:
 *   S1: the feed-tier approve/decline and the Black trial approve/decline reach the client the client-reach way:
 *       banner on a grant; the original message unchanged when it lands, with no extra DM; when it reaches
 *       nobody, the portal bot then email, else the unreachable row + approvals alert.
 *   S2: a client blocked on a DM who then presses Start in the portal bot is reachable again (badge + Sent CTA).
 *   N1: a Telegram throw on the licence-key send still leaves the approved banner.
 * Fail-first: against fb41fac 9 of 10 fail. The one that passes there is the guard "a DM that fails AFTER the
 * /start is blocked again": S2 must not make a fresh block look reachable, before or after.
 * Same harness as client-reach.test.ts: PGlite with the REAL migration chain through db.ts's global._pgPool seam,
 * every outbound send captured per bot instead of made. */
import { test, before, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { PGlite } from "@electric-sql/pglite";

const MIGRATIONS = path.join(process.cwd(), "db/migrations");
const SEED_PROVIDER = "00000000-0000-4000-8000-0000000000a1";
const ADMIN = "00000000-0000-4000-8000-00000000e002";
const PIP = "00000000-0000-4000-8000-00000000e001";
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
  TELEGRAM_HFT_ALERT_BOT_TOKEN: "alerts-token",
  TELEMETRY_BOT_TOKEN: "telemetry-token",
  AUTH_RESEND_KEY: "re_test",
  EMAIL_FROM: "Horizon <noreply@example.invalid>",
};

/* eslint-disable @typescript-eslint/no-explicit-any */
let db: any;
type Send = { kind: "portal" | "alerts" | "telemetry" | "email"; to: string; text: string; subject?: string };
const sends: Send[] = [];
let portalRefuses = false;
let portalThrows = false;
let alertsRefuse = false;

async function sql(text: string, params: unknown[] = []) {
  const r = await db.query(text, params);
  return { rows: r.rows as any[], rowCount: (r.rows.length || r.affectedRows || 0) as number };
}

const refused = () =>
  new Response(JSON.stringify({ ok: false, error_code: 403, description: "Forbidden: bot can't initiate conversation with a user" }), { status: 403 });

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
  delete process.env.TELEGRAM_WEBHOOK_SECRET;
  (globalThis as any).fetch = async (url: string, init?: { body?: string }) => {
    const u = String(url);
    const body = init?.body ? JSON.parse(init.body) : {};
    if (u.includes(`/bot${ENV.HORIZON_PORTAL_BOT_TOKEN}/`)) {
      if (u.endsWith("/sendMessage")) {
        if (portalThrows) throw new TypeError("fetch failed");
        if (portalRefuses) return refused();
        sends.push({ kind: "portal", to: String(body.chat_id), text: body.text });
      }
    } else if (u.includes(`/bot${ENV.TELEGRAM_HFT_ALERT_BOT_TOKEN}/`)) {
      if (u.endsWith("/sendMessage")) {
        if (alertsRefuse) return refused();
        sends.push({ kind: "alerts", to: String(body.chat_id), text: body.text });
      }
    } else if (u.includes(`/bot${ENV.TELEMETRY_BOT_TOKEN}/`)) {
      sends.push({ kind: "telemetry", to: String(body.chat_id), text: body.text });
    } else if (u.includes("resend.com")) {
      sends.push({ kind: "email", to: [body.to].flat().join(","), text: body.text, subject: body.subject });
    }
    return new Response(JSON.stringify({ ok: true, result: { message_id: 4242, username: "HorizonPortalBot" }, id: "email-id" }), { status: 200 });
  };
  await sql(`insert into users (id, email, role) values ($1, 'pip@example.invalid', 'feed_provider'), ($2, 'admin@example.invalid', 'admin')`, [PIP, ADMIN]);
  await sql(`update feed_tiers set provider_user_id = $1 where tier_key in ('ny-normal', 'ny-fast')`, [PIP]);
});

beforeEach(() => {
  sends.length = 0;
  portalRefuses = false;
  portalThrows = false;
  alertsRefuse = false;
});

let seq = 0;
/** A client with a live licence and one registered server (the feed-tier fixture). email null = Telegram only. */
async function buyer(opts: { email?: string | null } = {}) {
  seq++;
  const email = opts.email === undefined ? null : opts.email;
  const tgId = String(950000 + seq);
  const u = await sql(`insert into users (email, display_name, telegram_user_id, telegram_username) values ($1, $2, $3, $4) returning id`, [
    email,
    `buyer ${seq}`,
    tgId,
    `buyer${seq}`,
  ]);
  const userId = u.rows[0].id as string;
  const l = await sql(`insert into licenses (user_id, license_key, expires_at) values ($1, $2, now() + interval '60 days') returning id`, [
    userId,
    `KEY-REACH-${seq}`,
  ]);
  const licenseId = l.rows[0].id as string;
  const s = await sql(
    `insert into server_registrations (license_id, user_id, server_name, vps_provider, server_location, declared_ip)
     values ($1, $2, 'srv', 'other', 'Chicago', $3) returning id`,
    [licenseId, userId, `10.9.0.${seq}`]
  );
  return { userId, licenseId, serverId: s.rows[0].id as string, tgId };
}

async function requestOne(b: Awaited<ReturnType<typeof buyer>>, tierKey: string): Promise<string> {
  const ar = await import("./access-requests");
  const tierId = (await sql(`select id from feed_tiers where tier_key = $1`, [tierKey])).rows[0].id;
  const { requestIds } = await ar.createAccessRequestBatch({
    userId: b.userId,
    items: [{ kind: "feed_tier", serverRegistrationId: b.serverId, feedTierId: tierId }],
  });
  return requestIds[0];
}

const notices = async (userId: string) =>
  (await sql(`select what from client_notices where user_id = $1 and kind = 'approved' and dismissed_at is null`, [userId])).rows.map((r: any) => r.what as string);
const unreachableRows = async (userId: string) =>
  (await sql(`select what, alert_sent_at from client_unreachable_alerts where user_id = $1`, [userId])).rows;

// ---------- S1: feed-tier approve / decline ----------

test("S1 feed: paid approval DM delivered by the Trading Alerts bot -> banner, and NOTHING more is sent (no extra DM)", async () => {
  const ftr = await import("./feed-tier-requests");
  const b = await buyer();
  const id = await requestOne(b, "ny-normal");
  await ftr.approveFeedTierRequest(id, ADMIN, "u", { decision: "paid", endsAt: new Date(Date.now() + 30 * 864e5), invoiceRef: "INV-R1" });
  const toClient = sends.filter((s) => s.kind !== "telemetry");
  assert.deepEqual(toClient.map((s) => s.kind), ["alerts"], `exactly the old DM, got ${JSON.stringify(toClient)}`);
  assert.match(toClient[0].text, /Feed access approved/);
  // The banner is the S1 addition; on fb41fac this part fails.
  const n = await notices(b.userId);
  assert.equal(n.length, 1, "approved banner");
  assert.match(n[0], /NY .*feed access until \d{4}-\d{2}-\d{2}/);
});

test("S1 feed: approval DM refused by the Trading Alerts bot -> the approval goes by the portal bot (recorded), banner, no alert", async () => {
  const ftr = await import("./feed-tier-requests");
  const b = await buyer();
  const id = await requestOne(b, "ny-normal");
  alertsRefuse = true;
  await ftr.approveFeedTierRequest(id, ADMIN, "u", { decision: "paid", endsAt: new Date(Date.now() + 30 * 864e5), invoiceRef: "INV-R2" });
  const portal = sends.filter((s) => s.kind === "portal");
  assert.equal(portal.length, 1, `one portal-bot follow-up, got ${JSON.stringify(sends)}`);
  assert.match(portal[0].text, /Your request is approved: NY .*feed access/);
  assert.match(portal[0].text, /\/account\/servers/);
  const u = (await sql(`select tg_last_dm_ok from users where id = $1`, [b.userId])).rows[0];
  assert.equal(u.tg_last_dm_ok, true, "the portal bot's result is recorded");
  assert.equal((await unreachableRows(b.userId)).length, 0);
  assert.equal((await notices(b.userId)).length, 1);
});

test("S1 feed: trial approved, Trading Alerts bot refused, portal bot refused, no email -> unreachable row + approvals alert + banner", async () => {
  const ftr = await import("./feed-tier-requests");
  const b = await buyer();
  const id = await requestOne(b, "ny-normal");
  alertsRefuse = true;
  portalRefuses = true;
  await ftr.approveFeedTierRequest(id, ADMIN, "u"); // the Telegram card: a 7-day trial
  const rows = await unreachableRows(b.userId);
  assert.equal(rows.length, 1, "one unreachable row");
  assert.match(rows[0].what, /NY .*trial until/);
  assert.ok(rows[0].alert_sent_at, "alert sent");
  assert.ok(sends.some((s) => s.kind === "telemetry" && /can't be reached/.test(s.text) && new RegExp(`@buyer${seq}`).test(s.text)));
  assert.equal((await notices(b.userId)).length, 1);
});

test("S1 feed: a decline that reaches nobody on the Trading Alerts bot goes by the portal bot; no banner", async () => {
  const ftr = await import("./feed-tier-requests");
  const b = await buyer();
  const id = await requestOne(b, "ny-normal");
  alertsRefuse = true;
  await ftr.rejectFeedTierRequest(id, ADMIN, "not available");
  const portal = sends.filter((s) => s.kind === "portal");
  assert.equal(portal.length, 1, `decline follow-up, got ${JSON.stringify(sends)}`);
  assert.match(portal[0].text, /request was declined\.\nReason: not available/);
  assert.equal((await notices(b.userId)).length, 0, "a decline gets no approved banner");
});

// ---------- S1: Black trial approve / decline ----------

async function blackRequest(b: Awaited<ReturnType<typeof buyer>>): Promise<string> {
  const r = await sql(`insert into black_trials (user_id, license_id) values ($1, $2) returning id`, [b.userId, b.licenseId]);
  return r.rows[0].id as string;
}

test("S1 Black: approve, portal bot refused, email on file -> plain-text email, DM result recorded, banner", async () => {
  const bt = await import("./black-trials");
  const b = await buyer({ email: "black1@example.invalid" });
  const id = await blackRequest(b);
  portalRefuses = true;
  await bt.approveBlackTrial({ id, actionedBy: ADMIN, endpoint: "e", credentials: "c" });
  const mail = sends.filter((s) => s.kind === "email");
  assert.equal(mail.length, 1, `email fallback, got ${JSON.stringify(sends)}`);
  assert.match(mail[0].text, /Your Black trial is live/);
  assert.doesNotMatch(mail[0].text, /<\/?b>/, "no raw Telegram markup in the email");
  const u = (await sql(`select tg_last_dm_ok, tg_last_dm_error from users where id = $1`, [b.userId])).rows[0];
  assert.equal(u.tg_last_dm_ok, false);
  assert.match(u.tg_last_dm_error, /403/);
  assert.deepEqual(await notices(b.userId), ["Black trial, 3 days"]);
  assert.equal((await unreachableRows(b.userId)).length, 0);
});

test("S1 Black: approve reaching nobody -> unreachable row + approvals alert", async () => {
  const bt = await import("./black-trials");
  const b = await buyer();
  const id = await blackRequest(b);
  portalRefuses = true;
  await bt.approveBlackTrial({ id, actionedBy: ADMIN, endpoint: "e", credentials: "c" });
  const rows = await unreachableRows(b.userId);
  assert.equal(rows.length, 1);
  assert.match(rows[0].what, /Black trial/);
});

test("S1 Black: a delivered approval is the same single portal DM as before", async () => {
  const bt = await import("./black-trials");
  const b = await buyer({ email: "black3@example.invalid" });
  const id = await blackRequest(b);
  await bt.approveBlackTrial({ id, actionedBy: ADMIN, endpoint: "e", credentials: "c" });
  const toClient = sends.filter((s) => s.kind !== "telemetry");
  assert.deepEqual(toClient.map((s) => s.kind), ["portal"], JSON.stringify(toClient));
  assert.match(toClient[0].text, /^<b>⚫️ Your Black trial is live<\/b>/);
  // Recorded on the user: on fb41fac this send bypassed notifyUser.
  const u = (await sql(`select tg_last_dm_ok from users where id = $1`, [b.userId])).rows[0];
  assert.equal(u.tg_last_dm_ok, true);
});

// ---------- S2: /start clears "blocked" ----------

test("S2: blocked (403) -> the client presses Start in the portal bot -> reachable, no 'turn on notifications'", async () => {
  const reach = await import("./client-reach");
  const route = await import("../app/api/telegram/webhook/route");
  const b = await buyer();
  await sql(
    `update users set tg_last_dm_at = now() - interval '1 day', tg_last_dm_ok = false, tg_last_dm_error = '403 Forbidden: bot can''t initiate conversation with a user' where id = $1`,
    [b.userId]
  );
  const before = await reach.clientReachForUser(b.userId);
  assert.equal(before.reachable, false);
  assert.equal(before.needsBotStart, true);

  const req = new Request("https://portal.horizonhft.com/api/telegram/webhook", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ message: { text: "/start notify", chat: { id: Number(b.tgId) }, from: { id: Number(b.tgId), username: `buyer${seq}` } } }),
  });
  const res = await route.POST(req as any);
  assert.equal(res.status, 200);

  const after = await reach.clientReachForUser(b.userId);
  assert.equal(after.reachable, true, "reachable after /start");
  assert.equal(after.needsBotStart, false, "the Sent-step CTA is gone");
  const c = (await reach.getClientContact(b.userId))!;
  assert.match(reach.reachability(c).label, /^Telegram: bot started \d\d-\d\d, after blocked \(403\) \d\d-\d\d · no email$/);
});

test("S2: a DM that fails AFTER the /start is blocked again", async () => {
  const { reachability } = await import("./client-reach");
  const r = reachability({
    email: null,
    telegramUserId: "1",
    botStartedAt: new Date("2026-10-07T10:00:00Z"),
    tgLastDmAt: new Date("2026-10-08T10:00:00Z"),
    tgLastDmOk: false,
    tgLastDmError: "403 Forbidden: bot was blocked by the user",
  });
  assert.equal(r.reachable, false);
  assert.match(r.label, /^Telegram: blocked \(403\) 10-08 · no email · can't be reached$/);
});

// ---------- N1: the banner survives a Telegram throw on the key send ----------

test("N1: licence issued, the key send's Telegram THROWS (propagates as before) -> the approved banner is still there", async () => {
  const inl = await import("./issue-new-license");
  // No licence yet (buyer() holds one, and issueLicense refuses a second active licence).
  const u = await sql(`insert into users (email, telegram_user_id) values ('n1@example.invalid', '959999') returning id`);
  const userId = u.rows[0].id as string;
  portalThrows = true;
  await assert.rejects(
    inl.issueNewLicenseForUser({ actorUserId: ADMIN, userId, expiresAt: new Date(Date.now() + 30 * 864e5), feedTypes: ["london"], tier: "trial" }),
    (err: unknown) => err instanceof TypeError && /fetch failed/.test(err.message),
    "the key send's Telegram throw propagates, as before"
  );
  assert.equal((await notices(userId)).length, 1, "banner written before the send");
});
