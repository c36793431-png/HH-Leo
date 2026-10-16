/* Run: npx tsx --test src/lib/feed-box-events.test.tsx
 *
 * Feed-box EVENTS: POST /api/feed-box/events, migration 0115, the /admin/feed-health events block and the provider
 * box scope S2 will read. Plan m70008-10; rulings marcus m70015 (Q1-Q7) + m70036 (databento_error); Fable PASS WITH
 * STRIKES m70029 (S1 non-empty tier set, S2 bounded open cut; notes N1-N7); BUILD GO m70031.
 * PGlite with the REAL migration chain through db.ts's global._pgPool seam (the feed-status.test.tsx harness), no prod. */
import { test, before, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { generateKeyPairSync } from "node:crypto";
import { PGlite } from "@electric-sql/pglite";

const MIGRATIONS = path.join(process.cwd(), "db/migrations");
const SEED_PROVIDER = "00000000-0000-4000-8000-0000000000a1";
const PIP = "00000000-0000-4000-8000-00000000e001";
const OTHER = "00000000-0000-4000-8000-00000000e002";
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
const { privateKey } = generateKeyPairSync("ed25519");

async function sql(text: string, params: unknown[] = []) {
  const r = await db.query(text, params);
  return { rows: r.rows as any[], rowCount: (r.rows.length || r.affectedRows || 0) as number };
}

async function chain(target: PGlite) {
  for (const f of readdirSync(MIGRATIONS).filter((f) => f.endsWith(".sql") && !f.includes("rollback")).sort()) {
    if (SKIPPED.has(f)) continue;
    if (SEEDS[f]) await target.exec(SEEDS[f]);
    await target.exec(readFileSync(path.join(MIGRATIONS, f), "utf8"));
  }
}

const T: Record<string, string> = {};

/** A tier owned by `provider` (null = no provider), as provider_tiers rows land on prod. */
async function tier(key: string, provider: string | null) {
  const r = await sql(
    `insert into feed_tiers (region_key, tier_key, name, subtitle, speed_display, description, path_redundancy, support_level, provider_user_id)
     values ('cme', $1, $1, '-', '-', '-', 'Single path', 'Standard', $2) returning id`,
    [key, provider]
  );
  T[key] = r.rows[0].id;
  return T[key];
}

before(async () => {
  db = new PGlite();
  await chain(db);
  (globalThis as any)._pgPool = { query: sql, connect: async () => ({ query: sql, release() {} }), end: async () => {} };
  Object.assign(process.env, {
    NEON_DATABASE_URL: "postgres://unused",
    VERCEL_ENV: "production",
    LICENSE_SIGNING_PRIVATE_KEY: privateKey.export({ type: "pkcs8", format: "pem" }).toString(),
    LICENSE_SIGNING_KID: "test",
  });
  for (const [id, email] of [
    [PIP, "pip@example.invalid"],
    [OTHER, "other-provider@example.invalid"],
  ]) {
    await sql(`insert into users (id, email, role) values ($1, $2, 'feed_provider')`, [id, email]);
  }
  await tier("cme-ctrader-fix", PIP);
  await tier("cme-other", OTHER);
  await tier("cme-unowned", null);
  for (const r of (await sql(`select id, tier_key from feed_tiers where tier_key like 'ld-%'`)).rows) T[r.tier_key] = r.id;
});

beforeEach(() => {
  process.env.VERCEL_ENV = "production";
});

let boxSeq = 0;
async function newBox(applyTierIds: string[], statusTierIds: string[]) {
  const fb = await import("./feed-boxes");
  boxSeq++;
  const name = `events-box-${boxSeq}`;
  const id = await fb.createFeedBox(name, applyTierIds, statusTierIds);
  const { token } = await fb.issueBoxToken(id);
  return { id, name, token };
}

test("parse: strict payload; detail is a closed code (an IP, a login or a token can't ride); 8 kinds incl. databento_error", async () => {
  const { parseEventsBody } = await import("./feed-box-events");
  const now = new Date();
  const at = (msAgo: number) => new Date(now.getTime() - msAgo).toISOString();
  const p = (events: unknown[], extra: Record<string, unknown> = {}) => parseEventsBody({ box: "b", events, ...extra }, now);
  const bad: [string, unknown][] = [
    ["unknown top-level key", { box: "b", events: [{ ts: at(0), kind: "bridge_start" }], note: "x" }],
    ["events empty", { box: "b", events: [] }],
    ["events not an array", { box: "b", events: {} }],
    ["box missing", { events: [{ ts: at(0), kind: "bridge_start" }] }],
    ["not an object", [{ box: "b" }]],
  ];
  for (const [what, body] of bad) assert.equal(parseEventsBody(body, now).ok, false, what);
  const badEvents: [string, unknown][] = [
    ["unknown event key", { ts: at(0), kind: "bridge_start", ip: "x" }],
    ["ts not Z", { ts: "2026-10-16T09:03:12+01:00", kind: "bridge_start" }],
    ["ts missing", { kind: "bridge_start" }],
    ["unknown kind", { ts: at(0), kind: "databento_cut" }],
    ["duration on a non-cut", { ts: at(0), kind: "reconnect_ok", duration_s: 5 }],
    ["duration on databento_error", { ts: at(0), kind: "databento_error", duration_s: 5 }],
    ["fractional duration", { ts: at(0), kind: "databento_silent", duration_s: 1.5 }],
    ["negative duration", { ts: at(0), kind: "databento_silent", duration_s: -1 }],
    ["duration over a day", { ts: at(0), kind: "databento_silent", duration_s: 86_401 }],
    ["IP as detail", { ts: at(0), kind: "client_reject", detail: "203.0.113.5" }],
    ["IP digits in a code", { ts: at(0), kind: "client_reject", detail: "ip_203_0_113_5" }],
    ["login with a colon", { ts: at(0), kind: "client_reject", detail: "login:pip" }],
    ["upper case", { ts: at(0), kind: "client_reject", detail: "IP_NOT_ALLOWLISTED" }],
    ["33 chars", { ts: at(0), kind: "client_reject", detail: "a".repeat(33) }],
    ["empty detail", { ts: at(0), kind: "client_reject", detail: "" }],
    ["detail not a string", { ts: at(0), kind: "client_reject", detail: 7 }],
  ];
  for (const [what, e] of badEvents) assert.equal(p([e]).ok, false, what);

  const kinds = ["databento_silent", "databento_error", "reconnect_ok", "bridge_start", "bridge_stop", "client_reject", "client_connect", "client_disconnect"];
  const all = p(kinds.map((kind, i) => ({ ts: at(i * 1000), kind })));
  assert.equal(all.ok, true, JSON.stringify(all));
  const fine: [string, unknown][] = [
    ["databento_error licence_auth (m70036)", { ts: at(0), kind: "databento_error", detail: "licence_auth" }],
    ["open cut", { ts: at(0), kind: "databento_silent", duration_s: null }],
    ["closed cut 0..86400", { ts: at(0), kind: "databento_silent", duration_s: 86_400 }],
    ["reject ip_not_allowlisted", { ts: at(0), kind: "client_reject", detail: "ip_not_allowlisted" }],
    ["unlisted code still a code", { ts: at(0), kind: "client_reject", detail: "some_new_code" }],
    ["microseconds", { ts: "2026-10-16T09:03:12.400123Z", kind: "bridge_start" }],
  ];
  for (const [what, e] of fine) assert.equal(p([e]).ok, true, `${what}: ${JSON.stringify(p([e]))}`);
});

test("parse: ts outside [now - 30 d, now + 60 s] is skipped and listed, not a 400; the rest stay", async () => {
  const { parseEventsBody } = await import("./feed-box-events");
  const now = new Date("2026-10-16T12:00:00.000Z");
  const r = parseEventsBody(
    {
      box: "b",
      events: [
        { ts: "2026-10-16T12:00:59.000Z", kind: "bridge_start" },
        { ts: "2026-10-16T12:01:01.000Z", kind: "bridge_stop" },
        { ts: "2026-09-16T12:01:00.000Z", kind: "reconnect_ok" },
        { ts: "2026-09-16T11:59:00.000Z", kind: "client_connect" },
      ],
    },
    now
  );
  assert.ok(r.ok);
  assert.deepEqual(
    r.events.map((e) => e.kind),
    ["bridge_start", "reconnect_ok"]
  );
  assert.deepEqual(r.ignored, [
    { ts: "2026-10-16T12:01:01.000Z", kind: "bridge_stop", reason: "ts more than 60 s ahead" },
    { ts: "2026-09-16T11:59:00.000Z", kind: "client_connect", reason: "ts older than 30 days" },
  ]);
});

// ---------- migration ----------

test("0115: CHECKs refuse what the route refuses; rollback removes exactly what 0115 added", async () => {
  const box = await newBox([T["cme-ctrader-fix"]], []);
  const ins = (kind: string, duration: number | null, detail: string | null) =>
    sql(`insert into feed_box_events (box_id, ts, kind, duration_s, detail) values ($1, now() - interval '1 second' * random(), $2, $3, $4)`, [box.id, kind, duration, detail]);
  await assert.rejects(ins("databento_cut", null, null), /check/i);
  await assert.rejects(ins("reconnect_ok", 5, null), /check/i, "duration only on databento_silent");
  await assert.rejects(ins("databento_error", 5, null), /check/i, "databento_error carries no duration");
  await assert.rejects(ins("databento_silent", 86_401, null), /check/i);
  await assert.rejects(ins("client_reject", null, "203.0.113.5"), /check/i, "no IP-shaped detail");
  await ins("databento_error", null, "licence_auth");

  const scratch = new PGlite();
  await chain(scratch);
  const cols = async () =>
    (await scratch.query(`select column_name from information_schema.columns where table_name = 'feed_boxes' order by column_name`)).rows.map((r: any) => r.column_name);
  const before = await cols();
  assert.ok(before.includes("events_ignored"));
  await scratch.exec(readFileSync(path.join(MIGRATIONS, "0115_rollback.sql"), "utf8"));
  assert.deepEqual(await cols(), before.filter((c) => c !== "events_ignored"));
  assert.equal(((await scratch.query(`select to_regclass('feed_box_events') as t`)).rows[0] as any).t, null);
  assert.equal(((await scratch.query(`select count(*)::int as n from schema_migrations where version = '0115'`)).rows[0] as any).n, 0);
  const v1 = (await scratch.query(`select to_regclass('feed_status_latest') as a, to_regclass('feed_box_status_tiers') as b`)).rows[0] as any;
  assert.ok(v1.a && v1.b, "0101 untouched");
});
