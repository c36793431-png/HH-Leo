/* Run: npx tsx --test src/lib/consult-0105.test.ts
 *
 * Consult S4: migration 0105 (consult_services + consult_requests) and its house-package seed
 * (marcus GO m66250; plan m65563-5, Fable PASS WITH STRIKES m65602, Nova ruling Q6 m66242).
 * Pinned here:
 *  - the slug CHECK is the SAME pattern + cap + reserved list as consult-slug.ts, the constant the
 *    S5 login-callback twin will import (Fable A1(a)), and the DB agrees with isConsultSlug on
 *    every candidate;
 *  - kind has no 'ai_agent' (Q6); a house package (owner NULL) is never kind 'consultant';
 *  - house-package names are unique while open: `nulls not distinct`, so two owner-NULL rows
 *    can't share a name (Fable S3), with the race tested on house rows too;
 *  - one pending request per client per package; a question needs no package;
 *  - consult_requests.topic is capped at CONSULT_ASK_TOPIC_MAX and every CONSULT_ASK_TOPICS key is
 *    slug-shaped and fits (marcus Q1/Q2 m66313);
 *  - the rollback refuses while client or consultant rows, or house packages beyond the seed, exist.
 * Real Postgres, no prod: the PGlite harness of basket-requests.test.ts (the REAL migration chain,
 * same prod-data preflight seeds). */
import { test, before } from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { PGlite } from "@electric-sql/pglite";

const MIGRATIONS = path.join(process.cwd(), "db/migrations");
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
const SKIPPED = new Set(["0082_provider_client_pseudonyms_backfill.sql"]);
const MIGRATION_0105 = "0105_consult_services_requests.sql";

/* eslint-disable @typescript-eslint/no-explicit-any */
let db: any;

async function sql(text: string, params: unknown[] = []) {
  const r = await db.query(text, params);
  return { rows: r.rows as any[], rowCount: (r.rows.length || r.affectedRows || 0) as number };
}

/** The statement fails with this SQLSTATE, naming this constraint or index. */
async function refused(p: Promise<unknown>, code: string, name: string) {
  await assert.rejects(p, (e: any) => {
    assert.equal(e.code, code, `expected ${code} (${name}), got ${e.code}: ${e.message}`);
    assert.match(String(e.message), new RegExp(name));
    return true;
  });
}

before(async () => {
  db = new PGlite();
  const files = readdirSync(MIGRATIONS).filter((f) => f.endsWith(".sql") && !f.includes("rollback")).sort();
  for (const f of files) {
    if (SKIPPED.has(f)) continue;
    if (SEEDS[f]) await db.exec(SEEDS[f]);
    await db.exec(readFileSync(path.join(MIGRATIONS, f), "utf8"));
  }
});

let seq = 0;
async function makeUser() {
  seq++;
  const r = await sql(`insert into users (email) values ($1) returning id`, [`consult${seq}@example.invalid`]);
  return r.rows[0].id as string;
}
/** A consult_services row with every required column filled; `cols` overrides. The kind follows
 * the owner (house package or consultant service) unless given, so a refusal names one check. */
function insertService(cols: Record<string, unknown>) {
  const row: Record<string, unknown> = {
    slug: `svc-${++seq}`,
    kind: cols.owner_user_id ? "consultant" : "human_expert",
    name: `Service ${seq}`,
    summary: "A short summary.",
    availability: "available",
    status: "proposed",
    ...cols,
  };
  const keys = Object.keys(row);
  return sql(
    `insert into consult_services (${keys.join(", ")}) values (${keys.map((_, i) => `$${i + 1}`).join(", ")}) returning id`,
    keys.map((k) => row[k]),
  );
}
async function houseServiceId(slug: string) {
  return (await sql(`select id from consult_services where slug = $1`, [slug])).rows[0].id as string;
}

test("0105 applies on the real chain: both tables exist and the ledger row is in", async () => {
  for (const t of ["consult_services", "consult_requests"]) assert.notEqual((await sql(`select to_regclass($1) as r`, [t])).rows[0].r, null, t);
  assert.deepEqual((await sql(`select name from schema_migrations where version = '0105'`)).rows, [{ name: MIGRATION_0105 }]);
});

// Before any test inserts: the seed is the whole table.
test("seed: the Human expert house package and nothing else (no Horizon AI rows, Q6); live, no price, no split", async () => {
  const seeded = (await sql(
    `select slug, kind, owner_user_id, name, availability, status, price_cents, consultant_split_pct from consult_services`,
  )).rows;
  assert.deepEqual(seeded, [{
    slug: "human-expert", kind: "human_expert", owner_user_id: null, name: "Human expert",
    availability: "available", status: "live", price_cents: null, consultant_split_pct: null,
  }]);
});

test("slug CHECK is consult-slug.ts's pattern, cap and reserved list, literally (Fable A1(a))", async () => {
  const { CONSULT_SLUG_PATTERN, CONSULT_SLUG_MAX, CONSULT_SLUG_RESERVED } = await import("./consult-slug");
  const def = (await sql(`select pg_get_constraintdef(oid) as def from pg_constraint where conname = 'consult_services_slug_check'`)).rows[0]?.def as string;
  assert.ok(def, "consult_services_slug_check is named");
  assert.ok(def.includes(`'${CONSULT_SLUG_PATTERN}'`), def);
  assert.ok(def.includes(`<= ${CONSULT_SLUG_MAX}`), def);
  for (const r of CONSULT_SLUG_RESERVED) assert.ok(def.includes(`'${r}'`), `${r} reserved in ${def}`);
});

test("the DB and isConsultSlug agree on every candidate; 'ask', 'apply', 'Bad Slug', '--x' are refused", async () => {
  const { isConsultSlug } = await import("./consult-slug");
  const cases: [string, boolean][] = [
    ["setup-review", true], ["a", true], ["a1-b2-c3", true], ["x".repeat(64), true],
    ["ask", false], ["apply", false], ["Bad Slug", false], ["--x", false], ["-x", false], ["x-", false],
    ["a--b", false], ["Upper", false], ["human_expert", false], ["a/b", false], ["a.b", false], ["%2e", false],
    ["", false], ["x".repeat(65), false], ["ask-anything", true], ["apply-now", true],
  ];
  for (const [slug, ok] of cases) {
    assert.equal(isConsultSlug(slug), ok, `isConsultSlug(${JSON.stringify(slug)})`);
    if (ok) await insertService({ slug, status: "retired", owner_user_id: await makeUser() });
    else await refused(insertService({ slug }), "23514", "consult_services_slug_check");
  }
});

test("kind: no 'ai_agent' (Q6); a house package is human_expert and a consultant service has an owner", async () => {
  await refused(insertService({ kind: "ai_agent", owner_user_id: await makeUser() }), "23514", "consult_services_kind_check");  await refused(insertService({ kind: "consultant", owner_user_id: null }), "23514", "consult_services_owner_kind_check");
  await refused(insertService({ kind: "human_expert", owner_user_id: await makeUser() }), "23514", "consult_services_owner_kind_check");
  await insertService({ kind: "human_expert", owner_user_id: null, status: "retired" });
  await insertService({ kind: "consultant", owner_user_id: await makeUser() });
});

test("house-package names are unique while proposed/live, nulls not distinct (Fable S3), case-insensitive", async () => {
  await insertService({ kind: "human_expert", name: "Setup review", status: "live" });
  await refused(insertService({ kind: "human_expert", name: "setup REVIEW", status: "proposed" }), "23505", "consult_services_owner_name_open_uidx");
  // The race: two submits at once, one row.
  const both = await Promise.allSettled([
    insertService({ kind: "human_expert", name: "Race house" }),
    insertService({ kind: "human_expert", name: "Race house" }),
  ]);
  assert.deepEqual(both.map((r) => r.status).sort(), ["fulfilled", "rejected"]);
  assert.equal((await sql(`select count(*)::int n from consult_services where name = 'Race house'`)).rows[0].n, 1);
  // A retired or declined row no longer holds the name.
  await insertService({ kind: "human_expert", name: "Old house", status: "retired" });
  await insertService({ kind: "human_expert", name: "Old house", status: "live" });
});

test("consultant names are unique per owner while open; another owner may use the same name", async () => {
  const a = await makeUser();
  const b = await makeUser();
  await insertService({ owner_user_id: a, name: "Latency audit" });
  await refused(insertService({ owner_user_id: a, name: "latency audit" }), "23505", "consult_services_owner_name_open_uidx");
  const both = await Promise.allSettled([
    insertService({ owner_user_id: b, name: "Race consultant" }),
    insertService({ owner_user_id: b, name: "Race consultant" }),
  ]);
  assert.deepEqual(both.map((r) => r.status).sort(), ["fulfilled", "rejected"]);
  await insertService({ owner_user_id: b, name: "Latency audit" });
  await sql(`update consult_services set status = 'declined', declined_note = 'n' where owner_user_id = $1 and name = 'Latency audit'`, [a]);
  await insertService({ owner_user_id: a, name: "Latency audit" });
});

test("text caps, split 0..100, status and availability vocabularies", async () => {
  const owner = await makeUser();
  await refused(insertService({ owner_user_id: owner, summary: "x".repeat(281) }), "23514", "consult_services_summary_check");
  await refused(insertService({ owner_user_id: owner, description: "x".repeat(4001) }), "23514", "consult_services_description_check");
  await refused(insertService({ owner_user_id: owner, delivery: "x".repeat(501) }), "23514", "consult_services_delivery_check");
  await refused(insertService({ owner_user_id: owner, name: "" }), "23514", "consult_services_name_check");
  await refused(insertService({ owner_user_id: owner, consultant_split_pct: 101 }), "23514", "consult_services_split_check");
  await refused(insertService({ owner_user_id: owner, status: "approved" }), "23514", "consult_services_status_check");
  await refused(insertService({ owner_user_id: owner, availability: "soon" }), "23514", "consult_services_availability_check");
  await insertService({ owner_user_id: owner, summary: "x".repeat(280), description: "x".repeat(4000), delivery: "x".repeat(500), consultant_split_pct: 0, availability: "coming-soon" });
});

test("consult_requests: a request needs a package, a question doesn't; one pending request per client per package", async () => {
  const client = await makeUser();
  const svc = await houseServiceId("human-expert");
  await refused(sql(`insert into consult_requests (user_id, kind) values ($1, 'request')`, [client]), "23514", "consult_requests_service_check");
  await refused(sql(`insert into consult_requests (user_id, kind) values ($1, 'interest')`, [client]), "23514", "consult_requests_service_check");
  await sql(`insert into consult_requests (user_id, kind, body) values ($1, 'question', 'How do I…?')`, [client]);
  await sql(`insert into consult_requests (user_id, kind, body) values ($1, 'question', 'And another')`, [client]);
  await sql(`insert into consult_requests (user_id, service_id, kind) values ($1, $2, 'request')`, [client, svc]);
  await refused(sql(`insert into consult_requests (user_id, service_id, kind) values ($1, $2, 'request')`, [client, svc]), "23505", "consult_requests_one_pending_uidx");
  const race = await Promise.allSettled([
    sql(`insert into consult_requests (user_id, service_id, kind) values ($1, $2, 'interest')`, [client, svc]),
    sql(`insert into consult_requests (user_id, service_id, kind) values ($1, $2, 'interest')`, [client, svc]),
  ]);
  assert.deepEqual(race.map((r) => r.status).sort(), ["fulfilled", "rejected"]);
  // Once decided, the client may ask again.
  await sql(`update consult_requests set status = 'declined', decided_at = now() where user_id = $1 and kind = 'request'`, [client]);
  await sql(`insert into consult_requests (user_id, service_id, kind) values ($1, $2, 'request')`, [client, svc]);
});

test("consult_requests: vocabularies and caps (body 2000, telegram_handle 2..64 like 0093)", async () => {
  const client = await makeUser();
  const q = (cols: string, vals: unknown[]) =>
    sql(`insert into consult_requests (user_id, ${cols}) values ($1, ${vals.map((_, i) => `$${i + 2}`).join(", ")})`, [client, ...vals]);
  await refused(q("kind", ["quote"]), "23514", "consult_requests_kind_check");
  await refused(q("kind, status", ["question", "done"]), "23514", "consult_requests_status_check");
  await refused(q("kind, body", ["question", "x".repeat(2001)]), "23514", "consult_requests_body_check");
  await refused(q("kind, answer", ["question", "x".repeat(4001)]), "23514", "consult_requests_answer_check");
  await refused(q("kind, telegram_handle", ["question", "x"]), "23514", "consult_requests_telegram_handle_check");
  await refused(q("kind, telegram_handle", ["question", "x".repeat(65)]), "23514", "consult_requests_telegram_handle_check");
  await q("kind, body, telegram_handle", ["question", "x".repeat(2000), "ab"]);
});

test("consult_requests.topic: the CHECK caps at CONSULT_ASK_TOPIC_MAX; every topic key is slug-shaped and stored as-is (marcus Q1/Q2)", async () => {
  const { CONSULT_ASK_TOPICS, CONSULT_ASK_TOPIC_MAX, isConsultAskTopic } = await import("./consult-ask-topics");
  const { isConsultSlug } = await import("./consult-slug");
  const def = (await sql(`select pg_get_constraintdef(oid) as def from pg_constraint where conname = 'consult_requests_topic_check'`)).rows[0]?.def as string;
  assert.ok(def, "consult_requests_topic_check is named");
  assert.ok(def.includes(`<= ${CONSULT_ASK_TOPIC_MAX}`), def);
  const client = await makeUser();
  const keys = Object.keys(CONSULT_ASK_TOPICS);
  assert.deepEqual(keys, ["general", "custom", "guided", "always-on"]);
  for (const key of keys) {
    assert.ok(isConsultSlug(key) && key.length <= CONSULT_ASK_TOPIC_MAX, `${key} is slug-shaped and fits`);
    assert.ok(isConsultAskTopic(key), key);
    const r = await sql(`insert into consult_requests (user_id, kind, topic) values ($1, 'question', $2) returning topic`, [client, key]);
    assert.equal(r.rows[0].topic, key);
  }
  for (const bad of ["General", "ask", "__proto__", "toString", "hasOwnProperty", ""]) assert.equal(isConsultAskTopic(bad), false, bad);
  const insertTopic = (topic: string) => sql(`insert into consult_requests (user_id, kind, topic) values ($1, 'question', $2)`, [client, topic]);
  await refused(insertTopic(""), "23514", "consult_requests_topic_check");
  await refused(insertTopic("x".repeat(CONSULT_ASK_TOPIC_MAX + 1)), "23514", "consult_requests_topic_check");
  await insertTopic("x".repeat(CONSULT_ASK_TOPIC_MAX));
});

test("deleting a client removes their requests; a consultant who owns a service can't be deleted", async () => {
  const client = await makeUser();
  await sql(`insert into consult_requests (user_id, kind) values ($1, 'question')`, [client]);
  await sql(`delete from users where id = $1`, [client]);
  assert.equal((await sql(`select count(*)::int n from consult_requests where user_id = $1`, [client])).rows[0].n, 0);
  const owner = await makeUser();
  await insertService({ owner_user_id: owner });
  await refused(sql(`delete from users where id = $1`, [owner]), "23503", "consult_services_owner_user_id_fkey");
});

// Last: it runs DDL against the shared database.
test("0105_rollback refuses while requests, consultant services or admin-added house packages exist (Fable N4), then drops both tables and the ledger row", async () => {
  const rollback = readFileSync(path.join(MIGRATIONS, "0105_rollback.sql"), "utf8");
  assert.ok((await sql(`select 1 from consult_requests`)).rows.length > 0, "earlier tests left request rows");
  await assert.rejects(db.exec(rollback), /consult_requests has rows/);
  await db.exec("rollback");
  await sql(`delete from consult_requests`);
  await assert.rejects(db.exec(rollback), /consult_services has consultant-owned rows/);
  await db.exec("rollback");
  assert.equal((await sql(`select count(*)::int n from schema_migrations where version = '0105'`)).rows[0].n, 1);
  await sql(`delete from consult_services where owner_user_id is not null`);
  assert.ok((await sql(`select 1 from consult_services where owner_user_id is null and slug <> 'human-expert'`)).rows.length > 0, "earlier tests left admin-added house rows");
  await assert.rejects(db.exec(rollback), /consult_services has house packages beyond the seed/);
  await db.exec("rollback");
  await sql(`delete from consult_services where slug <> 'human-expert'`);
  await db.exec(rollback);
  for (const t of ["consult_services", "consult_requests"]) assert.equal((await sql(`select to_regclass($1) as r`, [t])).rows[0].r, null, t);
  assert.equal((await sql(`select count(*)::int n from schema_migrations where version = '0105'`)).rows[0].n, 0);
});
