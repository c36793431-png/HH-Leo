/* Run: npx tsx --test src/lib/feed-boxes.test.ts
 *
 * Feed auto-provision, portal side (coxwell GO via marcus m62546; Fable's design m62433; token per box and record id
 * per marcus m62718). Fail-first: on the code before this branch every test here fails (no feed_boxes, no routes).
 * Real Postgres, no prod: PGlite with the REAL migration chain through db.ts's global._pgPool seam (the
 * access-requests-admin-trial.test.ts harness). Grants are made by the shipped approve path (approveAccessRequest),
 * so every allowlist record has the shape the portal really writes. Outbound sends are captured, never made. */
import { test, before, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { generateKeyPairSync, verify } from "node:crypto";
import { PGlite } from "@electric-sql/pglite";

const MIGRATIONS = path.join(process.cwd(), "db/migrations");
const SEED_PROVIDER = "00000000-0000-4000-8000-0000000000a1";
const PIP = "00000000-0000-4000-8000-00000000f001";
const ADMIN = "00000000-0000-4000-8000-00000000f002";
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
const sends: { kind: string; text: string }[] = [];
const { publicKey, privateKey } = generateKeyPairSync("ed25519");

async function sql(text: string, params: unknown[] = []) {
  const r = await db.query(text, params);
  return { rows: r.rows as any[], rowCount: (r.rows.length || r.affectedRows || 0) as number };
}

let CME = "";
let NY = "";

before(async () => {
  db = new PGlite();
  const files = readdirSync(MIGRATIONS).filter((f) => f.endsWith(".sql") && !f.includes("rollback")).sort();
  for (const f of files) {
    if (SKIPPED.has(f)) continue;
    if (SEEDS[f]) await db.exec(SEEDS[f]);
    await db.exec(readFileSync(path.join(MIGRATIONS, f), "utf8"));
  }
  (globalThis as any)._pgPool = { query: sql, connect: async () => ({ query: sql, release() {} }), end: async () => {} };
  Object.assign(process.env, {
    NEON_DATABASE_URL: "postgres://unused",
    VERCEL_ENV: "production",
    LICENSE_SIGNING_PRIVATE_KEY: privateKey.export({ type: "pkcs8", format: "pem" }).toString(),
    LICENSE_SIGNING_KID: "test",
    CRON_SECRET: "test-cron",
    HORIZON_PORTAL_BOT_TOKEN: "portal-token",
    AUTH_RESEND_KEY: "re_test",
    EMAIL_FROM: "Horizon <noreply@example.invalid>",
    TELEMETRY_BOT_TOKEN: "telemetry-token",
    TELEGRAM_HFT_ALERT_BOT_TOKEN: "alerts-token",
  });
  delete process.env.AUTOPROVISION_EXPIRY_ENABLED;
  (globalThis as any).fetch = async (url: string, init?: { body?: string }) => {
    const u = String(url);
    const body = init?.body ? JSON.parse(init.body) : {};
    if (u.includes("/botportal-token/sendMessage")) sends.push({ kind: "portal", text: body.text });
    else if (u.includes("resend.com")) sends.push({ kind: "email", text: body.text });
    else if (u.includes("/sendMessage")) sends.push({ kind: "other-bot", text: body.text });
    return new Response(JSON.stringify({ ok: true, result: { message_id: 1 }, id: "e" }), { status: 200 });
  };
  await sql(`insert into users (id, email, role) values ($1, 'pip@example.invalid', 'feed_provider'), ($2, 'admin@example.invalid', 'admin')`, [PIP, ADMIN]);
  // The CME row is a hand INSERT on prod (provider_tiers dff16179), not a migration: same as the admin-trial test.
  await sql(
    `insert into feed_tiers (region_key, tier_key, name, subtitle, speed_display, description, path_redundancy, support_level, provider_user_id)
     values ('cme', 'cme-ctrader-fix', 'CME Futures · cTrader FIX', 'cTrader FIX', '-', 'CME futures', 'Single path', 'Standard', $1)`,
    [PIP]
  );
  await sql(`update feed_tiers set provider_user_id = $1 where tier_key in ('ny-normal', 'ny-fast')`, [PIP]);
  CME = (await sql(`select id from feed_tiers where tier_key = 'cme-ctrader-fix'`)).rows[0].id;
  NY = (await sql(`select id from feed_tiers where tier_key = 'ny-normal'`)).rows[0].id;
});

beforeEach(() => {
  sends.length = 0;
  delete process.env.AUTOPROVISION_EXPIRY_ENABLED;
  process.env.VERCEL_ENV = "production";
});

let seq = 0;
/** A client with a licence, one server at `ip`, and a PAID grant on `tierId` made by the shipped approve path. */
async function granted(tierId: string, ip: string) {
  seq++;
  const ar = await import("./access-requests");
  const u = await sql(`insert into users (email, telegram_user_id) values ($1, $2) returning id`, [`fb${seq}@example.invalid`, String(970000 + seq)]);
  const userId = u.rows[0].id as string;
  const l = await sql(`insert into licenses (user_id, license_key, expires_at) values ($1, $2, now() + interval '60 days') returning id`, [userId, `KEY-FB-${seq}`]);
  const s = await sql(
    `insert into server_registrations (license_id, user_id, server_name, vps_provider, server_location, declared_ip)
     values ($1, $2, $3, 'other', 'Chicago', $4) returning id`,
    [l.rows[0].id, userId, `srv${seq}`, ip]
  );
  const serverId = s.rows[0].id as string;
  const { requestIds } = await ar.createAccessRequestBatch({ userId, items: [{ kind: "feed_tier", serverRegistrationId: serverId, feedTierId: tierId }] });
  await ar.approveAccessRequest({ requestId: requestIds[0], decidedBy: ADMIN, decision: "paid", endsAt: new Date(Date.now() + 30 * 864e5), invoiceRef: `INV-${seq}` } as any);
  const rec = (await sql(`select id from feed_allowlist_records where server_registration_id = $1 and feed_tier_id = $2`, [serverId, tierId])).rows[0];
  assert.ok(rec, "the approve path wrote an allowlist record");
  return { userId, serverId, recordId: rec.id as string };
}

let boxSeq = 0;
async function newBox(tierIds: string[]) {
  const fb = await import("./feed-boxes");
  boxSeq++;
  const name = `cme-box-${boxSeq}`;
  const id = await fb.createFeedBox(name, tierIds);
  const { token } = await fb.issueBoxToken(id);
  return { id, name, token };
}

async function getList(token: string) {
  const route = await import("../app/api/feed-box/allowlist/route");
  const res = await route.GET(new Request("https://portal.horizonhft.com/api/feed-box/allowlist", { headers: { authorization: `Bearer ${token}` } }) as any);
  return { status: res.status, body: (await res.json()) as any, cache: res.headers.get("cache-control") };
}

async function postApplied(token: string, body: unknown) {
  const route = await import("../app/api/feed-box/applied/route");
  const res = await route.POST(
    new Request("https://portal.horizonhft.com/api/feed-box/applied", {
      method: "POST",
      headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
      body: JSON.stringify(body),
    }) as any
  );
  return { status: res.status, body: (await res.json()) as any };
}

// ---------- tokens ----------

test("token: 32 random bytes shown once; only its sha256 is stored; rotating kills the old token at once", async () => {
  const fb = await import("./feed-boxes");
  const box = await newBox([CME]);
  assert.match(box.token, /^[A-Za-z0-9_-]{43}$/);
  const row = (await sql(`select * from feed_boxes where id = $1`, [box.id])).rows[0];
  assert.equal(row.token_sha256, fb.sha256Hex(box.token));
  assert.ok(!JSON.stringify(row).includes(box.token), "the token itself is nowhere in the row");
  assert.equal((await getList(box.token)).status, 200);
  const { token: next } = await fb.issueBoxToken(box.id);
  assert.equal((await getList(box.token)).status, 401, "old token refused after rotation");
  assert.equal((await getList(next)).status, 200);
});

test("auth: no token, a wrong token and a malformed header are 401; outside production it is 404 even with a good token", async () => {
  const box = await newBox([CME]);
  assert.equal((await getList("x".repeat(43))).status, 401);
  assert.equal((await getList("short")).status, 401);
  const route = await import("../app/api/feed-box/allowlist/route");
  const res = await route.GET(new Request("https://p/api/feed-box/allowlist") as any);
  assert.equal(res.status, 401);
  process.env.VERCEL_ENV = "preview";
  assert.equal((await getList(box.token)).status, 404, "a preview shares the prod DB: it must never answer the box");
});

// ---------- the allowlist ----------

test("allowlist: signed Ed25519 over canonical JSON; serial rises on every response; issued_at is now; no-store", async () => {
  const sign = await import("./response-signing");
  const box = await newBox([CME]);
  const a = await getList(box.token);
  const b = await getList(box.token);
  assert.equal(a.status, 200);
  assert.equal(a.cache, "no-store");
  for (const r of [a, b]) {
    const ok = verify(null, Buffer.from(sign.canonicalize(r.body.data), "utf8"), publicKey, Buffer.from(r.body.sig, "base64url"));
    assert.equal(ok, true, "signature verifies with the public key");
    assert.equal(r.body.kid, "test");
    assert.equal(r.body.data.box, box.name);
    assert.equal(r.body.data.purpose, "feed-box-allowlist", "domain separation (Fable m62985 Q1)");
    assert.ok(Math.abs(Date.parse(r.body.data.issued_at) - Date.now()) < 10_000);
  }
  assert.equal(b.body.data.serial, a.body.data.serial + 1);
  // A body edited in transit no longer verifies.
  const forged = { ...a.body.data, records: [...a.body.data.records, { record_id: "x", ip: "203.0.113.66", tier_key: "cme-ctrader-fix" }] };
  assert.equal(verify(null, Buffer.from(sign.canonicalize(forged), "utf8"), publicKey, Buffer.from(a.body.sig, "base64url")), false);
});

test("allowlist: never served unsigned: no signing key = 503", async () => {
  const box = await newBox([CME]);
  const key = process.env.LICENSE_SIGNING_PRIVATE_KEY;
  delete process.env.LICENSE_SIGNING_PRIVATE_KEY;
  try {
    assert.equal((await getList(box.token)).status, 503);
  } finally {
    process.env.LICENSE_SIGNING_PRIVATE_KEY = key;
  }
});

test("allowlist: the OPEN set: this box's tiers only, not revoked; a lapsed record is still served until the job revokes it (Fable S1); bad IPs skipped", async () => {
  const box = await newBox([CME]);
  const live = await granted(CME, "203.0.113.10");
  const otherTier = await granted(NY, "203.0.113.11");
  const lapsed = await granted(CME, "203.0.113.12");
  await sql(`update feed_subscriptions set status = 'lapsed' where server_registration_id = $1`, [lapsed.serverId]);
  const revoked = await granted(CME, "203.0.113.13");
  await sql(`update feed_allowlist_records set revoked_at = now() where id = $1`, [revoked.recordId]);
  const cidr = await granted(CME, "198.51.100.0/24");
  const priv = await granted(CME, "10.1.2.3");

  const { body } = await getList(box.token);
  const ids = body.data.records.map((r: any) => r.record_id);
  assert.ok(ids.includes(live.recordId), "live CME record listed");
  assert.deepEqual(body.data.records.find((r: any) => r.record_id === live.recordId), { record_id: live.recordId, ip: "203.0.113.10", tier_key: "cme-ctrader-fix", lapsed_since: null });
  // S1: liveness never cuts in a GET; only the expiry job turns a lapse into a revoke (stamp, message, 3-day grace).
  assert.ok(ids.includes(lapsed.recordId), "a lapsed subscription's record is still served until it is revoked");
  for (const [what, r] of [["other tier", otherTier], ["revoked", revoked], ["cidr", cidr], ["private", priv]] as const) {
    assert.ok(!ids.includes(r.recordId), `${what} not in records`);
  }
  const skipped = Object.fromEntries(body.data.skipped.map((s: any) => [s.record_id, s.reason]));
  assert.equal(skipped[cidr.recordId], "CIDR range, not a single host");
  assert.equal(skipped[priv.recordId], "private address");
  assert.ok(!(lapsed.recordId in skipped) && !(otherTier.recordId in skipped));
  assert.ok(body.data.records.every((r: any) => /^\d+\.\d+\.\d+\.\d+$/.test(r.ip)), "only /32 host addresses");
});

test("hostIpProblem: public and TEST-NET hosts pass; CIDR, private, loopback, CGNAT, multicast, malformed and IPv6 do not", async () => {
  const { hostIpProblem } = await import("./feed-boxes");
  for (const ok of ["8.8.8.8", "203.0.113.5", "192.0.2.1", " 88.99.67.48 "]) assert.equal(hostIpProblem(ok), null, ok);
  for (const bad of ["1.2.3.0/24", "10.0.0.1", "172.20.1.1", "192.168.1.1", "127.0.0.1", "169.254.1.1", "100.64.0.1", "0.0.0.0", "224.0.0.1", "255.255.255.255", "1.2.3", "01.2.3.4", "256.1.1.1", "::1", "fe80::1"]) {
    assert.notEqual(hostIpProblem(bad), null, bad);
  }
});

// ---------- the write-back ----------

test("write-back: applied -> applied_at/by 'box:<name>'/result recorded; told_at (the human tick) untouched", async () => {
  const box = await newBox([CME]);
  const g = await granted(CME, "203.0.113.20");
  const before = (await sql(`select told_at from feed_allowlist_records where id = $1`, [g.recordId])).rows[0].told_at;
  const at = new Date().toISOString();
  const r = await postApplied(box.token, { record_id: g.recordId, applied_at: at, result: "applied" });
  assert.equal(r.status, 200, JSON.stringify(r.body));
  const row = (await sql(`select told_at, applied_at, applied_by, apply_result, apply_reason from feed_allowlist_records where id = $1`, [g.recordId])).rows[0];
  assert.equal(row.applied_by, `box:${box.name}`);
  assert.equal(row.apply_result, "applied");
  assert.equal(new Date(row.applied_at).toISOString(), at);
  assert.equal(new Date(row.told_at).getTime(), new Date(before).getTime());
});

test("write-back: refused: another box's tier (404), unknown field, rejected without reason, future or ancient applied_at (400)", async () => {
  const box = await newBox([CME]);
  const ny = await granted(NY, "203.0.113.21");
  const cme = await granted(CME, "203.0.113.22");
  const now = new Date().toISOString();
  assert.equal((await postApplied(box.token, { record_id: ny.recordId, applied_at: now, result: "applied" })).status, 404);
  assert.equal((await postApplied(box.token, { record_id: cme.recordId, applied_at: now, result: "applied", told_at: now })).status, 400);
  assert.equal((await postApplied(box.token, { record_id: cme.recordId, applied_at: now, result: "rejected" })).status, 400);
  assert.equal((await postApplied(box.token, { record_id: cme.recordId, applied_at: new Date(Date.now() + 3600e3).toISOString(), result: "applied" })).status, 400);
  assert.equal((await postApplied(box.token, { record_id: cme.recordId, applied_at: new Date(Date.now() - 8 * 864e5).toISOString(), result: "applied" })).status, 400);
  assert.equal((await postApplied(box.token, { record_id: cme.recordId, applied_at: now, result: "deleted" })).status, 400);
  assert.equal((await postApplied("y".repeat(43), { record_id: cme.recordId, applied_at: now, result: "applied" })).status, 401);
  const row = (await sql(`select applied_at from feed_allowlist_records where id = $1`, [cme.recordId])).rows[0];
  assert.equal(row.applied_at, null, "nothing written by a refused call");
});

test("write-back: a revoked record takes 'removed' (or 'rejected') but never 'applied' (409)", async () => {
  const box = await newBox([CME]);
  const g = await granted(CME, "203.0.113.23");
  await sql(`update feed_allowlist_records set revoked_at = now() where id = $1`, [g.recordId]);
  const now = new Date().toISOString();
  assert.equal((await postApplied(box.token, { record_id: g.recordId, applied_at: now, result: "applied" })).status, 409);
  assert.equal((await postApplied(box.token, { record_id: g.recordId, applied_at: now, result: "removed" })).status, 200);
});

// ---------- dashboard state ----------

test("state: pending until the box applies; 'pending bridge reload' is never 'active'; rejected shows the reason", async () => {
  const fb = await import("./feed-boxes");
  const box = await newBox([CME]);
  const g = await granted(CME, "203.0.113.30");
  const state = async () => (await fb.listBoxRecords(box.id)).find((r) => r.recordId === g.recordId)!.state;
  assert.equal((await state()).kind, "pending");
  const now = new Date().toISOString();
  await postApplied(box.token, { record_id: g.recordId, applied_at: now, result: "pending_bridge_reload" });
  assert.deepEqual(await state(), { kind: "pending", label: "pending bridge reload (firewall only)" });
  await postApplied(box.token, { record_id: g.recordId, applied_at: now, result: "rejected", reason: "protected IP" });
  assert.deepEqual(await state(), { kind: "rejected", label: "rejected by the box: protected IP" });
  await postApplied(box.token, { record_id: g.recordId, applied_at: now, result: "applied" });
  assert.match((await state()).label, /^active, applied \d{4}-\d{2}-\d{2} \d{2}:\d{2} UTC$/);
  await sql(`update feed_subscriptions set status = 'lapsed' where server_registration_id = $1`, [g.serverId]);
  assert.deepEqual(await state(), { kind: "ending", label: "subscription lapsed; the expiry job revokes it 3 days after it first sees it" });
  await sql(`update feed_allowlist_records set lapse_seen_at = '2026-10-09T08:00:00Z' where id = $1`, [g.recordId]);
  assert.deepEqual(await state(), { kind: "ending", label: "subscription lapsed; the expiry job revokes it 3 days after it first sees it (client told 2026-10-09 08:00 UTC)" });
});

// ---------- expiry job ----------

async function runExpiry() {
  const route = await import("../app/api/cron/expire-allowlist/route");
  const res = await route.GET(new Request("https://p/api/cron/expire-allowlist", { headers: { authorization: "Bearer test-cron" } }) as any);
  return { status: res.status, body: (await res.json()) as any };
}

test("expiry OFF (default): reports the lapsed record, writes NOTHING, tells nobody", async () => {
  await newBox([CME]);
  const g = await granted(CME, "203.0.113.40");
  await sql(`update feed_subscriptions set status = 'lapsed' where server_registration_id = $1`, [g.serverId]);
  const r = await runExpiry();
  assert.equal(r.status, 200);
  assert.equal(r.body.enabled, false);
  assert.ok(r.body.lapsed.some((x: any) => x.recordId === g.recordId));
  assert.deepEqual([r.body.stamped, r.body.revoked, r.body.cleared], [[], [], []]);
  const row = (await sql(`select lapse_seen_at, revoked_at from feed_allowlist_records where id = $1`, [g.recordId])).rows[0];
  assert.deepEqual([row.lapse_seen_at, row.revoked_at], [null, null]);
  assert.equal(sends.length, 0);
  const bad = await (await import("../app/api/cron/expire-allowlist/route")).GET(new Request("https://p/x", { headers: { authorization: "Bearer nope" } }) as any);
  assert.equal(bad.status, 401);
});

test("expiry ON: first sighting stamps + tells the client; no revoke inside the 3-day grace; revoke after it; live again = cleared", async () => {
  const box = await newBox([CME]);
  process.env.AUTOPROVISION_EXPIRY_ENABLED = "true";
  const g = await granted(CME, "203.0.113.41");
  const back = await granted(CME, "203.0.113.42");
  await sql(`update feed_subscriptions set status = 'lapsed' where server_registration_id in ($1, $2)`, [g.serverId, back.serverId]);

  const first = await runExpiry();
  assert.ok(first.body.stamped.includes(g.recordId));
  assert.ok(!first.body.revoked.includes(g.recordId), "nothing revoked on the run that first sees it");
  assert.ok(sends.some((s) => /ends in 3 days/.test(s.text) || /removed in 3 days/.test(s.text)), "client told");
  assert.ok(sends.some((s) => /message us on Telegram to renew/.test(s.text)), "renewals go via Telegram (Fable N4)");
  const inGrace = (await getList(box.token)).body.data.records.find((r: any) => r.record_id === g.recordId);
  assert.ok(inGrace, "still served during the grace (S1)");
  assert.ok(inGrace.lapsed_since, "with the job's first sighting, for the box's day-one report");

  sends.length = 0;
  const second = await runExpiry();
  assert.ok(!second.body.stamped.includes(g.recordId) && !second.body.revoked.includes(g.recordId), "inside the grace: no change");
  assert.equal(sends.length, 0, "told once");

  await sql(`update feed_allowlist_records set lapse_seen_at = now() - interval '4 days' where id in ($1, $2)`, [g.recordId, back.recordId]);
  await sql(`update feed_subscriptions set status = 'active' where server_registration_id = $1`, [back.serverId]);
  const third = await runExpiry();
  assert.ok(third.body.revoked.includes(g.recordId));
  assert.ok(third.body.cleared.includes(back.recordId), "renewed inside the window: cleared, not revoked");
  const row = (await sql(`select revoked_at, revoked_by from feed_allowlist_records where id = $1`, [g.recordId])).rows[0];
  assert.ok(row.revoked_at);
  assert.equal(row.revoked_by, "expiry-job");
  const after = (await getList(box.token)).body.data.records.map((r: any) => r.record_id);
  assert.ok(!after.includes(g.recordId), "a record the job revoked leaves the list");
  assert.ok(after.includes(back.recordId), "the renewed one stays");
  const kept = (await sql(`select revoked_at, lapse_seen_at from feed_allowlist_records where id = $1`, [back.recordId])).rows[0];
  assert.deepEqual([kept.revoked_at, kept.lapse_seen_at], [null, null]);
});

// ---------- migration ----------

test("0098: every allowlist record has its own id; 0098_rollback removes exactly what 0098 added", async () => {
  const ids = (await sql(`select id from feed_allowlist_records`)).rows.map((r: any) => r.id);
  assert.ok(ids.length > 0 && ids.every(Boolean));
  assert.equal(new Set(ids).size, ids.length);
  // Roll back on a scratch copy: a fresh PGlite with the chain, then the rollback.
  const scratch = new PGlite();
  for (const f of readdirSync(MIGRATIONS).filter((f) => f.endsWith(".sql") && !f.includes("rollback")).sort()) {
    if (SKIPPED.has(f)) continue;
    if (SEEDS[f]) await scratch.exec(SEEDS[f]);
    await scratch.exec(readFileSync(path.join(MIGRATIONS, f), "utf8"));
  }
  await scratch.exec(readFileSync(path.join(MIGRATIONS, "0098_rollback.sql"), "utf8"));
  const cols = (await scratch.query(`select column_name from information_schema.columns where table_name = 'feed_allowlist_records' order by column_name`)).rows.map((r: any) => r.column_name);
  assert.deepEqual(cols, ["feed_tier_id", "ip", "revoked_at", "server_registration_id", "told_at"]);
  const t = (await scratch.query(`select to_regclass('feed_boxes') as a, to_regclass('feed_box_tiers') as b`)).rows[0] as any;
  assert.deepEqual([t.a, t.b], [null, null]);
  assert.equal(((await scratch.query(`select count(*)::int as n from schema_migrations where version = '0098'`)).rows[0] as any).n, 0);
});
