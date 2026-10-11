/* Run: npx tsx --test src/lib/feed-status.test.tsx
 *
 * Feed status from a measuring box (FOC13's tommy4 monitor): POST /api/feed-box/status, migration 0101, and the two
 * /admin pages. Plan m64510-2 / m64513-5; rulings marcus m64519, m64531 (v1 = /admin only), m64552 (pk box + feed +
 * symbol, worst-of badge, three sources); Fable m64547 strikes S1-S3 and notes m64565; BUILD GO m64545.
 * Fail-first: on main (68e8bdf) every test here fails (no 0101, no route, no feed-status lib).
 * PGlite with the REAL migration chain through db.ts's global._pgPool seam (the feed-boxes.test.ts harness), no prod.
 * Grants are made by the shipped approve path, so the allowlist record in the S1 test has the shape prod writes. */
import { test, before, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { generateKeyPairSync } from "node:crypto";
import { renderToStaticMarkup } from "react-dom/server";
import { PGlite } from "@electric-sql/pglite";

const MIGRATIONS = path.join(process.cwd(), "db/migrations");
const SEED_PROVIDER = "00000000-0000-4000-8000-0000000000a1";
const ADMIN = "00000000-0000-4000-8000-00000000f102";
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

before(async () => {
  db = new PGlite();
  await chain(db);
  (globalThis as any)._pgPool = { query: sql, connect: async () => ({ query: sql, release() {} }), end: async () => {} };
  Object.assign(process.env, {
    NEON_DATABASE_URL: "postgres://unused",
    VERCEL_ENV: "production",
    LICENSE_SIGNING_PRIVATE_KEY: privateKey.export({ type: "pkcs8", format: "pem" }).toString(),
    LICENSE_SIGNING_KID: "test",
    HORIZON_PORTAL_BOT_TOKEN: "portal-token",
    AUTH_RESEND_KEY: "re_test",
    EMAIL_FROM: "Horizon <noreply@example.invalid>",
    TELEMETRY_BOT_TOKEN: "telemetry-token",
    TELEGRAM_HFT_ALERT_BOT_TOKEN: "alerts-token",
  });
  (globalThis as any).fetch = async () => new Response(JSON.stringify({ ok: true, result: { message_id: 1 }, id: "e" }), { status: 200 });
  await sql(`insert into users (id, email, role) values ($1, 'status-admin@example.invalid', 'admin')`, [ADMIN]);
  await sql(
    `insert into feed_tiers (region_key, tier_key, name, subtitle, speed_display, description, path_redundancy, support_level)
     values ('cme', 'cme-ctrader-fix', 'CME Futures · cTrader FIX', 'cTrader FIX', '-', 'CME futures', 'Single path', 'Standard')`
  );
  for (const r of (await sql(`select id, tier_key from feed_tiers`)).rows) T[r.tier_key] = r.id;
  for (const k of ["ld-alpha-85", "ld-beta-56", "ld-gamma-19", "ld-delta-18", "ld-ultra", "cme-ctrader-fix"]) assert.ok(T[k], `tier ${k} exists`);
});

beforeEach(() => {
  process.env.VERCEL_ENV = "production";
});

const LONDON = () => ["ld-alpha-85", "ld-beta-56", "ld-gamma-19", "ld-delta-18", "ld-ultra"].map((k) => T[k]);

let boxSeq = 0;
async function newBox(applyTierIds: string[], statusTierIds: string[]) {
  const fb = await import("./feed-boxes");
  boxSeq++;
  const name = `status-box-${boxSeq}`;
  const id = await fb.createFeedBox(name, applyTierIds, statusTierIds);
  const { token } = await fb.issueBoxToken(id);
  return { id, name, token };
}

let seq = 0;
/** A client with a licence, a server at `ip` and a PAID grant on `tierId`, made by the shipped approve path. */
async function granted(tierId: string, ip: string) {
  seq++;
  const ar = await import("./access-requests");
  const u = await sql(`insert into users (email, telegram_user_id) values ($1, $2) returning id`, [`fs${seq}@example.invalid`, String(980000 + seq)]);
  const userId = u.rows[0].id as string;
  const l = await sql(`insert into licenses (user_id, license_key, expires_at) values ($1, $2, now() + interval '60 days') returning id`, [userId, `KEY-FS-${seq}`]);
  const s = await sql(
    `insert into server_registrations (license_id, user_id, server_name, vps_provider, server_location, declared_ip)
     values ($1, $2, $3, 'other', 'London', $4) returning id`,
    [l.rows[0].id, userId, `fsrv${seq}`, ip]
  );
  const serverId = s.rows[0].id as string;
  const { requestIds } = await ar.createAccessRequestBatch({ userId, items: [{ kind: "feed_tier", serverRegistrationId: serverId, feedTierId: tierId }] });
  await ar.approveAccessRequest({ requestId: requestIds[0], decidedBy: ADMIN, decision: "paid", endsAt: new Date(Date.now() + 30 * 864e5), invoiceRef: `INV-FS-${seq}` } as any);
  const rec = (await sql(`select id from feed_allowlist_records where server_registration_id = $1 and feed_tier_id = $2`, [serverId, tierId])).rows[0];
  assert.ok(rec, "the approve path wrote an allowlist record");
  return { recordId: rec.id as string };
}

async function getList(token: string) {
  const route = await import("../app/api/feed-box/allowlist/route");
  const res = await route.GET(new Request("https://portal.horizonhft.com/api/feed-box/allowlist", { headers: { authorization: `Bearer ${token}` } }) as any);
  return { status: res.status, body: (await res.json()) as any };
}

async function postStatus(token: string, body: unknown, opts: { contentType?: string; raw?: string; length?: string } = {}) {
  const route = await import("../app/api/feed-box/status/route");
  const headers: Record<string, string> = { authorization: `Bearer ${token}`, "content-type": opts.contentType ?? "application/json" };
  if (opts.length) headers["content-length"] = opts.length;
  const res = await route.POST(
    new Request("https://portal.horizonhft.com/api/feed-box/status", { method: "POST", headers, body: opts.raw ?? JSON.stringify(body) }) as any
  );
  return { status: res.status, body: (await res.json()) as any };
}

const iso = (msAgo: number) => new Date(Date.now() - msAgo).toISOString();

function feed(feed_id: string, over: Record<string, unknown> = {}) {
  return { feed_id, symbol: "XAUUSD", source: "feedcompare", state: "up", last_tick_utc: iso(1000), ticks_per_min: 420, gap_p50_ms: 120, gap_p99_ms: 2400, ...over };
}

function report(box: string, feeds: unknown[], over: Record<string, unknown> = {}) {
  return { box, sent_at: iso(0), collector: { version: "0.1.0", measuring: true }, feeds, ...over };
}

// ---------- S1: a status-only box (Fable m64547) ----------

test("S1: a box needs at least one tier set; a status-only box can be created", async () => {
  const fb = await import("./feed-boxes");
  await assert.rejects(fb.createFeedBox("status-empty", [], []), /at least one tier/i);
  const box = await newBox([], LONDON());
  const status = (await sql(`select feed_tier_id from feed_box_status_tiers where box_id = $1`, [box.id])).rows.map((r: any) => r.feed_tier_id).sort();
  assert.deepEqual(status, [...LONDON()].sort());
  assert.equal((await sql(`select count(*)::int as n from feed_box_tiers where box_id = $1`, [box.id])).rows[0].n, 0);
});

test("S1: a status-only box's token GETs an EMPTY signed allowlist even when a London record is open; an apply box on that tier gets it (control)", async () => {
  const london = await granted(T["ld-beta-56"], "203.0.113.90");
  const statusOnly = await newBox([], LONDON());
  const applies = await newBox([T["ld-beta-56"]], []);
  const a = await getList(statusOnly.token);
  assert.equal(a.status, 200);
  assert.deepEqual([a.body.data.records, a.body.data.skipped], [[], []]);
  const control = await getList(applies.token);
  assert.ok(control.body.data.records.some((r: any) => r.record_id === london.recordId), "the record is real and served to an apply box");
});

test("S1: setting the STATUS set writes 0 rows to feed_box_tiers; removing a tier drops its latest rows", async () => {
  const fb = await import("./feed-boxes");
  const box = await newBox([T["cme-ctrader-fix"]], []);
  const applyBefore = (await sql(`select feed_tier_id from feed_box_tiers where box_id = $1 order by 1`, [box.id])).rows;
  await fb.setBoxStatusTiers(box.id, [T["ld-alpha-85"], T["ld-beta-56"]]);
  assert.deepEqual((await sql(`select feed_tier_id from feed_box_tiers where box_id = $1 order by 1`, [box.id])).rows, applyBefore, "apply set unchanged");
  assert.equal((await postStatus(box.token, report(box.name, [feed("ld-alpha-85"), feed("ld-beta-56")]))).status, 200);
  await fb.setBoxStatusTiers(box.id, [T["ld-beta-56"]]);
  const left = (await sql(`select ft.tier_key from feed_status_latest l join feed_tiers ft on ft.id = l.feed_tier_id where l.box_id = $1`, [box.id])).rows;
  assert.deepEqual(left.map((r: any) => r.tier_key), ["ld-beta-56"]);
  assert.deepEqual((await sql(`select feed_tier_id from feed_box_tiers where box_id = $1 order by 1`, [box.id])).rows, applyBefore);
});

// ---------- the route: auth and body gates ----------

test("route: preview 404, bad token 401, wrong content-type 415, over 16 KB 413, bad JSON 400, box name mismatch 400", async () => {
  const box = await newBox([], LONDON());
  const ok = report(box.name, [feed("ld-alpha-85")]);
  assert.equal((await postStatus("z".repeat(43), ok)).status, 401);
  assert.equal((await postStatus(box.token, ok, { contentType: "text/plain" })).status, 415);
  assert.equal((await postStatus(box.token, ok, { length: "20000" })).status, 413);
  assert.equal((await postStatus(box.token, null, { raw: JSON.stringify({ ...ok, pad: "x".repeat(17_000) }) })).status, 413, "bytes read, not only the header");
  assert.equal((await postStatus(box.token, null, { raw: "{not json" })).status, 400);
  const wrong = await postStatus(box.token, { ...ok, box: "tommy4" });
  assert.equal(wrong.status, 400);
  assert.match(wrong.body.error, /box/);
  process.env.VERCEL_ENV = "preview";
  assert.equal((await postStatus(box.token, ok)).status, 404, "a preview shares the prod DB: it must never take a report");
  assert.equal((await sql(`select count(*)::int as n from feed_status_latest where box_id = $1`, [box.id])).rows[0].n, 0, "nothing written");
});

test("parse: strict payload rules (Fable m64547, marcus m64552)", async () => {
  const { parseStatusBody } = await import("./feed-status");
  const now = new Date();
  const p = (body: unknown) => parseStatusBody(body, now);
  const good = report("b", [feed("ld-alpha-85")]);
  assert.equal(p(good).ok, true);
  const bad: [string, unknown][] = [
    ["unknown top-level key", { ...good, note: "hi" }],
    ["unknown feed key", report("b", [{ ...feed("ld-alpha-85"), reason: "x" }])],
    ["sent_at not Z", { ...good, sent_at: "2026-10-11T05:00:00+01:00" }],
    ["sent_at missing", { ...good, sent_at: undefined }],
    ["sent_at > now+60s", { ...good, sent_at: new Date(now.getTime() + 61_000).toISOString() }],
    ["sent_at older than 5 min", { ...good, sent_at: new Date(now.getTime() - 301_000).toISOString() }],
    ["collector missing", { ...good, collector: undefined }],
    ["collector.version not numeric-dotted", { ...good, collector: { version: "0.1.0-dev", measuring: true } }],
    ["collector.measuring not boolean", { ...good, collector: { version: "1", measuring: "yes" } }],
    ["feeds empty while measuring", report("b", [])],
    ["33 feeds", report("b", Array.from({ length: 33 }, (_, i) => feed("ld-alpha-85", { symbol: `S${i}` })))],
    ["duplicate (feed_id, symbol)", report("b", [feed("ld-alpha-85"), feed("ld-alpha-85")])],
    ["bad feed_id", report("b", [feed("London Alpha")])],
    ["bad symbol", report("b", [feed("ld-alpha-85", { symbol: "xauusd" })])],
    ["bad source", report("b", [feed("ld-alpha-85", { source: "bridge" })])],
    ["bad state", report("b", [feed("ld-alpha-85", { state: "green" })])],
    ["up without last tick", report("b", [feed("ld-alpha-85", { last_tick_utc: null })])],
    ["last tick > now+60s", report("b", [feed("ld-alpha-85", { last_tick_utc: new Date(now.getTime() + 61_000).toISOString() })])],
    ["not_measured with a metric", report("b", [feed("ld-alpha-85", { state: "not_measured", last_tick_utc: null, gap_p50_ms: null, gap_p99_ms: null })])],
    ["not_measured with a last tick", report("b", [feed("ld-alpha-85", { state: "not_measured", ticks_per_min: null, gap_p50_ms: null, gap_p99_ms: null })])],
    ["measuring=false with a measured feed", { ...report("b", [feed("ld-alpha-85")]), collector: { version: "1", measuring: false } }],
    ["fractional ticks", report("b", [feed("ld-alpha-85", { ticks_per_min: 1.5 })])],
    ["negative gap", report("b", [feed("ld-alpha-85", { gap_p50_ms: -1 })])],
    ["gap over a day", report("b", [feed("ld-alpha-85", { gap_p99_ms: 86_400_001 })])],
    ["ticks over 1e7", report("b", [feed("ld-alpha-85", { ticks_per_min: 10_000_001 })])],
    ["not an object", [good]],
  ];
  for (const [what, body] of bad) assert.equal(p(body).ok, false, what);

  const nm = { feed_id: "ld-ultra", symbol: "XAUUSD", source: "bridge_ticks", state: "not_measured", last_tick_utc: null, ticks_per_min: null, gap_p50_ms: null, gap_p99_ms: null };
  const fine: [string, unknown][] = [
    ["same feed, two symbols", report("b", [feed("ld-beta-56"), feed("ld-beta-56", { symbol: "XBRUSD" })])],
    ["measuring=false, no feeds", { ...report("b", []), collector: { version: "0.1.0", measuring: false } }],
    ["measuring=false, all not_measured", { ...report("b", [nm]), collector: { version: "0.1.0", measuring: false } }],
    ["measuring=true, all not_measured", report("b", [nm])],
    ["bridge_status down, no last tick", report("b", [feed("ld-ultra", { source: "bridge_status", state: "down", last_tick_utc: null, ticks_per_min: null, gap_p50_ms: null, gap_p99_ms: null })])],
    ["closed, metrics absent", report("b", [{ feed_id: "ld-gamma-19", symbol: "XAUUSD", source: "feedcompare", state: "closed" }])],
    ["version '1'", { ...good, collector: { version: "1", measuring: true } }],
    ["sent_at 59 s ahead", { ...good, sent_at: new Date(now.getTime() + 59_000).toISOString() }],
    ["sent_at 299 s old", { ...good, sent_at: new Date(now.getTime() - 299_000).toISOString() }],
  ];
  for (const [what, body] of fine) assert.equal(p(body).ok, true, `${what}: ${JSON.stringify(p(body))}`);
});

// ---------- the write ----------

test("write: known feeds in the status set are stored; unknown and out-of-set ids are ignored, listed and kept on the box; one clock", async () => {
  const box = await newBox([], [T["ld-alpha-85"], T["ld-beta-56"]]);
  const r = await postStatus(
    box.token,
    report(box.name, [feed("ld-alpha-85"), feed("ld-beta-56", { symbol: "XBRUSD", source: "feedcompare" }), feed("london-alpha"), feed("ld-delta-18")])
  );
  assert.equal(r.status, 200, JSON.stringify(r.body));
  assert.equal(r.body.stored, 2);
  assert.equal(r.body.superseded, false);
  assert.deepEqual(r.body.ignored, [
    { feed_id: "london-alpha", symbol: "XAUUSD", reason: "unknown feed_id" },
    { feed_id: "ld-delta-18", symbol: "XAUUSD", reason: "not in this box's status set" },
  ]);
  const b = (await sql(`select status_reported_at, status_sent_at, status_measuring, status_collector_version, status_ignored from feed_boxes where id = $1`, [box.id])).rows[0];
  assert.equal(b.status_measuring, true);
  assert.equal(b.status_collector_version, "0.1.0");
  assert.deepEqual(b.status_ignored, r.body.ignored);
  const rows = (await sql(`select l.*, ft.tier_key from feed_status_latest l join feed_tiers ft on ft.id = l.feed_tier_id where box_id = $1 order by ft.tier_key, symbol`, [box.id])).rows;
  assert.deepEqual(rows.map((x: any) => [x.tier_key, x.symbol, x.state, x.source, x.ticks_per_min]), [
    ["ld-alpha-85", "XAUUSD", "up", "feedcompare", 420],
    ["ld-beta-56", "XBRUSD", "up", "feedcompare", 420],
  ]);
  for (const x of rows) assert.equal(new Date(x.received_at).getTime(), new Date(b.status_reported_at).getTime(), "received_at and status_reported_at: one now()");
});

test("S2: an out-of-order (older) report is 200 stored:0 superseded:true and changes NOTHING, box stamp included", async () => {
  const box = await newBox([], [T["ld-alpha-85"]]);
  const sentB = iso(10_000);
  const sentA = iso(20_000);
  assert.equal((await postStatus(box.token, report(box.name, [feed("ld-alpha-85", { state: "down" })], { sent_at: sentB }))).status, 200);
  const before = (await sql(`select status_reported_at, status_sent_at, status_ignored from feed_boxes where id = $1`, [box.id])).rows[0];
  // Fable m64579: older A also carries a key B did not (EURUSD). Superseded is decided once, at box level, before any
  // row write, so A inserts nothing new either.
  const late = await postStatus(
    box.token,
    report(box.name, [feed("ld-alpha-85", { state: "up" }), feed("ld-alpha-85", { symbol: "EURUSD" }), feed("nope-1")], { sent_at: sentA })
  );
  assert.equal(late.status, 200);
  assert.equal(late.body.stored, 0);
  assert.equal(late.body.superseded, true);
  const rows = (await sql(`select symbol, state, box_sent_at from feed_status_latest where box_id = $1`, [box.id])).rows;
  assert.deepEqual(rows.map((r: any) => r.symbol), ["XAUUSD"], "no EURUSD row from the older report");
  const row = rows[0];
  assert.equal(row.state, "down", "the old 'up' never wins");
  assert.equal(new Date(row.box_sent_at).toISOString(), sentB);
  const after = (await sql(`select status_reported_at, status_sent_at, status_ignored from feed_boxes where id = $1`, [box.id])).rows[0];
  assert.deepEqual(after, before, "box stamp, sent_at and ignored list untouched");
  // The same sent_at again (a retry of B) is also superseded: only a strictly newer report wins.
  assert.equal((await postStatus(box.token, report(box.name, [feed("ld-alpha-85")], { sent_at: sentB }))).body.superseded, true);
});

test("S2: the row upsert is itself conditional on box_sent_at (guard holds even if the box stamp were cleared)", async () => {
  const box = await newBox([], [T["ld-alpha-85"]]);
  await postStatus(box.token, report(box.name, [feed("ld-alpha-85", { state: "down" })], { sent_at: iso(5_000) }));
  await sql(`update feed_boxes set status_sent_at = null where id = $1`, [box.id]);
  await postStatus(box.token, report(box.name, [feed("ld-alpha-85", { state: "up" })], { sent_at: iso(30_000) }));
  assert.equal((await sql(`select state from feed_status_latest where box_id = $1`, [box.id])).rows[0].state, "down");
});

// ---------- effective state (portal clock, S3, worst-of) ----------

test("effective state: the box's last report is the clock: <=120 s reported state, 121-600 s unknown, >600 s 'No report' (boundaries)", async () => {
  const { effectiveFeedState } = await import("./feed-status");
  const now = new Date("2026-10-11T12:00:00Z");
  const at = (s: number) => new Date(now.getTime() - s * 1000);
  const row = (s: number) => ({ state: "up" as const, receivedAt: at(s), lastTickAt: at(s), source: "feedcompare" as const, symbol: "XAUUSD" });
  const box = (s: number) => ({ statusReportedAt: at(s), measuring: true });
  const kind = (s: number) => effectiveFeedState(row(s), box(s), now).kind;
  assert.deepEqual([119, 120, 121, 599, 600, 601].map(kind), ["up", "up", "unknown", "unknown", "unknown", "no_report"]);
  const unknown = effectiveFeedState(row(300), box(300), now);
  assert.equal(unknown.label, "Unknown");
  assert.match(unknown.detail, /^no recent report, last 2026-10-11 11:55 UTC$/);
  const silent = effectiveFeedState(row(900), box(900), now);
  assert.equal(silent.label, "No report");
  assert.match(silent.detail, /^no report since 2026-10-11 11:45 UTC$/);
  assert.notEqual(silent.label, "Down", "silence is never 'Down' (Q1)");
});

test("S3: box fresh but the row missing from its last report -> 'Not in last report'; NOT when the collector is stopped", async () => {
  const { effectiveFeedState } = await import("./feed-status");
  const now = new Date("2026-10-11T12:00:00Z");
  const fresh = new Date(now.getTime() - 30_000);
  const older = new Date(now.getTime() - 700_000);
  const row = { state: "up" as const, receivedAt: older, lastTickAt: older, source: "feedcompare" as const, symbol: "XAUUSD" };
  const missing = effectiveFeedState(row, { statusReportedAt: fresh, measuring: true }, now);
  assert.equal(missing.kind, "not_in_last_report");
  assert.equal(missing.label, "Not in last report");
  assert.match(missing.detail, /^last reported 2026-10-11 11:48 UTC$/);
  const stopped = effectiveFeedState(row, { statusReportedAt: fresh, measuring: false }, now);
  assert.equal(stopped.kind, "collector_stopped");
  assert.equal(stopped.label, "not measured (collector stopped)");
  // Fable m64579: a stopped collector that then goes silent ages like any other box.
  const stoppedThenSilent = (s: number) => effectiveFeedState(row, { statusReportedAt: new Date(now.getTime() - s * 1000), measuring: false }, now).kind;
  assert.deepEqual([120, 121, 601].map(stoppedThenSilent), ["collector_stopped", "unknown", "no_report"]);
  // Boundary on the ROW clock: the same instant as the box stamp is "in the last report".
  assert.equal(effectiveFeedState({ ...row, receivedAt: fresh }, { statusReportedAt: fresh, measuring: true }, now).kind, "up");
  assert.equal(effectiveFeedState({ ...row, receivedAt: new Date(fresh.getTime() - 1) }, { statusReportedAt: fresh, measuring: true }, now).kind, "not_in_last_report");
  // A closed feed reads as a schedule, not an observation.
  assert.equal(effectiveFeedState({ ...row, state: "closed", receivedAt: fresh }, { statusReportedAt: fresh, measuring: true }, now).label, "Closed (schedule)");
});

test("worst-of: down > stale > not_measured > up across symbols; closed only if every symbol is closed; derived states ranked", async () => {
  const { feedBadge } = await import("./feed-status");
  const s = (kind: string) => ({ kind, label: kind, detail: "" }) as any;
  assert.equal(feedBadge([s("up"), s("stale"), s("not_measured")]).kind, "stale");
  assert.equal(feedBadge([s("up"), s("down")]).kind, "down");
  assert.equal(feedBadge([s("not_measured"), s("up")]).kind, "not_measured");
  assert.equal(feedBadge([s("closed"), s("up")]).kind, "up", "closed only if every symbol is closed");
  assert.equal(feedBadge([s("closed"), s("closed")]).kind, "closed");
  assert.equal(feedBadge([s("closed"), s("stale")]).kind, "stale");
  assert.equal(feedBadge([s("no_report"), s("stale")]).kind, "no_report", "No report ranks with down");
  assert.equal(feedBadge([s("unknown"), s("not_measured")]).kind, "unknown", "unknown ranks with stale");
  assert.equal(feedBadge([s("not_in_last_report"), s("up")]).kind, "not_in_last_report", "not-in-last-report ranks with stale");
  assert.equal(feedBadge([s("collector_stopped"), s("up")]).kind, "collector_stopped", "collector stopped ranks with not_measured");
  assert.equal(feedBadge([]).kind, "no_rows");
});

// ---------- revoke token (Q4) ----------

test("revoke token: token_sha256 null, rotated_at + serial untouched, one audit row; both endpoints 401 after", async () => {
  const fb = await import("./feed-boxes");
  const box = await newBox([], [T["ld-alpha-85"]]);
  await getList(box.token);
  const before = (await sql(`select rotated_at, serial from feed_boxes where id = $1`, [box.id])).rows[0];
  const out = await fb.revokeBoxToken({ boxId: box.id, adminUserId: ADMIN });
  assert.equal(out.name, box.name);
  const after = (await sql(`select token_sha256, rotated_at, serial from feed_boxes where id = $1`, [box.id])).rows[0];
  assert.equal(after.token_sha256, null);
  assert.deepEqual([after.rotated_at, after.serial], [before.rotated_at, before.serial]);
  const audit = (await sql(`select admin_user_id, details_json from admin_actions where action_type = 'feed_box_token_revoked' and details_json->>'box' = $1`, [box.name])).rows;
  assert.deepEqual(audit, [{ admin_user_id: ADMIN, details_json: { box: box.name } }]);
  assert.equal((await getList(box.token)).status, 401);
  assert.equal((await postStatus(box.token, report(box.name, [feed("ld-alpha-85")]))).status, 401);
  await assert.rejects(fb.revokeBoxToken({ boxId: box.id, adminUserId: ADMIN }), /no token/i);
});

// ---------- /admin pages ----------

test("/admin/feed-health: per box and per feed, worst-of badge, symbol + source, ignored ids; allowlist boxes only as 'Box reporting'", async () => {
  const { default: Page } = await import("../app/admin/feed-health/page");
  const box = await newBox([], LONDON());
  await postStatus(
    box.token,
    report(box.name, [
      feed("ld-alpha-85"),
      feed("ld-beta-56", { state: "stale" }),
      feed("ld-beta-56", { symbol: "XBRUSD" }),
      feed("ld-ultra", { source: "bridge_status", state: "down", last_tick_utc: null, ticks_per_min: null, gap_p50_ms: null, gap_p99_ms: null }),
      feed("london-alpha"),
    ])
  );
  const page = renderToStaticMarkup(await Page());
  // Earlier tests' boxes render too: read only this box's section.
  const start = page.indexOf(`data-box="${box.name}"`);
  assert.ok(start > 0, "the box has a section");
  const html = page.slice(start, page.indexOf("</section>", start));
  assert.ok(html.includes("XAUUSD via feedcompare"));
  assert.ok(html.includes("XAUUSD via bridge_status"));
  assert.ok(html.includes("box reported 1 unknown feed id: london-alpha"));
  const section = (key: string) => html.slice(html.indexOf(`data-feed="${key}"`), html.indexOf("</tbody>", html.indexOf(`data-feed="${key}"`)));
  assert.match(section("ld-beta-56"), /data-badge="stale"/, "worst-of across XAUUSD stale + XBRUSD up");
  assert.match(section("ld-ultra"), /data-badge="down"/);
  assert.match(section("ld-gamma-19"), /Not measured yet/, "a status-set tier with no row");
  assert.ok(!/Not yet instrumented/.test(html), "the placeholder is gone");
  // An allowlist-only box (CME) shows its poll as box reporting, never as a feed state.
  const cme = await newBox([T["cme-ctrader-fix"]], []);
  await getList(cme.token);
  const html2 = renderToStaticMarkup(await Page());
  const cmeAt = html2.indexOf(`data-box-poll="${cme.name}"`);
  assert.ok(cmeAt > 0);
  assert.match(html2.slice(cmeAt, cmeAt + 400), /Box reporting · last poll/);
  assert.ok(!html2.includes(`data-feed="cme-ctrader-fix"`), "no feed pill for CME in v1");
});

test("v1 is /admin only: the provider card and /feed/dashboard/health do not read the new tables (marcus m64531)", async () => {
  for (const f of ["src/components/feed/overview-cards.tsx", "src/app/feed/dashboard/health/page.tsx", "src/app/feed/dashboard/page.tsx"]) {
    const src = readFileSync(path.join(process.cwd(), f), "utf8");
    assert.ok(!/feed-status|feed_status_latest|feed_box_status_tiers/.test(src), f);
  }
});

test("sidebar: Feed health is a real link now (soon dropped)", async () => {
  const src = readFileSync(path.join(process.cwd(), "src/components/portal/sidebar.tsx"), "utf8");
  const line = src.split("\n").find((l) => l.includes(`"/admin/feed-health"`))!;
  assert.ok(line && !line.includes("soon"), line);
});

// ---------- migration ----------

test("0101: CHECKs refuse what the route refuses; rollback removes exactly what 0101 added", async () => {
  const box = await newBox([], [T["ld-alpha-85"]]);
  const ins = (state: string, extra = "null, null, null, null") =>
    sql(
      `insert into feed_status_latest (box_id, feed_tier_id, symbol, source, state, last_tick_at, ticks_per_min, gap_p50_ms, gap_p99_ms, box_sent_at)
       values ($1, $2, 'XAUUSD', 'feedcompare', $3, ${extra}, now())`,
      [box.id, T["ld-alpha-85"], state]
    );
  await assert.rejects(ins("up"), /check/i, "up needs a last tick");
  await assert.rejects(ins("not_measured", "null, 5, null, null"), /check/i, "not_measured carries no metric");
  await assert.rejects(ins("green", "now(), null, null, null"), /check/i);
  await assert.rejects(
    sql(`insert into feed_status_latest (box_id, feed_tier_id, symbol, source, state, box_sent_at) values ($1, $2, 'XAUUSD', 'feedcompare', 'closed', now())`, [box.id, T["ld-gamma-19"]]),
    /foreign key/i,
    "a row needs the tier in the box's status set"
  );
  await assert.rejects(
    sql(`insert into feed_status_latest (box_id, feed_tier_id, symbol, source, state, box_sent_at) values ($1, $2, 'xau', 'feedcompare', 'closed', now())`, [box.id, T["ld-alpha-85"]]),
    /check/i
  );

  const scratch = new PGlite();
  await chain(scratch);
  const colsBefore = async () =>
    (await scratch.query(`select column_name from information_schema.columns where table_name = 'feed_boxes' order by column_name`)).rows.map((r: any) => r.column_name);
  assert.ok((await colsBefore()).includes("status_reported_at"));
  await scratch.exec(readFileSync(path.join(MIGRATIONS, "0101_rollback.sql"), "utf8"));
  assert.deepEqual(await colsBefore(), ["created_at", "id", "last_seen_at", "name", "rotated_at", "serial", "token_sha256"]);
  const t = (await scratch.query(`select to_regclass('feed_status_latest') as a, to_regclass('feed_box_status_tiers') as b`)).rows[0] as any;
  assert.deepEqual([t.a, t.b], [null, null]);
  assert.equal(((await scratch.query(`select count(*)::int as n from schema_migrations where version = '0101'`)).rows[0] as any).n, 0);
  assert.equal(((await scratch.query(`select count(*)::int as n from schema_migrations where version = '0098'`)).rows[0] as any).n, 1, "0098 untouched");
});
