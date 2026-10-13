/* Run: npx tsx --test --experimental-test-module-mocks src/lib/ip-mismatch-alert-window.test.ts
 *
 * The '🚩 declared/actual IP mismatch' alert is windowed at one per (license, ip) per 24h for EVERY source, not only
 * "heartbeat" (marcus m66787: licence 522408a4 on two boxes alternated IPs on its 30-min re-validates and fired 18
 * alerts in 6h). The REAL captureConnectionIp on PGlite with the real migration chain through db.ts's global._pgPool
 * seam, as in src/lib/license-hwid.test.ts. fetch is stubbed: Telegram sends are captured, ip-api answers "fail" so geo
 * is null and the country-change alert stays out of the counts -- except for IP_DE / IP_US, which are seeded into
 * geoip_cache in different countries for the '🌍 captured IP changed country' tests (same window, marcus m66798). */
import { test, before, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { PGlite } from "@electric-sql/pglite";

const MIGRATIONS = path.join(process.cwd(), "db/migrations");
const SKIPPED = new Set(["0082_provider_client_pseudonyms_backfill.sql"]);
// Migration-chain seeds, verbatim from src/lib/license-hwid.test.ts: 0081 aborts unless its seven London-base pairs exist.
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

const DECLARED = "192.0.2.1";
const IP_A = "203.0.113.10";
const IP_B = "198.51.100.20";
const IP_DE = "203.0.113.30";
const IP_US = "198.51.100.40";
const MISMATCH = "🚩 declared/actual IP mismatch";
const COUNTRY = "🌍 captured IP changed country";
const ADMIN_URL = "https://portal.horizonhft.com/admin/connections/x";

/* eslint-disable @typescript-eslint/no-explicit-any */
let db: any;
let sent: string[] = [];

async function sql(text: string, params: unknown[] = []) {
  const r = await db.query(text, params);
  return { rows: r.rows as any[], rowCount: (r.rows.length || r.affectedRows || 0) as number };
}

before(async () => {
  db = new PGlite();
  for (const f of readdirSync(MIGRATIONS).filter((f) => f.endsWith(".sql") && !f.includes("rollback")).sort()) {
    if (SKIPPED.has(f)) continue;
    if (SEEDS[f]) await db.exec(SEEDS[f]);
    await db.exec(readFileSync(path.join(MIGRATIONS, f), "utf8"));
  }
  await sql(
    `insert into geoip_cache (ip, country, city, isp, org, resolved_at)
     values ($1, 'Germany', 'Frankfurt', null, null, now()), ($2, 'United States', 'New York', null, null, now())`,
    [IP_DE, IP_US]
  );
  (globalThis as any)._pgPool = { query: sql, connect: async () => ({ query: sql, release() {} }), end: async () => {} };
  Object.assign(process.env, { NEON_DATABASE_URL: "postgres://unused", TELEMETRY_BOT_TOKEN: "test" });
  (globalThis as any).fetch = async (url: string, init?: RequestInit) => {
    if (String(url).includes("ip-api.com")) return new Response(JSON.stringify({ status: "fail" }), { status: 200 });
    sent.push(JSON.parse(String(init?.body)).text);
    return new Response(JSON.stringify({ ok: true }), { status: 200 });
  };
});

beforeEach(() => {
  sent = [];
});

let seq = 0;
async function newRegisteredLicence(declaredIp = DECLARED) {
  seq++;
  const u = await sql(`insert into users (email) values ($1) returning id`, [`ipwin${seq}@example.invalid`]);
  const l = await sql(
    `insert into licenses (user_id, license_key, expires_at) values ($1, $2, now() + interval '30 days') returning id`,
    [u.rows[0].id, `KEY-IPWIN-${seq}`]
  );
  const id = l.rows[0].id as string;
  await sql(
    `insert into server_registrations (license_id, user_id, server_name, vps_provider, server_location, declared_ip)
     values ($1, $2, 'box', 'other', 'london', $3)`,
    [id, u.rows[0].id, declaredIp]
  );
  return id;
}

async function capture(licenseId: string, ip: string, source: string) {
  const { captureConnectionIp } = await import("./server-registration");
  await captureConnectionIp(licenseId, ip, source, ADMIN_URL);
}

const mismatchAlerts = () => sent.filter((t) => t.startsWith(MISMATCH));
const countryAlertIps = () => sent.filter((t) => t.startsWith(COUNTRY)).map((t) => /new ip: (\S+)/.exec(t)?.[1]);
const alertedIps = () => mismatchAlerts().map((t) => /actual ip: (\S+)/.exec(t)?.[1]);
const captured = async (id: string) =>
  (await sql(`select ip, source from connection_ips where license_id = $1 order by captured_at, id`, [id])).rows;

test("A,B,A,B,A,B validates within 24h: one mismatch alert per IP, not one per hop; every hop still captured", async () => {
  const id = await newRegisteredLicence();
  const hops = [IP_A, IP_B, IP_A, IP_B, IP_A, IP_B];
  for (const ip of hops) await capture(id, ip, "validate");
  assert.deepEqual(alertedIps(), [IP_A, IP_B]);
  assert.deepEqual((await captured(id)).map((r) => r.ip), hops);
});

test("the two-box case: declared = A, so only B mismatches, and B alerts once across A,B,A,B validates", async () => {
  const id = await newRegisteredLicence(IP_A);
  for (const ip of [IP_A, IP_B, IP_A, IP_B]) await capture(id, ip, "validate");
  assert.deepEqual(alertedIps(), [IP_B]);
});

test("any source counts: a heartbeat sighting of B inside 24h suppresses validate's alert on B, and the reverse", async () => {
  const id = await newRegisteredLicence();
  await capture(id, IP_B, "heartbeat");
  await capture(id, IP_A, "heartbeat");
  await capture(id, IP_B, "validate");
  await capture(id, IP_A, "verify-license");
  assert.deepEqual(alertedIps(), [IP_B, IP_A]);

  const id2 = await newRegisteredLicence();
  await capture(id2, IP_B, "validate");
  await capture(id2, IP_A, "validate");
  await capture(id2, IP_B, "heartbeat");
  assert.deepEqual(alertedIps(), [IP_B, IP_A, IP_B, IP_A]);
});

test("heartbeat-only flapping stays windowed as before (a252faf behaviour kept)", async () => {
  const id = await newRegisteredLicence();
  for (const ip of [IP_A, IP_B, IP_A, IP_B, IP_A]) await capture(id, ip, "heartbeat");
  assert.deepEqual(alertedIps(), [IP_A, IP_B]);
});

test("a sighting older than 24h does not suppress: the IP alerts again", async () => {
  const id = await newRegisteredLicence();
  await capture(id, IP_B, "validate");
  await capture(id, IP_A, "validate");
  assert.deepEqual(alertedIps(), [IP_B, IP_A]);
  await sql(`update connection_ips set captured_at = captured_at - interval '25 hours' where license_id = $1`, [id]);
  await capture(id, IP_B, "validate");
  assert.deepEqual(alertedIps(), [IP_B, IP_A, IP_B]);
});

test("this call's own row never suppresses this call's alert: the first sighting of a new IP alerts", async () => {
  const id = await newRegisteredLicence();
  await capture(id, IP_B, "validate");
  assert.equal(mismatchAlerts().length, 1);
  assert.equal((await captured(id)).length, 1);
});

test("an unchanged IP still writes nothing and alerts nothing; multiple_ips_ok still silences", async () => {
  const id = await newRegisteredLicence();
  await capture(id, IP_B, "validate");
  await capture(id, IP_B, "validate");
  assert.equal((await captured(id)).length, 1);
  assert.equal(mismatchAlerts().length, 1);

  const quiet = await newRegisteredLicence();
  await sql(`update server_registrations set multiple_ips_ok = true where license_id = $1`, [quiet]);
  sent = [];
  await capture(quiet, IP_B, "validate");
  await capture(quiet, IP_A, "validate");
  assert.equal(mismatchAlerts().length, 0);
  assert.equal((await captured(quiet)).length, 2);
});

test("country change, two boxes in different countries: A,B,A,B,A,B validates give at most 1 country alert per new IP", async () => {
  const id = await newRegisteredLicence(IP_DE);
  const hops = [IP_DE, IP_US, IP_DE, IP_US, IP_DE, IP_US];
  for (const ip of hops) await capture(id, ip, "validate");
  // DE is the first sighting (no previous, so no country change); US alerts once, on the first DE -> US hop.
  assert.deepEqual(countryAlertIps(), [IP_US]);
  assert.deepEqual(alertedIps(), [IP_US]);
  assert.equal(sent.length, 2);
  assert.deepEqual((await captured(id)).map((r) => r.ip), hops);
});

test("country change: any source counts, and a sighting older than 24h does not suppress", async () => {
  const id = await newRegisteredLicence(IP_DE);
  await capture(id, IP_US, "heartbeat");
  await capture(id, IP_DE, "heartbeat");
  await capture(id, IP_US, "validate");
  await capture(id, IP_DE, "verify-license");
  // US first sighting: no previous; DE: alerts (US -> DE); then both inside the window.
  assert.deepEqual(countryAlertIps(), [IP_DE]);

  await sql(`update connection_ips set captured_at = captured_at - interval '25 hours' where license_id = $1`, [id]);
  await capture(id, IP_US, "validate");
  assert.deepEqual(countryAlertIps(), [IP_DE, IP_US]);
});
