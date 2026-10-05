/* Run: npx tsx --test --experimental-test-module-mocks src/app/admin/admin-trial-invite.test.ts
 *
 * marcus m60963 (3)+(4): the /admin dashboard's per-client "Issue license" / "Assign trial"
 * (issueLicenseAction) go through issueNewLicenseForUser, so a trial gets the trial text, the
 * feeds picked, a license_key_delivery row, and NO paid-group invite; Extend and Resend invite
 * make no paid-group invite for a user with no paid licence; the additional-licence send is
 * recorded too. The REAL server actions, driven with auth() and next/cache mocked; the same
 * PGlite + real migration chain as src/lib/assign-trial.test.ts. */
import { test, before, mock } from "node:test";
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
  TELEGRAM_PAID_GROUP_CHAT_ID: "-100777",
};

/* eslint-disable @typescript-eslint/no-explicit-any */
let db: any;
let dash: typeof import("./actions");
let panel: typeof import("./users/actions");
let licenses: typeof import("../../lib/licenses");
const sends: { kind: "dm" | "invite_link" | "email"; to: string; text: string }[] = [];

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
    if (u.includes(`/bot${ENV.HORIZON_PORTAL_BOT_TOKEN}/sendMessage`)) sends.push({ kind: "dm", to: String(body.chat_id), text: body.text });
    else if (u.includes(`/bot${ENV.HORIZON_PORTAL_BOT_TOKEN}/createChatInviteLink`)) {
      sends.push({ kind: "invite_link", to: String(body.chat_id), text: body.name });
      return new Response(JSON.stringify({ ok: true, result: { invite_link: "https://t.me/+paid-invite" } }), { status: 200 });
    } else if (u.includes("resend.com")) sends.push({ kind: "email", to: [body.to].flat().join(","), text: body.text });
    return new Response(JSON.stringify({ ok: true, result: { message_id: 4242 }, id: "email-id" }), { status: 200 });
  };
  const session = { user: { id: ADMIN, email: "hfthorizon@keemail.me", role: "admin", roles: ["admin"] } };
  mock.module("@/lib/auth", { namedExports: { auth: async () => session } });
  mock.module("next/cache", { namedExports: { revalidatePath: () => {} } });
  dash = await import("./actions");
  panel = await import("./users/actions");
  licenses = await import("../../lib/licenses");
  await sql(`insert into users (id, email, role) values ($1, 'hfthorizon@keemail.me', 'admin')`, [ADMIN]);
});

let seq = 0;
async function makeUser(opts: { telegram?: boolean } = {}) {
  seq++;
  const tg = opts.telegram === false ? null : 9000 + seq;
  const email = `dash${seq}@example.invalid`;
  const r = await sql(`insert into users (email, telegram_user_id) values ($1, $2) returning id`, [email, tg]);
  return { id: r.rows[0].id as string, email, telegramId: tg === null ? null : String(tg) };
}

function form(fields: Record<string, string | string[]>) {
  const fd = new FormData();
  for (const [k, v] of Object.entries(fields)) for (const x of [v].flat()) fd.append(k, x);
  return fd;
}
const sevenDays = { amount: "7", unit: "days" };

async function settle(r: Promise<{ ok: boolean; error?: string }>) {
  const res = await r;
  await licenses.settleLicenseBackgroundTasks();
  return res;
}
const invitesFor = (from: number, userId: string) => sends.slice(from).filter((s) => s.kind === "invite_link" && s.text === `paid-${userId}`);
const memberships = async (userId: string) => (await sql(`select tier, status from group_memberships where user_id = $1`, [userId])).rows;

test("the duration form fields this file sends are the ones parseDurationFormData reads", async () => {
  const { parseDurationFormData, resolveExpiresAt } = await import("../../lib/duration");
  const t0 = Date.now();
  const at = resolveExpiresAt(parseDurationFormData(form(sevenDays))).getTime();
  assert.ok(Math.abs(at - (t0 + 7 * DAY)) < 60_000, "7 days from now");
});

test("/admin Assign trial: trial text, the feeds picked, a delivery row, and NO paid-group invite", async () => {
  const u = await makeUser();
  const before = sends.length;
  const r = await settle(dash.issueLicenseAction(null, form({ userId: u.id, tier: "trial", feedTypes: ["london", "ny"], ...sevenDays })));
  assert.deepEqual(r, { ok: true });
  const lic = (await sql(`select id, tier, feed_types, license_key from licenses where user_id = $1`, [u.id])).rows;
  assert.equal(lic.length, 1);
  assert.equal(lic[0].tier, "trial");
  assert.deepEqual(lic[0].feed_types, ["london", "ny"]);

  const dms = sends.slice(before).filter((s) => s.kind === "dm" && s.to === u.telegramId);
  assert.equal(dms.length, 1, "the key DM only: no group invite DM");
  assert.match(dms[0].text, /^Your 7-day Horizon HFT trial is active\.\n/);
  assert.ok(dms[0].text.includes("Feeds included: London, New York"));
  assert.equal(invitesFor(before, u.id).length, 0, "no paid-group invite link was created");
  assert.deepEqual(await memberships(u.id), []);

  const acts = (await sql(`select admin_user_id, action_type, details_json from admin_actions where target_license_id = $1 order by action_type`, [lic[0].id])).rows;
  assert.deepEqual(acts.map((a) => a.action_type), ["admin_users_issue_license", "license_key_delivery"]);
  assert.equal(acts[0].admin_user_id, ADMIN);
  assert.equal(acts[0].details_json.via, "admin-dashboard");
  assert.deepEqual(acts[0].details_json.feedTypes, ["london", "ny"]);
  assert.deepEqual(acts[1].details_json, { licenseId: lic[0].id, channel: "telegram", ok: true, telegramMessageId: 4242 });
});

test("/admin Issue license, paid: the paid text, unchanged, and the paid-group invite (the control)", async () => {
  const u = await makeUser();
  const before = sends.length;
  const r = await settle(dash.issueLicenseAction(null, form({ userId: u.id, tier: "paid", ...sevenDays })));
  assert.deepEqual(r, { ok: true });
  const lic = (await sql(`select tier, license_key from licenses where user_id = $1`, [u.id])).rows[0];
  assert.equal(lic.tier, "paid");
  const dms = sends.slice(before).filter((s) => s.kind === "dm" && s.to === u.telegramId);
  assert.equal(dms[0].text.split("\n")[0], `Your license key: ${lic.license_key}`);
  assert.equal(invitesFor(before, u.id).length, 1, "the invite path is live: the trial test's 0 is not a dead stub");
  assert.deepEqual(await memberships(u.id), [{ tier: "paid", status: "invited" }]);
});

test("/admin Pre-provision (no userId): a claim licence, the 'issue_license' row, nothing sent", async () => {
  const email = `claim${++seq}@example.invalid`;
  const before = sends.length;
  const r = await settle(dash.issueLicenseAction(null, form({ email, tier: "trial", ...sevenDays })));
  assert.deepEqual(r, { ok: true });
  const lic = (await sql(`select id, user_id, claim_email, tier from licenses where claim_email = $1`, [email])).rows;
  assert.equal(lic.length, 1);
  assert.equal(lic[0].user_id, null);
  assert.equal(lic[0].tier, "trial");
  const acts = (await sql(`select action_type, target_user_id from admin_actions where details_json->>'licenseId' = $1`, [lic[0].id])).rows;
  assert.deepEqual(acts, [{ action_type: "issue_license", target_user_id: null }]);
  assert.equal(sends.slice(before).length, 0, "no DM, email or invite");
});

test("/admin Issue license still refuses on an active licence", async () => {
  const u = await makeUser();
  await sql(`insert into licenses (user_id, license_key, expires_at, tier) values ($1, $2, now() + interval '5 days', 'paid')`, [u.id, `DASHACT-${seq}`]);
  const r = await settle(dash.issueLicenseAction(null, form({ userId: u.id, tier: "trial", ...sevenDays })));
  assert.equal(r.ok, false);
  assert.equal((await sql(`select count(*)::int as n from licenses where user_id = $1`, [u.id])).rows[0].n, 1);
});

test("Extend: no paid-group invite for a trial-only user; still invites a paid one", async () => {
  const t = await makeUser();
  const p = await makeUser();
  const lt = (await sql(`insert into licenses (user_id, license_key, expires_at, tier) values ($1, $2, now() + interval '2 days', 'trial') returning id`, [t.id, `EXT-T-${seq}`])).rows[0].id;
  const lp = (await sql(`insert into licenses (user_id, license_key, expires_at, tier) values ($1, $2, now() + interval '2 days', 'paid') returning id`, [p.id, `EXT-P-${seq}`])).rows[0].id;
  const before = sends.length;
  assert.deepEqual(await settle(dash.extendLicenseAction(null, form({ licenseId: lt, userId: t.id, ...sevenDays }))), { ok: true });
  assert.deepEqual(await settle(dash.extendLicenseAction(null, form({ licenseId: lp, userId: p.id, ...sevenDays }))), { ok: true });
  assert.equal(invitesFor(before, t.id).length, 0, "trial extended: no invite");
  assert.equal(invitesFor(before, p.id).length, 1, "paid extended: invited, as before");
});

test("Resend invite: refused for a trial-only user, sent for a paid one", async () => {
  const t = await makeUser();
  const p = await makeUser();
  await sql(`insert into licenses (user_id, license_key, expires_at, tier) values ($1, $2, now() + interval '5 days', 'trial')`, [t.id, `RES-T-${seq}`]);
  await sql(`insert into licenses (user_id, license_key, expires_at, tier) values ($1, $2, now() + interval '5 days', 'deal')`, [p.id, `RES-P-${seq}`]);
  const before = sends.length;
  const rt = await settle(dash.resendGroupInviteAction(null, form({ userId: t.id })));
  assert.equal(rt.ok, false);
  assert.match(rt.error ?? "", /not sent to trials/);
  assert.deepEqual(await settle(dash.resendGroupInviteAction(null, form({ userId: p.id }))), { ok: true });
  assert.equal(invitesFor(before, t.id).length, 0);
  assert.equal(invitesFor(before, p.id).length, 1);
});

test("hasActivePaidLicence: paid/team/deal count; trial, expired and revoked do not", async () => {
  const cases: [string, string, string, boolean][] = [
    ["trial", "active", "5 days", false],
    ["paid", "active", "5 days", true],
    ["team", "active", "5 days", true],
    ["deal", "active", "5 days", true],
    ["paid", "active", "-1 days", false],
    ["paid", "revoked", "5 days", false],
  ];
  for (const [tier, status, interval, want] of cases) {
    const u = await makeUser();
    await sql(`insert into licenses (user_id, license_key, status, expires_at, tier) values ($1, $2, $3, now() + $4::interval, $5)`, [u.id, `HAP-${seq}`, status, interval, tier]);
    assert.equal(await licenses.hasActivePaidLicence(u.id), want, `${tier}/${status}/${interval}`);
  }
});

test("/admin/users Issue additional license: the key send leaves a license_key_delivery row", async () => {
  const u = await makeUser({ telegram: false });
  await sql(`insert into licenses (user_id, license_key, expires_at, tier) values ($1, $2, now() + interval '20 days', 'paid')`, [u.id, `ADD-${seq}`]);
  const r = await settle(panel.issueAdditionalLicenseAction(null, form({ userId: u.id, tier: "paid", feedTypes: "ny", ...sevenDays })));
  assert.deepEqual(r, { ok: true });
  const lic = (await sql(`select id from licenses where user_id = $1 and license_key <> $2`, [u.id, `ADD-${seq}`])).rows;
  assert.equal(lic.length, 1);
  const d = (await sql(`select details_json from admin_actions where target_license_id = $1 and action_type = 'license_key_delivery'`, [lic[0].id])).rows;
  assert.deepEqual(d.map((x) => x.details_json), [{ licenseId: lic[0].id, channel: "email", ok: true, resendEmailId: "email-id" }]);
});
