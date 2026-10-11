/* Run: npx tsx --test --experimental-test-module-mocks src/lib/feed-connections.test.tsx
 *
 * B3-2 (coxwell via marcus m64680; plan m64756-9; rulings m64767 + m64808; Fable design pass m64804 S1 + N1-N2):
 * migration 0102 (feed_tier_connections + feed_client_logins) and the two admin editors' writes. Fail-first: on aafd40c
 * every test here fails (no 0102, no lib, no actions). Real Postgres, no prod: PGlite with the REAL migration chain
 * (the feed-collected.test.tsx harness); the server actions run for real with auth() and next/cache mocked. */
import { test, before, mock } from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { renderToStaticMarkup } from "react-dom/server";
import { PGlite } from "@electric-sql/pglite";

const MIGRATIONS = path.join(process.cwd(), "db/migrations");
const ADMIN = "00000000-0000-4000-8000-00000000f002";
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
/** FOC13 m64634, VERIFIED lines: the B FIX symbol list as an admin would paste it. */
const CME_SYMBOLS = [
  "GC.FUT Gold",
  "ES.FUT E-mini S&P 500",
  "NQ.FUT E-mini Nasdaq-100",
  "YM.FUT E-mini Dow",
  "MGC.FUT Micro Gold",
  "MES.FUT Micro E-mini S&P 500",
  "MNQ.FUT Micro E-mini Nasdaq-100",
  "MYM.FUT Micro E-mini Dow",
  "BTC.FUT Bitcoin",
  "CL.FUT Crude Oil",
  "6B.FUT GBP/USD",
  "6E.FUT EUR/USD",
  "SI.FUT Silver",
].join("\n");

/* eslint-disable @typescript-eslint/no-explicit-any */
let db: any;
let lib: typeof import("./feed-connections");
let actions: typeof import("../app/admin/feed-connections/actions");
let session: any = { user: { id: ADMIN, email: "admin@example.invalid", role: "admin", roles: ["admin"] } };
let CME: string;
let NY: string;

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
  mock.module("@/lib/auth", { namedExports: { auth: async () => session } });
  mock.module("next/cache", { namedExports: { revalidatePath: () => {} } });
  lib = await import("./feed-connections");
  actions = await import("../app/admin/feed-connections/actions");
  await sql(`insert into users (id, email, role) values ($1, 'admin@example.invalid', 'admin')`, [ADMIN]);
  // The prod CME row is a hand INSERT (no migration carries it); the test seeds the same shape.
  CME = (
    await sql(
      `insert into feed_tiers (region_key, tier_key, name, subtitle, speed_display, description, path_redundancy, support_level, price_cents, provider_user_id)
       values ('cme', 'cme-ctrader-fix', 'CME Futures · cTrader FIX', 'FIX 4.4 (cTrader FIX)', '—', 'CME futures', '—', '—', 5000, $1) returning id`,
      [SEED_PROVIDER]
    )
  ).rows[0].id;
  NY = (await sql(`select id from feed_tiers where tier_key = 'ny-normal'`)).rows[0].id;
});

let seq = 0;
async function client() {
  seq++;
  return (await sql(`insert into users (email) values ($1) returning id`, [`fc${seq}@example.invalid`])).rows[0].id as string;
}
function form(fields: Record<string, string>): FormData {
  const f = new FormData();
  for (const [k, v] of Object.entries(fields)) f.set(k, v);
  return f;
}
const audits = async (actionType: string) =>
  (await sql(`select admin_user_id, target_user_id, details_json from admin_actions where action_type = $1 order by created_at`, [actionType])).rows;

test("0102: both tables, their keys and checks; no password column anywhere", async () => {
  for (const t of ["feed_tier_connections", "feed_client_logins"]) {
    assert.ok((await sql(`select to_regclass($1) as r`, [t])).rows[0].r, t);
    const cols = (await sql(`select column_name from information_schema.columns where table_name = $1`, [t])).rows.map((r) => r.column_name);
    assert.equal(cols.filter((c) => /pass|secret|credential/i.test(c)).length, 0, `${t}: ${cols}`);
  }
  assert.equal((await sql(`select 1 from schema_migrations where version = '0102'`)).rows.length, 1);
  const bad = [
    `insert into feed_tier_connections (feed_tier_id, conn_type, host, port) values ('${CME}', 'bjf', 'h', 1)`,
    `insert into feed_tier_connections (feed_tier_id, conn_type, host, port) values ('${CME}', 'b_fix', 'h', 70000)`,
    `insert into feed_tier_connections (feed_tier_id, conn_type, host, port) values ('${CME}', 'b_fix', 'bad host', 1)`,
    `insert into feed_tier_connections (feed_tier_id, conn_type, host, port, symbols) values ('${CME}', 'b_fix', 'h', 1, '{"a":1}')`,
    `insert into feed_tier_connections (feed_tier_id, conn_type, host, port, symbols) values ('${CME}', 'b_fix', 'h', 1, (select jsonb_agg(i) from generate_series(1, 65) i))`,
  ];
  for (const s of bad) await assert.rejects(sql(s), undefined, s);
  // A login needs its connection row (composite FK) and a well-formed name.
  const u = await client();
  await assert.rejects(sql(`insert into feed_client_logins (subscriber_user_id, feed_tier_id, conn_type, username) values ($1, $2, 'b_fix', 'C58-ROBERT')`, [u, CME]), /foreign key/);
});

test("parseSymbolLines: 'SYMBOL Description' or 'SYMBOL — Description', blank lines skipped; bad, duplicate or too many lines refused", () => {
  assert.deepEqual(lib.parseSymbolLines("GC.FUT Gold\n\n  6B.FUT — GBP/USD  \nES.FUT - E-mini S&P 500\n"), [
    { symbol: "GC.FUT", description: "Gold" },
    { symbol: "6B.FUT", description: "GBP/USD" },
    { symbol: "ES.FUT", description: "E-mini S&P 500" },
  ]);
  assert.equal(lib.parseSymbolLines(CME_SYMBOLS).length, 13);
  assert.deepEqual(lib.parseSymbolLines(""), []);
  for (const bad of ["gc.fut Gold", "GC.FUT", "TOOLONGSYMBOL12345 x", `GC.FUT ${"x".repeat(81)}`, "GC.FUT Gold\nGC.FUT Gold again"]) {
    assert.throws(() => lib.parseSymbolLines(bad), /symbol/i, bad);
  }
  assert.throws(() => lib.parseSymbolLines(Array.from({ length: 65 }, (_, i) => `S${i} x`).join("\n")), /64/);
});

test("setFeedTierConnectionAction: B FIX row written (13 symbols, CT hours), audit row in the same write, no target user", async () => {
  const r = await actions.setFeedTierConnectionAction(
    null,
    form({ feedTierId: CME, connType: "b_fix", host: "160.187.32.117", port: "5031", dataType: "Top of book (best bid/ask)", sessionHours: "Sun 17:00 – Fri 16:00 CT, daily break Mon–Thu 16:00–17:00 CT", symbols: CME_SYMBOLS })
  );
  assert.deepEqual(r, { ok: true });
  const row = (await sql(`select * from feed_tier_connections where feed_tier_id = $1 and conn_type = 'b_fix'`, [CME])).rows[0];
  assert.equal(row.host, "160.187.32.117");
  assert.equal(row.port, 5031);
  assert.equal(row.symbols.length, 13);
  assert.deepEqual(row.symbols[0], { symbol: "GC.FUT", description: "Gold" });
  assert.equal(row.updated_by, ADMIN);
  const a = await audits("feed_tier_connection_set");
  assert.equal(a.length, 1);
  assert.equal(a[0].admin_user_id, ADMIN);
  assert.equal(a[0].target_user_id, null);
  assert.equal(a[0].details_json.tier_key, "cme-ctrader-fix");
  assert.equal(a[0].details_json.conn_type, "b_fix");
  assert.equal(a[0].details_json.before, null);
  assert.equal(a[0].details_json.after.port, 5031);
});

test("an edit keeps one row per (tier, type) and audits before/after; the cTrader FIX row can be host/port only", async () => {
  await actions.setFeedTierConnectionAction(null, form({ feedTierId: CME, connType: "ctrader_fix", host: "160.187.32.117", port: "5101", dataType: "", sessionHours: "", symbols: "" }));
  await actions.setFeedTierConnectionAction(null, form({ feedTierId: CME, connType: "ctrader_fix", host: "160.187.32.117", port: "5102", dataType: "", sessionHours: "", symbols: "" }));
  const rows = (await sql(`select * from feed_tier_connections where feed_tier_id = $1 and conn_type = 'ctrader_fix'`, [CME])).rows;
  assert.equal(rows.length, 1);
  assert.equal(rows[0].port, 5102);
  assert.equal(rows[0].data_type, null);
  assert.equal(rows[0].session_hours, null);
  assert.deepEqual(rows[0].symbols, []);
  const last = (await audits("feed_tier_connection_set")).at(-1);
  assert.equal(last.details_json.before.port, 5101);
  assert.equal(last.details_json.after.port, 5102);
});

test("a bad connection edit writes nothing and no audit row: bad port, bad host, bad type, bad symbol line, unknown tier", async () => {
  const before = (await audits("feed_tier_connection_set")).length;
  const base = { feedTierId: CME, connType: "b_fix", host: "160.187.32.117", port: "5031", dataType: "", sessionHours: "", symbols: "" };
  for (const over of [{ port: "0" }, { port: "5031.5" }, { port: "abc" }, { host: "bad host" }, { connType: "bjf" }, { symbols: "gold" }, { feedTierId: "00000000-0000-4000-8000-000000000000" }, { dataType: "x".repeat(121) }]) {
    const r = await actions.setFeedTierConnectionAction(null, form({ ...base, ...over }));
    assert.equal(r.ok, false, JSON.stringify(over));
  }
  assert.equal((await audits("feed_tier_connection_set")).length, before);
  const row = (await sql(`select port, jsonb_array_length(symbols) as n from feed_tier_connections where feed_tier_id = $1 and conn_type = 'b_fix'`, [CME])).rows[0];
  assert.deepEqual(row, { port: 5031, n: 13 }, "the B FIX row is as the first write left it");
});

test("listFeedTierConnections: every row with its tier key/name, label and parsed symbols, ordered by tier then type", async () => {
  const list = await lib.listFeedTierConnections();
  const cme = list.filter((c) => c.tierKey === "cme-ctrader-fix");
  assert.deepEqual(cme.map((c) => c.connType), ["b_fix", "ctrader_fix"]);
  assert.equal(cme[0].label, "B FIX");
  assert.equal(cme[1].label, "cTrader FIX");
  assert.equal(cme[0].symbols.length, 13);
  assert.equal(lib.CONN_TYPE_LABELS.horizon_direct, "Horizon Direct");
});

test("setClientLoginAction: set, change, clear -- per connection type; each write audited with the client as target", async () => {
  const robert = await client();
  const ok = await actions.setClientLoginAction(null, form({ userId: robert, feedTierId: CME, connType: "b_fix", username: " C58-ROBERT " }));
  assert.deepEqual(ok, { ok: true });
  let rows = (await sql(`select conn_type, username, updated_by from feed_client_logins where subscriber_user_id = $1`, [robert])).rows;
  assert.deepEqual(rows, [{ conn_type: "b_fix", username: "C58-ROBERT", updated_by: ADMIN }], "stored trimmed, on b_fix only");
  await actions.setClientLoginAction(null, form({ userId: robert, feedTierId: CME, connType: "b_fix", username: "C58-ROBERT2" }));
  await actions.setClientLoginAction(null, form({ userId: robert, feedTierId: CME, connType: "b_fix", username: "" }));
  rows = (await sql(`select username from feed_client_logins where subscriber_user_id = $1`, [robert])).rows;
  assert.equal(rows.length, 0, "an empty name clears it");
  const a = (await audits("feed_client_login_set")).filter((x) => x.target_user_id === robert);
  assert.deepEqual(
    a.map((x) => [x.details_json.before, x.details_json.after]),
    [[null, "C58-ROBERT"], ["C58-ROBERT", "C58-ROBERT2"], ["C58-ROBERT2", null]]
  );
  assert.equal(a[0].details_json.tier_key, "cme-ctrader-fix");
  assert.equal(a[0].details_json.conn_type, "b_fix");
});

test("a username is unique per (tier, connection type): a second client is refused in words; the same name on the other type is fine", async () => {
  const a = await client();
  const b = await client();
  await actions.setClientLoginAction(null, form({ userId: a, feedTierId: CME, connType: "b_fix", username: "C60-SAME" }));
  const r = await actions.setClientLoginAction(null, form({ userId: b, feedTierId: CME, connType: "b_fix", username: "C60-SAME" }));
  assert.equal(r.ok, false);
  assert.match((r as { error: string }).error, /already used/i);
  assert.deepEqual(await actions.setClientLoginAction(null, form({ userId: b, feedTierId: CME, connType: "ctrader_fix", username: "C60-SAME" })), { ok: true });
});

test("a login is refused for a bad name, or a tier/type with no connection row (nothing written, no audit)", async () => {
  const u = await client();
  const before = (await audits("feed_client_login_set")).length;
  for (const f of [
    { feedTierId: CME, connType: "b_fix", username: "has space" },
    { feedTierId: CME, connType: "b_fix", username: "-leadingdash" },
    { feedTierId: CME, connType: "b_fix", username: "x".repeat(33) },
    { feedTierId: CME, connType: "horizon_direct", username: "OK-NAME" },
    { feedTierId: NY, connType: "b_fix", username: "OK-NAME" },
  ]) {
    const r = await actions.setClientLoginAction(null, form({ userId: u, ...f }));
    assert.equal(r.ok, false, JSON.stringify(f));
  }
  assert.equal((await sql(`select 1 from feed_client_logins where subscriber_user_id = $1`, [u])).rows.length, 0);
  assert.equal((await audits("feed_client_login_set")).length, before);
});

test("listClientLoginRows: one row per connection type of each tier the client holds (any status), with the name or null", async () => {
  const u = await client();
  await sql(`insert into feed_subscriptions (provider_user_id, subscriber_user_id, feed_tier_id, status) values ($1, $2, $3, 'active')`, [SEED_PROVIDER, u, CME]);
  await sql(`insert into feed_subscriptions (provider_user_id, subscriber_user_id, feed_tier_id, status) values ($1, $2, $3, 'active')`, [SEED_PROVIDER, u, NY]);
  await actions.setClientLoginAction(null, form({ userId: u, feedTierId: CME, connType: "b_fix", username: "C61-TEST" }));
  const rows = await lib.listClientLoginRows(u);
  assert.deepEqual(
    rows.map((r) => [r.tierKey, r.connType, r.username]),
    [["cme-ctrader-fix", "b_fix", "C61-TEST"], ["cme-ctrader-fix", "ctrader_fix", null]],
    "the NY tier has no connection rows, so it lists nothing"
  );
  const { ClientLoginRows } = await import("../components/admin/client-login-rows");
  const html = renderToStaticMarkup(<ClientLoginRows userId={u} rows={rows} />).replace(/<!-- -->/g, "");
  assert.match(html, /B FIX/);
  assert.match(html, /cTrader FIX/);
  assert.match(html, /value="C61-TEST"/);
  assert.doesNotMatch(html, /password/i);
});

test("both actions refuse a non-admin session and write nothing", async () => {
  const saved = session;
  session = { user: { id: "00000000-0000-4000-8000-0000000000ff", email: "x@example.invalid", role: "user", roles: ["user"] } };
  try {
    const u = await client();
    const r1 = await actions.setClientLoginAction(null, form({ userId: u, feedTierId: CME, connType: "b_fix", username: "C62-NOPE" }));
    const r2 = await actions.setFeedTierConnectionAction(null, form({ feedTierId: CME, connType: "b_fix", host: "1.2.3.4", port: "1", dataType: "", sessionHours: "", symbols: "" }));
    assert.equal(r1.ok, false);
    assert.equal(r2.ok, false);
    assert.equal((await sql(`select 1 from feed_client_logins where username = 'C62-NOPE'`)).rows.length, 0);
    assert.equal((await sql(`select port from feed_tier_connections where feed_tier_id = $1 and conn_type = 'b_fix'`, [CME])).rows[0].port, 5031);
  } finally {
    session = saved;
  }
});

test("/admin/feed-connections is a feed-host admin route in both exact-match lists", async () => {
  const { ADMIN_FEED_ROUTES } = await import("./feed-host-admin");
  assert.ok(ADMIN_FEED_ROUTES.includes("/admin/feed-connections"));
  const proxy = readFileSync(path.join(process.cwd(), "src/proxy.ts"), "utf8");
  const list = proxy.match(/const FEED_ONLY_ADMIN_ROUTES = \[([^\]]*)\]/)![1];
  assert.match(list, /"\/admin\/feed-connections"/);
});

test("0102_rollback drops both tables and the schema_migrations row (runs last)", async () => {
  await db.exec(readFileSync(path.join(MIGRATIONS, "0102_rollback.sql"), "utf8"));
  for (const t of ["feed_tier_connections", "feed_client_logins"]) assert.equal((await sql(`select to_regclass($1) as r`, [t])).rows[0].r, null);
  assert.equal((await sql(`select 1 from schema_migrations where version = '0102'`)).rows.length, 0);
});
