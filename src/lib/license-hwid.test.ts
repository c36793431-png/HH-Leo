/* Run: npx tsx --test --experimental-test-module-mocks src/lib/license-hwid.test.ts
 *
 * One licence, one PC, PHASE 1 (0099; plan m63391/m63392/m63418, Fable m63552 S1/S2/C1-C6, GO m63554). Test numbers
 * follow the plan (1-14 m63392, 15-20 m63418, 21 Fable C4). The REAL /v1/validate and /v1/hb routes and the REAL
 * admin action, auth() and next/cache mocked; PGlite 0.4.6 (PG 17.5) with the real migration chain through db.ts's
 * global._pgPool seam, as in src/lib/feed-boxes.test.ts. PGlite is ONE session: test 7 shows the statement picks one
 * winner when the calls arrive back to back; a true two-connection interleaving is not measured here. */
import { test, before, beforeEach, mock } from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { generateKeyPairSync, verify } from "node:crypto";
import { PGlite } from "@electric-sql/pglite";
import { canonicalize } from "./response-signing";

const MIGRATIONS = path.join(process.cwd(), "db/migrations");
const SEED_PROVIDER = "00000000-0000-4000-8000-0000000000a1";
const ADMIN = "00000000-0000-4000-8000-00000000e002";
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

// Uppercase hex, the shape the client emits (AppConfig.cs:190 @ c23bef3).
const PC_A = "0A1B2C3D4E5F60718293A4B5C6D7E8F9";
const PC_B = "F9E8D7C6B5A4938271605F4E3D2C1B0A";
const PC_C = "11112222333344445555666677778888";
const ACTIVE_KEYS = ["status", "expires_at", "server_time", "version"];

/* eslint-disable @typescript-eslint/no-explicit-any */
let db: any;
const { publicKey, privateKey } = generateKeyPairSync("ed25519");
let session: any = null;

async function sql(text: string, params: unknown[] = []) {
  const r = await db.query(text, params);
  return { rows: r.rows as any[], rowCount: (r.rows.length || r.affectedRows || 0) as number };
}

async function chain(target: any, upTo?: string) {
  const files = readdirSync(MIGRATIONS).filter((f) => f.endsWith(".sql") && !f.includes("rollback")).sort();
  for (const f of files) {
    if (upTo && f > upTo) break;
    if (SKIPPED.has(f)) continue;
    if (SEEDS[f]) await target.exec(SEEDS[f]);
    await target.exec(readFileSync(path.join(MIGRATIONS, f), "utf8"));
  }
}

before(async () => {
  db = new PGlite();
  await chain(db);
  (globalThis as any)._pgPool = { query: sql, connect: async () => ({ query: sql, release() {} }), end: async () => {} };
  Object.assign(process.env, {
    NEON_DATABASE_URL: "postgres://unused",
    LICENSE_SIGNING_PRIVATE_KEY: privateKey.export({ type: "pkcs8", format: "pem" }).toString(),
    LICENSE_SIGNING_KID: "test",
  });
  (globalThis as any).fetch = async () => new Response(JSON.stringify({ ok: true }), { status: 200 });
  mock.module("@/lib/auth", { namedExports: { auth: async () => session } });
  mock.module("next/cache", { namedExports: { revalidatePath: () => {} } });
  await sql(`insert into users (id, email, role) values ($1, 'admin-hwid@example.invalid', 'admin')`, [ADMIN]);
});

beforeEach(() => {
  delete process.env.HWID_ENFORCE;
  session = { user: { id: ADMIN, email: "admin-hwid@example.invalid", role: "admin", roles: ["admin"] } };
});

let seq = 0;
async function newLicence(opts: { expired?: boolean; revoked?: boolean } = {}) {
  seq++;
  const u = await sql(`insert into users (email) values ($1) returning id`, [`hwid${seq}@example.invalid`]);
  const key = `KEY-HWID-${seq}`;
  const l = await sql(
    `insert into licenses (user_id, license_key, expires_at, status) values ($1, $2, $3, $4) returning id`,
    [u.rows[0].id, key, opts.expired ? new Date(Date.now() - 864e5) : new Date(Date.now() + 30 * 864e5), opts.revoked ? "revoked" : "active"]
  );
  return { id: l.rows[0].id as string, userId: u.rows[0].id as string, key };
}

async function validate(key: string, hwid: unknown, version: unknown = "2.0.8", ip = "203.0.113.7") {
  const route = await import("../app/v1/validate/route");
  const res = await route.POST(
    new Request("https://portal.horizonhft.com/v1/validate", {
      method: "POST",
      headers: { "content-type": "application/json", "x-forwarded-for": ip },
      body: JSON.stringify({ licensekey: key, hardwareid: hwid, currentversion: version }),
    }) as any
  );
  const text = await res.text();
  return { status: res.status, text, body: JSON.parse(text) as any };
}

function sigOk(envelope: any) {
  return verify(null, Buffer.from(canonicalize(envelope.data), "utf8"), publicKey, Buffer.from(envelope.sig, "base64url"));
}

async function licenceRow(id: string) {
  return (await sql(`select hardware_id, hardware_bound_at, activated_at from licenses where id = $1`, [id])).rows[0];
}

async function seen(id: string) {
  return (await sql(`select hwid, hits, last_version, last_ip from license_hwid_seen where license_id = $1 order by hwid`, [id])).rows;
}

async function adminRows(licenseId: string) {
  return (await sql(`select * from admin_actions where target_license_id = $1 and action_type = 'admin_licenses_reset_hwid'`, [licenseId])).rows;
}

async function resetForm(licenseId: string) {
  const actions = await import("../app/admin/licenses/actions");
  const fd = new FormData();
  fd.set("licenseId", licenseId);
  return actions.resetLicenseHardwareAction(null, fd);
}

/** A trigger that fails the seen-row write mid-statement, after the bind UPDATE in the same statement has run. */
async function withSeenWriteFailing<T>(fn: () => Promise<T>): Promise<T> {
  await db.exec(`
    create or replace function hwid_test_fail() returns trigger language plpgsql as $$
    begin raise exception 'injected failure'; end $$;
    create trigger hwid_test_fail before insert or update on license_hwid_seen
      for each row execute function hwid_test_fail();`);
  const errors = console.error;
  console.error = () => {};
  try {
    return await fn();
  } finally {
    console.error = errors;
    await db.exec(`drop trigger hwid_test_fail on license_hwid_seen; drop function hwid_test_fail();`);
  }
}

test("1: an unbound live key binds on its first validate, records the seen row, answers active", async () => {
  const l = await newLicence();
  const r = await validate(l.key, PC_A, "2.0.8");
  assert.equal(r.status, 200);
  assert.equal(r.body.data.status, "active");
  const row = await licenceRow(l.id);
  assert.equal(row.hardware_id, PC_A);
  assert.ok(row.hardware_bound_at instanceof Date);
  assert.ok(row.activated_at instanceof Date);
  assert.deepEqual(await seen(l.id), [{ hwid: PC_A, hits: 1, last_version: "2.0.8", last_ip: "203.0.113.7" }]);
});

test("2: the same hwid again stays active, leaves the binding fields untouched, counts the hit", async () => {
  const l = await newLicence();
  await validate(l.key, PC_A);
  const before = await licenceRow(l.id);
  const r = await validate(l.key, PC_A, "2.0.9");
  assert.equal(r.body.data.status, "active");
  assert.deepEqual(await licenceRow(l.id), before);
  assert.deepEqual(await seen(l.id), [{ hwid: PC_A, hits: 2, last_version: "2.0.9", last_ip: "203.0.113.7" }]);
});

test("3: enforcement ON, a different hwid gets a signed 200 hwid_mismatch; binding kept; its seen row counts repeats", async () => {
  const l = await newLicence();
  await validate(l.key, PC_A);
  process.env.HWID_ENFORCE = "1";
  const r = await validate(l.key, PC_B);
  assert.equal(r.status, 200);
  assert.equal(r.body.data.status, "hwid_mismatch");
  assert.equal(r.body.data.message, "This licence is active on another PC. Contact support to move it.");
  assert.ok(sigOk(r.body));
  await validate(l.key, PC_B);
  assert.equal((await licenceRow(l.id)).hardware_id, PC_A);
  const rows = await seen(l.id);
  assert.equal(rows.find((x) => x.hwid === PC_B)?.hits, 2);
  assert.equal(rows.find((x) => x.hwid === PC_A)?.hits, 1);
});

test("4 (C2): enforcement OFF, a different hwid answers today's active payload byte for byte, records it, keeps the binding", async () => {
  const l = await newLicence();
  await validate(l.key, PC_A);
  const r = await validate(l.key, PC_B, "2.0.7");
  assert.equal(r.status, 200);
  assert.deepEqual(Object.keys(r.body.data), ACTIVE_KEYS);
  assert.equal("message" in r.body.data, false);
  const d = r.body.data;
  assert.equal(JSON.stringify(d), JSON.stringify({ status: "active", expires_at: d.expires_at, server_time: d.server_time, version: "2.0.7" }));
  assert.deepEqual(Object.keys(r.body), ["data", "sig", "kid"]);
  assert.ok(sigOk(r.body));
  assert.equal((await licenceRow(l.id)).hardware_id, PC_A);
  assert.deepEqual((await seen(l.id)).map((x) => x.hwid).sort(), [PC_A, PC_B].sort());
});

test("5 (C5): expired and revoked keys return their own status, never bind, write no seen row, even under enforcement", async () => {
  process.env.HWID_ENFORCE = "1";
  for (const opts of [{ expired: true }, { revoked: true }]) {
    const l = await newLicence(opts);
    const r = await validate(l.key, PC_A);
    assert.equal(r.status, 200);
    assert.equal(r.body.data.status, opts.expired ? "expired" : "revoked");
    assert.deepEqual(Object.keys(r.body.data), ACTIVE_KEYS);
    const row = await licenceRow(l.id);
    assert.equal(row.hardware_id, null);
    assert.equal(row.hardware_bound_at, null);
    assert.equal(row.activated_at, null);
    assert.deepEqual(await seen(l.id), []);
  }
});

test("6: an unknown key is still a 404 not_found and writes nothing", async () => {
  const before = (await sql(`select count(*)::int as n from license_hwid_seen`)).rows[0].n;
  const r = await validate("KEY-DOES-NOT-EXIST", PC_A);
  assert.equal(r.status, 404);
  assert.deepEqual(r.body, { status: "not_found" });
  assert.equal((await sql(`select count(*)::int as n from license_hwid_seen`)).rows[0].n, before);
});

test("7: two first validates from different PCs: exactly one binds, the other is the foreign PC", async () => {
  const l = await newLicence();
  process.env.HWID_ENFORCE = "1";
  const [a, b] = await Promise.all([validate(l.key, PC_A), validate(l.key, PC_B)]);
  const statuses = [a.body.data.status, b.body.data.status].sort();
  assert.deepEqual(statuses, ["active", "hwid_mismatch"]);
  const bound = (await licenceRow(l.id)).hardware_id;
  assert.equal(bound, a.body.data.status === "active" ? PC_A : PC_B);
  assert.equal((await seen(l.id)).length, 2);
});

test("8 (C6): Reset PC clears the binding, keeps activated_at and the seen rows, audits it; the next PC binds", async () => {
  const l = await newLicence();
  await validate(l.key, PC_A);
  const activated = (await licenceRow(l.id)).activated_at;

  session = { user: { id: "00000000-0000-4000-8000-00000000e0ff", email: "client@example.invalid", role: "user", roles: ["user"] } };
  assert.deepEqual(await resetForm(l.id), { ok: false, error: "forbidden" });
  assert.equal((await licenceRow(l.id)).hardware_id, PC_A);
  assert.deepEqual(await adminRows(l.id), []);

  session = { user: { id: ADMIN, email: "admin-hwid@example.invalid", role: "admin", roles: ["admin"] } };
  assert.deepEqual(await resetForm(l.id), { ok: true });
  const row = await licenceRow(l.id);
  assert.equal(row.hardware_id, null);
  assert.equal(row.hardware_bound_at, null);
  assert.deepEqual(row.activated_at, activated);
  assert.equal((await seen(l.id)).length, 1);
  const audit = await adminRows(l.id);
  assert.equal(audit.length, 1);
  assert.equal(audit[0].admin_user_id, ADMIN);
  assert.equal(audit[0].target_user_id, l.userId);
  assert.deepEqual(audit[0].details_json, { licenseId: l.id, previousHardwareId: PC_A });

  process.env.HWID_ENFORCE = "1";
  const r = await validate(l.key, PC_B);
  assert.equal(r.body.data.status, "active");
  assert.equal((await licenceRow(l.id)).hardware_id, PC_B);
  assert.equal((await validate(l.key, PC_A)).body.data.status, "hwid_mismatch");
});

test("9 (C6): Reset PC on an unbound licence is refused and writes no row", async () => {
  const l = await newLicence();
  assert.deepEqual(await resetForm(l.id), { ok: false, error: "License is not bound to a PC" });
  assert.deepEqual(await adminRows(l.id), []);
});

test("10: contract: the signature verifies on active and on mismatch; active carries exactly the four frozen keys", async () => {
  const l = await newLicence();
  const a = await validate(l.key, PC_A);
  assert.deepEqual(Object.keys(a.body.data), ACTIVE_KEYS);
  assert.ok(sigOk(a.body));
  process.env.HWID_ENFORCE = "1";
  const m = await validate(l.key, PC_B);
  assert.ok(sigOk(m.body));
  const tampered = { ...m.body, data: { ...m.body.data, status: "active" } };
  assert.equal(sigOk(tampered), false);
});

test("11 (C1): hardwareid is capped at 256: 257 chars is a 400 and writes nothing; 256 is accepted", async () => {
  const l = await newLicence();
  const r = await validate(l.key, "A".repeat(257));
  assert.equal(r.status, 400);
  assert.deepEqual(r.body, { error: "hardwareid too long" });
  assert.equal((await licenceRow(l.id)).hardware_id, null);
  const ok = await validate(l.key, "A".repeat(256));
  assert.equal(ok.body.data.status, "active");
  assert.equal((await licenceRow(l.id)).hardware_id, "A".repeat(256));
});

test("C1: the compare is opaque and exact: case, whitespace and prefix variants of the bound value are other PCs", async () => {
  const l = await newLicence();
  await validate(l.key, PC_A);
  process.env.HWID_ENFORCE = "1";
  for (const variant of [PC_A.toLowerCase(), ` ${PC_A}`, `${PC_A} `, PC_A.slice(0, 31), `${PC_A}0`]) {
    assert.equal((await validate(l.key, variant)).body.data.status, "hwid_mismatch", JSON.stringify(variant));
  }
  assert.equal((await validate(l.key, PC_A)).body.data.status, "active");
  assert.equal((await licenceRow(l.id)).hardware_id, PC_A);
});

test("12: a database error during the bind answers 500 (never hwid_mismatch) and the bind is rolled back", async () => {
  const l = await newLicence();
  const r = await withSeenWriteFailing(() => validate(l.key, PC_A));
  assert.equal(r.status, 500);
  assert.deepEqual(r.body, { error: "internal error" });
  assert.equal((await licenceRow(l.id)).hardware_id, null);
  assert.deepEqual(await seen(l.id), []);
});

test("13: 0099 is additive, rolls back cleanly and re-applies (PG 17.5)", async () => {
  const fresh: any = new PGlite();
  await chain(fresh, "0098_rollback.sql");
  const cols = async () => (await fresh.query(`select column_name from information_schema.columns where table_name = 'licenses' order by column_name`)).rows.map((r: any) => r.column_name);
  const before = await cols();
  const forward = readFileSync(path.join(MIGRATIONS, "0099_license_hwid_binding.sql"), "utf8");
  const rollback = readFileSync(path.join(MIGRATIONS, "0099_rollback.sql"), "utf8");
  await fresh.exec(forward);
  const after = await cols();
  assert.deepEqual(after.filter((c: string) => !before.includes(c)), ["hardware_bound_at"]);
  assert.ok(before.every((c: string) => after.includes(c)));
  await fresh.exec(forward);
  await fresh.exec(rollback);
  assert.deepEqual(await cols(), before);
  assert.equal((await fresh.query(`select to_regclass('license_hwid_seen') as t`)).rows[0].t, null);
  assert.equal((await fresh.query(`select count(*)::int as n from schema_migrations where version = '0099'`)).rows[0].n, 0);
  await fresh.exec(forward);
  assert.equal((await fresh.query(`select count(*)::int as n from schema_migrations where version = '0099'`)).rows[0].n, 1);
  await fresh.close();
});

test("14: /api/verify-license is unchanged (key only, no binding, same two fields); /v1/hft-alert never touches the lock", async () => {
  const l = await newLicence();
  await validate(l.key, PC_A);
  process.env.HWID_ENFORCE = "1";
  const route = await import("../app/api/verify-license/route");
  const res = await route.POST(
    new Request("https://portal.horizonhft.com/api/verify-license", { method: "POST", body: JSON.stringify({ license_key: l.key }) }) as any
  );
  const body = await res.json();
  assert.equal(res.status, 200);
  assert.deepEqual(Object.keys(body), ["status", "expires_at"]);
  assert.equal(body.status, "active");
  assert.equal((await seen(l.id)).length, 1);
  for (const f of ["src/app/api/verify-license/route.ts", "src/app/v1/hft-alert/route.ts"]) {
    const src = readFileSync(path.join(process.cwd(), f), "utf8");
    assert.doesNotMatch(src, /license-hwid|license_hwid_seen|hardware_id/, f);
  }
});

test("15 (C3, C4): the mismatch is HTTP 200, status exactly hwid_mismatch, today's keys plus message only, printable ASCII", async () => {
  const { HWID_MISMATCH_MESSAGE } = await import("./license-hwid");
  assert.match(HWID_MISMATCH_MESSAGE, /^[\x20-\x7e]+$/);
  const l = await newLicence();
  await validate(l.key, PC_A, "2.0.8");
  process.env.HWID_ENFORCE = "1";
  const r = await validate(l.key, PC_B, "2.0.8");
  assert.equal(r.status, 200);
  assert.notEqual(r.status, 404);
  assert.equal(r.body.data.status, "hwid_mismatch");
  assert.ok(!["revoked", "expired", "not_found", "active"].includes(r.body.data.status));
  assert.deepEqual(Object.keys(r.body.data), [...ACTIVE_KEYS, "message"]);
  assert.equal(r.body.data.message, HWID_MISMATCH_MESSAGE);
  assert.equal(r.body.data.version, "2.0.8");
  assert.ok(r.body.data.expires_at);
  assert.match(r.text, /^[\x20-\x7e]+$/);
  assert.ok(sigOk(r.body));
});

test("16: unbound key + HWID-ERROR-PC1: active, stays unbound, the WMI-failure value is recorded (S1)", async () => {
  const l = await newLicence();
  process.env.HWID_ENFORCE = "1";
  const r = await validate(l.key, "HWID-ERROR-PC1");
  assert.equal(r.body.data.status, "active");
  const row = await licenceRow(l.id);
  assert.equal(row.hardware_id, null);
  assert.equal(row.activated_at, null);
  assert.deepEqual((await seen(l.id)).map((x) => x.hwid), ["HWID-ERROR-PC1"]);
});

test("17: bound key + HWID-ERROR-PC1 under enforcement: passes (marcus m63419 (i)), binding unchanged, recorded", async () => {
  const l = await newLicence();
  await validate(l.key, PC_A);
  process.env.HWID_ENFORCE = "1";
  const r = await validate(l.key, "HWID-ERROR-PC1");
  assert.equal(r.body.data.status, "active");
  assert.deepEqual(Object.keys(r.body.data), ACTIVE_KEYS);
  assert.equal((await licenceRow(l.id)).hardware_id, PC_A);
  assert.deepEqual((await seen(l.id)).map((x) => x.hwid).sort(), [PC_A, "HWID-ERROR-PC1"].sort());
});

test("18: unbound key + HWID-ERROR-PC1, then a clean value: the clean value binds", async () => {
  const l = await newLicence();
  await validate(l.key, "HWID-ERROR-PC1");
  await validate(l.key, PC_C);
  assert.equal((await licenceRow(l.id)).hardware_id, PC_C);
});

test("19: only an exact HWID_ENFORCE of 1 or true enforces", async () => {
  const { hwidEnforced } = await import("./license-hwid");
  const l = await newLicence();
  await validate(l.key, PC_A);
  for (const v of [undefined, "", "0", "false", "TRUE", "True", "yes", "on", " 1", "1 "]) {
    if (v === undefined) delete process.env.HWID_ENFORCE;
    else process.env.HWID_ENFORCE = v;
    assert.equal(hwidEnforced(), false, JSON.stringify(v));
    assert.equal((await validate(l.key, PC_B)).body.data.status, "active", JSON.stringify(v));
  }
  for (const v of ["1", "true"]) {
    process.env.HWID_ENFORCE = v;
    assert.equal(hwidEnforced(), true, v);
    assert.equal((await validate(l.key, PC_B)).body.data.status, "hwid_mismatch", v);
  }
});

test("20: /v1/hb with a new hid never binds and writes no seen row; the heartbeat flush never touches the lock", async () => {
  const l = await newLicence();
  const route = await import("../app/v1/hb/route");
  const res = await route.POST(
    new Request("https://portal.horizonhft.com/v1/hb", { method: "POST", body: JSON.stringify({ lk: l.key, hid: PC_B, v: "2.0.8" }) }) as any
  );
  assert.equal(res.status, 204);
  assert.equal((await licenceRow(l.id)).hardware_id, null);
  assert.deepEqual(await seen(l.id), []);
  for (const f of ["src/app/v1/hb/route.ts", "src/app/api/cron/flush-heartbeats/route.ts"]) {
    assert.doesNotMatch(readFileSync(path.join(process.cwd(), f), "utf8"), /license-hwid|license_hwid_seen|hardware_id/, f);
  }
});

test("21 (C4): enforcement ON + a database error in the compare: 500, no row written, binding unchanged", async () => {
  const l = await newLicence();
  await validate(l.key, PC_A);
  process.env.HWID_ENFORCE = "1";
  const r = await withSeenWriteFailing(() => validate(l.key, PC_B));
  assert.equal(r.status, 500);
  assert.deepEqual(r.body, { error: "internal error" });
  assert.equal((await licenceRow(l.id)).hardware_id, PC_A);
  assert.deepEqual((await seen(l.id)).map((x) => x.hwid), [PC_A]);
  assert.equal((await seen(l.id))[0].hits, 1);
});

test("pre-flip rebind SQL in docs/licence-pc-lock.md: preview lists exactly the drifted keys; apply rebinds them, once", async () => {
  const doc = readFileSync(path.join(process.cwd(), "docs/licence-pc-lock.md"), "utf8");
  const blocks = [...doc.matchAll(/```sql\n([\s\S]*?)```/g)].map((m) => m[1]);
  assert.equal(blocks.length, 2);
  const [preview, apply] = blocks;

  // k1: bound to a degraded first-seen value that the real PC then outnumbers -> rebinds to PC_B.
  const k1 = await newLicence();
  await validate(k1.key, PC_A);
  for (let i = 0; i < 3; i++) await validate(k1.key, PC_B);
  // k2: bound and dominant -> untouched. k3: only HWID-ERROR rows -> untouched (stays unbound).
  const k2 = await newLicence();
  for (let i = 0; i < 2; i++) await validate(k2.key, PC_C);
  await validate(k2.key, PC_A);
  const k3 = await newLicence();
  for (let i = 0; i < 5; i++) await validate(k3.key, "HWID-ERROR-PC9");
  // k4: a tie on hits -> the most recent last_seen wins.
  const k4 = await newLicence();
  await validate(k4.key, PC_A);
  await validate(k4.key, PC_B);
  await sql(`update license_hwid_seen set last_seen = now() + interval '1 minute' where license_id = $1 and hwid = $2`, [k4.id, PC_B]);

  const mine = new Set([k1.id, k2.id, k3.id, k4.id]);
  const previewRows = (await sql(preview)).rows.filter((r) => mine.has(r.license_id));
  assert.deepEqual(
    previewRows.map((r) => [r.license_id, r.bound_now, r.dominant]).sort(),
    [[k1.id, PC_A, PC_B], [k4.id, PC_A, PC_B]].sort()
  );

  await db.exec(apply);
  assert.equal((await licenceRow(k1.id)).hardware_id, PC_B);
  assert.equal((await licenceRow(k2.id)).hardware_id, PC_C);
  assert.equal((await licenceRow(k3.id)).hardware_id, null);
  assert.equal((await licenceRow(k4.id)).hardware_id, PC_B);
  assert.deepEqual((await sql(preview)).rows.filter((r) => mine.has(r.license_id)), []);
});
