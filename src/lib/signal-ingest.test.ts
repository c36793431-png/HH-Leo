/* Run: npx tsx --test src/lib/signal-ingest.test.ts
 *
 * Axiom signals dashboard S2a: src/lib/signal-ingest.ts and src/lib/signal-instruments.ts (marcus m67349, named GO
 * m67502; plan docs/specs/axiom-signals-dashboard-plan.md section 7's S2 list at 0e61f2c is the test contract).
 * Pinned here:
 *  - signal-instruments: per row, the 1e6 band literal = band * unit * 1e6 (fable A1 m67478/m67483);
 *  - the gate, one case per step of the section 4 list, in its order, and no body read before step 5;
 *  - every body 400 refuses the whole batch and writes nothing;
 *  - the window is derived (sessionDate 06:00Z -> 21:00Z), never sent;
 *  - the upsert: inserted / filled / scored / unchanged, entry_px_at = the fill's now(), prices compared as scaled
 *    integers, both sides rounded (a 7th decimal of the same price is unchanged, and so is an identical repost
 *    at 1.0006 / 128.003, fable S1 m67514), 6 dp at receipt, every 409 rolls the batch back;
 *  - the dead-band edges in integers (fable N4 m67474's inputs), from float literals as JSON.parse gives them;
 *  - S2b.1 (marcus GO m67588): the same key twice in one batch (fable m67577 N3), and a failed pool.connect()
 *    answers the JSON 500 with the log line (fable m67577 call 1).
 * Real Postgres, no prod: the PGlite harness of signal-calls-0110.test.ts (the REAL migration chain, same seeds),
 * with the pool swapped in through global._pgPool as bundles.test.ts does. */
import { test, before } from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { createHash, randomBytes } from "node:crypto";
import { PGlite } from "@electric-sql/pglite";
import { SIGNAL_INSTRUMENTS } from "./signal-instruments";

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
const DAY = 24 * 60 * 60 * 1000;

const TOKEN = randomBytes(32).toString("hex");
const HASH = createHash("sha256").update(TOKEN, "utf8").digest("hex");
const ENV = { VERCEL_ENV: "production", SIGNAL_INGEST_SHA256_AXIOM: HASH };
const AUTH = { authorization: `Bearer ${TOKEN}` };
/** Every request carries the horizonone host unless a case overrides it (fable S3 m68780). */
const HOST = { host: "horizonone.horizonhft.com" };
const UNAUTHORIZED = { status: 401, body: { error: "unauthorized" } };

/* eslint-disable @typescript-eslint/no-explicit-any */
let db: any;
let ing: typeof import("./signal-ingest");

before(async () => {
  db = new PGlite();
  const files = readdirSync(MIGRATIONS).filter((f) => f.endsWith(".sql") && !f.includes("rollback")).sort();
  for (const f of files) {
    if (SKIPPED.has(f)) continue;
    if (SEEDS[f]) await db.exec(SEEDS[f]);
    await db.exec(readFileSync(path.join(MIGRATIONS, f), "utf8"));
  }
  const query = async (text: string, params: unknown[] = []) => {
    const r = await db.query(text, params);
    return { rows: r.rows as any[], rowCount: (r.rows.length || r.affectedRows || 0) as number };
  };
  (globalThis as any)._pgPool = { query, connect: async () => ({ query, release() {} }), end: async () => {} };
  process.env.NEON_DATABASE_URL = "postgres://unused";
  ing = await import("./signal-ingest");
});

/** A fresh session date per call, so the unique key never collides by accident. */
let seq = 0;
function nextDay() {
  return new Date(Date.UTC(2026, 0, 1) + ++seq * DAY).toISOString().slice(0, 10);
}

const reg = (d: string, extra: Record<string, unknown> = {}) => ({ symbol: "EURUSD", sessionDate: d, direction: "up", ...extra });
const entry = (d: string, px = 1.085, h = "06") => ({ entryPx: px, entryBarTs: `${d}T${h}:00:00Z` });
const exit = (d: string, px = 1.09, h = "20") => ({ exitPx: px, exitBarTs: `${d}T${h}:00:00Z` });
const body = (...calls: unknown[]) => ({ source: "axiom", calls });

/** A request whose body read is counted, so a test can show the gate ran first. */
function request(raw: string, headers: Record<string, string> = {}) {
  const r = {
    reads: 0,
    headers: new Headers({ "content-type": "application/json", ...HOST, ...AUTH, ...headers }),
    text: async () => {
      r.reads++;
      return raw;
    },
  };
  return r;
}

async function post(b: unknown, opts: { source?: string; headers?: Record<string, string>; env?: Record<string, string> } = {}) {
  const r = request(typeof b === "string" ? b : JSON.stringify(b), opts.headers);
  return ing.handleSignalIngest(opts.source ?? "axiom", r, opts.env ?? ENV);
}

const rowCount = async () => Number((await db.query(`select count(*)::int as n from signal_calls`)).rows[0].n);
async function stored(d: string, symbol = "EURUSD") {
  const r = await db.query(
    `select *, entry_px::text as entry_t, exit_px::text as exit_t, move::text as move_t
     from signal_calls where source = 'axiom' and symbol = $1 and session_date = $2`,
    [symbol, d]
  );
  return r.rows[0];
}

test("signal-instruments: the six symbols, and per row the 1e6 band literal = band * unit * 1e6", () => {
  assert.deepEqual(Object.keys(SIGNAL_INSTRUMENTS).sort(), ["AUDUSD", "EURUSD", "GBPUSD", "US30", "USDJPY", "XAUUSD"]);
  for (const [symbol, i] of Object.entries(SIGNAL_INSTRUMENTS)) {
    assert.equal(i.bandInt, i.band * i.unit * 1e6, `${symbol}: bandInt literal`);
    assert.ok(Number.isInteger(i.bandInt), `${symbol}: bandInt is an integer`);
    // scaledDecimal needs the unit at 1e6 to be a power of ten.
    const ui = Math.round(i.unit * 1e6);
    assert.equal(10 ** (String(ui).length - 1), ui, `${symbol}: unit * 1e6 is a power of ten`);
  }
  assert.equal(SIGNAL_INSTRUMENTS.XAUUSD.yahooTicker, "GC=F", "futures, not spot (R3)");
  assert.equal(SIGNAL_INSTRUMENTS.US30.yahooTicker, "YM=F", "futures, not spot (R3)");
});

test("the gate, in the section 4 order", () => {
  const g = (source: string, headers: Record<string, string>, env: Record<string, string>, sources?: any) =>
    ing.gateSignalIngest(source, new Headers({ ...HOST, ...headers }), env, sources);
  const NOT_FOUND = { status: 404, body: { error: "not found" } };

  // 1. Not production -> 404, whatever else is right.
  assert.deepEqual(g("axiom", AUTH, { ...ENV, VERCEL_ENV: "preview" }), NOT_FOUND);
  assert.equal(g("axiom", AUTH, { SIGNAL_INGEST_SHA256_AXIOM: HASH })?.status, 404);

  // 1b. Not the horizonone host -> the same 404, before the source and the token (fable S3 m68780). A valid
  // token on the old portal URL is 404, not 401.
  assert.deepEqual(g("axiom", { ...AUTH, host: "portal.horizonhft.com" }, ENV), NOT_FOUND, "portal with a valid token");
  assert.deepEqual(g("sentiment", { ...AUTH, host: "portal.horizonhft.com" }, ENV), NOT_FOUND, "host before source");
  assert.deepEqual(g("axiom", { host: "portal.horizonhft.com" }, ENV), NOT_FOUND, "host before token");
  assert.deepEqual(g("axiom", { ...AUTH, host: "xhorizonone.horizonhft.com" }, ENV), NOT_FOUND, "not a suffix match");
  assert.deepEqual(g("axiom", { ...AUTH, host: "localhost:3000" }, ENV), NOT_FOUND, "localhost without the dev bypass");
  assert.deepEqual(ing.gateSignalIngest("axiom", new Headers(AUTH), ENV), NOT_FOUND, "no host header");
  assert.equal(g("axiom", { ...AUTH, host: "horizonone.horizonhft.com:443" }, ENV), null, "with a port");
  assert.equal(g("axiom", { ...AUTH, host: "HorizonOne.HorizonHFT.com" }, ENV), null, "any case");
  assert.equal(g("axiom", { ...AUTH, host: "localhost:3000" }, { ...ENV, NODE_ENV: "development" }), null, "dev bypass");

  // 2. Bad format, not in the map, env unset, env malformed: one code and one body for all four.
  assert.deepEqual(g("Axiom", AUTH, ENV), UNAUTHORIZED, "bad format");
  assert.deepEqual(g("a", AUTH, ENV), UNAUTHORIZED, "bad format (too short)");
  assert.deepEqual(g("sentiment", AUTH, ENV), UNAUTHORIZED, "not in the map");
  assert.deepEqual(g("constructor", AUTH, ENV), UNAUTHORIZED, "not in the map (an Object.prototype key)");
  assert.deepEqual(g("axiom", AUTH, { VERCEL_ENV: "production" }), UNAUTHORIZED, "env unset");
  assert.deepEqual(g("axiom", AUTH, { ...ENV, SIGNAL_INGEST_SHA256_AXIOM: "abc" }), UNAUTHORIZED, "env malformed");
  assert.deepEqual(g("axiom", AUTH, { ...ENV, SIGNAL_INGEST_SHA256_AXIOM: "g".repeat(64) }), UNAUTHORIZED, "env not hex");

  // 3. IP rule, only when the source's IP var is set: first hop only.
  const IP = "198.51.100.7";
  const withIp = { ...ENV, SIGNAL_INGEST_ALLOWED_IP_AXIOM: IP };
  assert.deepEqual(g("axiom", { ...AUTH, "x-forwarded-for": "203.0.113.9" }, withIp), { status: 403, body: { error: "forbidden" } });
  assert.equal(g("axiom", AUTH, withIp)?.status, 403, "no x-forwarded-for");
  assert.equal(g("axiom", { ...AUTH, "x-forwarded-for": `10.0.0.1, ${IP}` }, withIp)?.status, 403, "a later hop is not the caller");
  assert.equal(g("axiom", { ...AUTH, "x-forwarded-for": `${IP}, 10.0.0.1` }, withIp), null, "first hop is the caller");
  assert.equal(g("axiom", { "x-forwarded-for": "203.0.113.9" }, withIp)?.status, 403, "IP is checked before the token");
  assert.equal(g("axiom", { ...AUTH, "x-forwarded-for": "203.0.113.9" }, ENV), null, "unset = no IP rule");

  // 4. Token.
  assert.equal(g("axiom", AUTH, ENV), null);
  assert.deepEqual(g("axiom", {}, ENV), UNAUTHORIZED, "no token");
  assert.deepEqual(g("axiom", { authorization: "Bearer short" }, ENV), UNAUTHORIZED, "short token");
  assert.deepEqual(g("axiom", { authorization: `Bearer ${"0".repeat(64)}` }, ENV), UNAUTHORIZED, "wrong token");
  assert.deepEqual(g("axiom", { authorization: `Basic ${TOKEN}` }, ENV), UNAUTHORIZED);
  assert.equal(g("axiom", AUTH, { ...ENV, SIGNAL_INGEST_SHA256_AXIOM: HASH.toUpperCase() }), null, "upper-case hex is the same hash");

  // A token is bound to its source: with a second source configured, the axiom token on its path is refused.
  const OTHER = randomBytes(32).toString("hex");
  const two = {
    axiom: ing.SIGNAL_SOURCES.axiom,
    sentiment: { tokenEnv: "SIGNAL_INGEST_SHA256_SENTIMENT", ipEnv: "SIGNAL_INGEST_ALLOWED_IP_SENTIMENT", windowUtcH: [0, 24] },
  };
  const envTwo = { ...ENV, SIGNAL_INGEST_SHA256_SENTIMENT: createHash("sha256").update(OTHER).digest("hex") };
  assert.deepEqual(g("sentiment", AUTH, envTwo, two), UNAUTHORIZED, "axiom token on the sentiment path");
  assert.equal(g("sentiment", { authorization: `Bearer ${OTHER}` }, envTwo, two), null);
  assert.deepEqual(g("axiom", { authorization: `Bearer ${OTHER}` }, envTwo, two), UNAUTHORIZED, "and the reverse");

  const src = readFileSync(path.join(process.cwd(), "src/lib/signal-ingest.ts"), "utf8");
  assert.match(src, /timingSafeEqual\(presented, Buffer\.from\(expectedHex, "hex"\)\)/, "constant-time compare, not ===");
});

test("a refused gate reads no body and writes nothing; a passed one reads it once", async () => {
  const d = nextDay();
  const raw = JSON.stringify(body(reg(d)));
  const n0 = await rowCount();
  const cases: [string, Record<string, string>, Record<string, string>, number][] = [
    ["axiom", {}, { ...ENV, VERCEL_ENV: "preview" }, 404],
    ["axiom", { host: "portal.horizonhft.com" }, ENV, 404],
    ["sentiment", {}, ENV, 401],
    ["axiom", {}, { VERCEL_ENV: "production" }, 401],
    ["axiom", { "x-forwarded-for": "203.0.113.9" }, { ...ENV, SIGNAL_INGEST_ALLOWED_IP_AXIOM: "198.51.100.7" }, 403],
    ["axiom", { authorization: "Bearer short" }, ENV, 401],
  ];
  for (const [source, headers, env, status] of cases) {
    const r = request(raw, headers);
    assert.equal((await ing.handleSignalIngest(source, r, env)).status, status);
    assert.equal(r.reads, 0, `${status} ${source}: body not read`);
  }
  assert.equal(await rowCount(), n0);

  const ok = request(raw);
  assert.equal((await ing.handleSignalIngest("axiom", ok, ENV)).status, 200);
  assert.equal(ok.reads, 1);
});

test("body 400s: the whole batch is refused and nothing is written", async () => {
  const good = () => reg(nextDay());
  const refused = async (b: unknown, re: RegExp, index?: number, symbol?: string, opts: { headers?: Record<string, string> } = {}) => {
    const n0 = await rowCount();
    const r = await post(b, opts);
    assert.equal(r.status, 400, `expected 400 for ${re}, got ${r.status} ${JSON.stringify(r.body)}`);
    const e = r.body as { error: string; index?: number; symbol?: string };
    assert.match(e.error, re);
    assert.equal(e.index, index, `index for ${re}`);
    assert.equal(e.symbol, symbol, `symbol for ${re}`);
    assert.equal(await rowCount(), n0, `nothing written for ${re}`);
  };

  await refused("{", /not JSON/);
  await refused(JSON.stringify(body(good())), /content-type/, undefined, undefined, { headers: { "content-type": "text/plain" } });
  await refused({ ...body(good()), note: 1 }, /unknown field\(s\): note/);
  await refused(body(good(), { ...good(), note: 1 }), /unknown field\(s\): note/, 1);
  await refused(body(), /1 to 200/);
  await refused(body(...Array.from({ length: 201 }, good)), /1 to 200/);

  // 64 KB + 1 refused; exactly 64 KB accepted (JSON allows the trailing spaces).
  const d64 = nextDay();
  const raw = JSON.stringify(body(reg(d64)));
  await refused(raw.padEnd(ing.MAX_BODY_BYTES + 1, " "), /body over 65536 bytes/);
  assert.deepEqual((await post(raw.padEnd(ing.MAX_BODY_BYTES, " "))).body, { inserted: 1, scored: 0, filled: 0, unchanged: 0 });

  await refused(body(good(), { ...good(), sessionDate: "2026-02-30" }), /sessionDate/, 1);
  await refused(body({ ...good(), sessionDate: "2026-1-05" }), /sessionDate/, 0);
  await refused(body(good(), { ...good(), direction: "buy" }), /direction/, 1);
  await refused({ source: "sentiment", calls: [good()] }, /body source/);
  await refused(body(good(), { ...good(), symbol: "BTCUSD" }), /unknown symbol/, 1, "BTCUSD");
  await refused(body(good(), { ...good(), move: 5 }), /unknown field\(s\): move/, 1);
  await refused(body(good(), { ...good(), outcome: "right" }), /unknown field\(s\): outcome/, 1);
  await refused(body(good(), { ...good(), entryTs: "2026-01-01T06:00:00Z" }), /unknown field\(s\): entryTs/, 1);
  await refused(body(good(), { ...good(), exitTs: "2026-01-01T21:00:00Z" }), /unknown field\(s\): exitTs/, 1);
  const dn = nextDay();
  await refused(body(good(), reg(dn, { direction: "neutral", ...entry(dn) })), /neutral call carries no prices/, 1);
  await refused(body(good(), reg(dn, { direction: "neutral", ...entry(dn), ...exit(dn) })), /neutral call carries no prices/, 1);
  await refused(body(good(), { ...good(), meta: { source: "card-ish" } }), /meta\.source/, 1);
  await refused(body(good(), { ...good(), meta: [1] }), /meta must be a JSON object/, 1);

  // Pairing: a price and its bar come together.
  const dp = nextDay();
  await refused(body(good(), reg(dp, { entryPx: 1.085 })), /entryPx and entryBarTs/, 1);
  await refused(body(good(), reg(dp, { entryBarTs: `${dp}T06:00:00Z` })), /entryPx and entryBarTs/, 1);
  await refused(body(good(), reg(dp, { ...entry(dp), exitPx: 1.09 })), /exitPx and exitBarTs/, 1);
  await refused(body(good(), reg(dp, { ...entry(dp), exitBarTs: `${dp}T20:00:00Z` })), /exitPx and exitBarTs/, 1);
  await refused(body(good(), reg(dp, { entryPx: -1, entryBarTs: `${dp}T06:00:00Z` })), /entryPx must be a positive number/, 1);
  await refused(body(good(), reg(dp, { entryPx: "1.085", entryBarTs: `${dp}T06:00:00Z` })), /entryPx must be a positive number/, 1);
  await refused(body(good(), reg(dp, { entryPx: 1.085, entryBarTs: `${dp}T06:00` })), /entryBarTs must be an ISO-8601/, 1);

  // A bar ts outside [entry_ts, exit_ts): one before entry_ts, one AT exit_ts.
  await refused(body(good(), reg(dp, entry(dp, 1.085, "05"))), /entryBarTs must be at or after/, 1);
  await refused(body(good(), reg(dp, { ...entry(dp), ...exit(dp, 1.09, "21") })), /exitBarTs must be at or after/, 1);

  // exitPx with no entryPx, sent or stored. New key: refused in the transaction, so call 0 is rolled back too.
  const dx = nextDay();
  await refused(body(good(), reg(dx, exit(dx))), /exitPx needs an entryPx/, 1);
  // Stored registration without an entry.
  assert.equal((await post(body(reg(dx)))).status, 200);
  await refused(body(good(), reg(dx, exit(dx))), /exitPx needs an entryPx/, 1);
  assert.equal((await stored(dx)).exit_px, null);
});

test("window: entry_ts and exit_ts are stored as sessionDate 06:00Z and 21:00Z", async () => {
  const d = nextDay();
  assert.equal((await post(body(reg(d)))).status, 200);
  const r = await stored(d);
  assert.equal(new Date(r.entry_ts).toISOString(), `${d}T06:00:00.000Z`);
  assert.equal(new Date(r.exit_ts).toISOString(), `${d}T21:00:00.000Z`);
});

test("upsert: register, fill, score; entry_px_at is the fill's now(); reposts are unchanged", async () => {
  const d = nextDay();
  assert.deepEqual((await post(body(reg(d, { meta: { source: "card" } })))).body, { inserted: 1, scored: 0, filled: 0, unchanged: 0 });
  let r = await stored(d);
  assert.equal(r.entry_px, null);
  assert.equal(r.entry_px_at, null);
  assert.equal(r.outcome, null);
  assert.deepEqual(r.meta, { source: "card" });

  await new Promise((resolve) => setTimeout(resolve, 5));
  const t0 = Date.now();
  assert.deepEqual((await post(body(reg(d, entry(d))))).body, { inserted: 0, scored: 0, filled: 1, unchanged: 0 });
  const t1 = Date.now();
  r = await stored(d);
  assert.equal(r.entry_t, "1.085000");
  assert.equal(new Date(r.entry_bar_ts).toISOString(), `${d}T06:00:00.000Z`);
  const at = new Date(r.entry_px_at).getTime();
  assert.ok(at >= t0 && at <= t1, "entry_px_at is the fill's clock, not sent");
  assert.ok(new Date(r.received_at).getTime() < t0, "received_at is the first receipt, never rewritten");

  const before = new Date(r.updated_at).getTime();
  assert.deepEqual((await post(body(reg(d, { ...entry(d), meta: { source: "card" } })))).body, { inserted: 0, scored: 0, filled: 0, unchanged: 1 });
  assert.equal(new Date((await stored(d)).updated_at).getTime(), before, "unchanged = no write");

  assert.deepEqual((await post(body(reg(d, exit(d))))).body, { inserted: 0, scored: 1, filled: 0, unchanged: 0 });
  r = await stored(d);
  assert.equal(r.outcome, "right");
  assert.equal(r.move_t, "50.00");
  assert.equal(r.exit_t, "1.090000");
  assert.equal(new Date(r.exit_bar_ts).toISOString(), `${d}T20:00:00.000Z`);
  assert.ok(r.scored_at);
  assert.deepEqual((await post(body(reg(d, { ...entry(d), ...exit(d) })))).body, { inserted: 0, scored: 0, filled: 0, unchanged: 1 });

  // Register and score in one post: a new key is "inserted", already scored.
  const d2 = nextDay();
  assert.deepEqual((await post(body(reg(d2, { ...entry(d2), ...exit(d2) })))).body, { inserted: 1, scored: 0, filled: 0, unchanged: 0 });
  assert.equal((await stored(d2)).outcome, "right");

  // meta null -> value is a fill; a neutral registration reposted is unchanged.
  const d3 = nextDay();
  await post(body(reg(d3, { direction: "neutral" })));
  assert.deepEqual((await post(body(reg(d3, { direction: "neutral", meta: { source: "backfill" } })))).body, {
    inserted: 0,
    scored: 0,
    filled: 1,
    unchanged: 0,
  });
  assert.deepEqual((await post(body(reg(d3, { direction: "neutral" })))).body, { inserted: 0, scored: 0, filled: 0, unchanged: 1 });
});

test("prices: stored at 6 dp; a 7th decimal of the same price, or the same price exactly, is unchanged, not 409", async () => {
  const d = nextDay();
  await post(body(reg(d, entry(d, 1.0850004))));
  assert.equal((await stored(d)).entry_t, "1.085000", "a price with 7 decimals is stored at 6");
  assert.deepEqual((await post(body(reg(d, entry(d, 1.0850001))))).body, { inserted: 0, scored: 0, filled: 0, unchanged: 1 });
  assert.equal((await post(body(reg(d, entry(d, 1.0850006))))).status, 409, "rounds to 1.085001: a different price");

  await post(body(reg(d, exit(d, 1.0900004))));
  assert.equal((await stored(d)).exit_t, "1.090000");
  assert.deepEqual((await post(body(reg(d, exit(d, 1.0899996))))).body, { inserted: 0, scored: 0, filled: 0, unchanged: 1 });

  // An IDENTICAL repost of a price whose float product is not an integer (fable S1 m67514): both sides are
  // rounded, so it is unchanged, not 409. The first assert shows the trap is real on the runtime under test.
  for (const [symbol, px] of [
    ["EURUSD", 1.0006],
    ["USDJPY", 128.003],
  ] as const) {
    assert.ok(!Number.isInteger(px * 1e6), `${symbol} ${px}: px * 1e6 is not an integer here`);
    const di = nextDay();
    const call = reg(di, { symbol, ...entry(di, px), ...exit(di, px) });
    assert.equal((await post(body(call))).status, 200, `${symbol} ${px}: first post`);
    assert.deepEqual((await post(body(call))).body, { inserted: 0, scored: 0, filled: 0, unchanged: 1 }, `${symbol} ${px}: repost`);
  }
});

test("409: each family, and the whole batch is rolled back", async () => {
  const conflict = async (b: unknown, re: RegExp, index: number) => {
    const n0 = await rowCount();
    const r = await post(b);
    assert.equal(r.status, 409, `expected 409 for ${re}, got ${r.status} ${JSON.stringify(r.body)}`);
    assert.match((r.body as { error: string }).error, re);
    assert.equal((r.body as { index: number }).index, index);
    assert.equal(await rowCount(), n0, `nothing in the batch written for ${re}`);
  };

  // The R5 rewritten day: a changed direction, behind a new call that must not land either.
  const d = nextDay();
  await post(body(reg(d, { ...entry(d), meta: { source: "card", confidence: 0.7 } })));
  const snapshot = JSON.stringify(await stored(d));
  await conflict(body(reg(nextDay()), reg(d, { direction: "down" })), /direction differs/, 1);
  await conflict(body(reg(nextDay()), reg(d, entry(d, 1.086))), /entryPx differs/, 1);
  await conflict(body(reg(nextDay()), reg(d, entry(d, 1.085, "07"))), /entryBarTs differs/, 1);
  await conflict(body(reg(nextDay()), reg(d, { meta: { source: "backfill", confidence: 0.7 } })), /meta differs/, 1);
  assert.equal(JSON.stringify(await stored(d)), snapshot, "the stored row is untouched");
  // Same meta in another key order is the same jsonb.
  assert.deepEqual((await post(body(reg(d, { meta: { confidence: 0.7, source: "card" } })))).body, { inserted: 0, scored: 0, filled: 0, unchanged: 1 });

  // FROZEN-ONCE-SCORED.
  await post(body(reg(d, exit(d))));
  await conflict(body(reg(nextDay()), reg(d, exit(d, 1.091))), /exitPx differs/, 1);
  await conflict(body(reg(nextDay()), reg(d, exit(d, 1.09, "19"))), /exitBarTs differs/, 1);
});

test("the same key twice in one batch: index order, a later call sees an earlier one (docs/signal-ingest.md Answers)", async () => {
  // fable m67577 N3 (marcus GO S2b.1 m67588); the doc's two cases, plus a fill and a conflict.
  const d = nextDay();
  assert.deepEqual((await post(body(reg(d, entry(d)), reg(d, entry(d))))).body, { inserted: 1, scored: 0, filled: 0, unchanged: 1 });
  const d2 = nextDay();
  assert.deepEqual((await post(body(reg(d2, entry(d2)), reg(d2, exit(d2))))).body, { inserted: 1, scored: 1, filled: 0, unchanged: 0 });
  assert.equal((await stored(d2)).outcome, "right");
  const d3 = nextDay();
  assert.deepEqual((await post(body(reg(d3), reg(d3, entry(d3))))).body, { inserted: 1, scored: 0, filled: 1, unchanged: 0 });

  const d4 = nextDay();
  const n0 = await rowCount();
  const r = await post(body(reg(d4), reg(d4, { direction: "down" })));
  assert.deepEqual(r, { status: 409, body: { error: "direction differs from the stored call", index: 1 } });
  assert.equal(await rowCount(), n0, "call 0's insert is rolled back with the batch");
});

test("a database that cannot be reached: the JSON 500 and the log line, nothing written (fable m67577 call 1)", async () => {
  const p = (globalThis as any)._pgPool;
  const connect = p.connect;
  const error = console.error;
  const logged: unknown[][] = [];
  const n0 = await rowCount();
  p.connect = async () => {
    throw new Error("connect ECONNREFUSED 127.0.0.1:5432");
  };
  console.error = (...args: unknown[]) => {
    logged.push(args);
  };
  let r;
  try {
    r = await post(body(reg(nextDay())));
  } finally {
    p.connect = connect;
    console.error = error;
  }
  assert.deepEqual(r, { status: 500, body: { error: "internal error; nothing was written" } });
  assert.deepEqual(logged, [["signal-ingest: failed", "axiom", "Error", "connect ECONNREFUSED 127.0.0.1:5432"]]);
  assert.equal(await rowCount(), n0);
});

test("dead-band edges in integers, from float literals as JSON.parse gives them (fable N4 m67474)", async () => {
  // The trap is real on this runtime: the double division lands either side of 5.
  assert.ok((1.0855 - 1.085) / 0.0001 < 5);
  assert.ok((150.05 - 150.0) / 0.01 > 5);

  const cases: [string, "up" | "down", string, string, string, string][] = [
    ["EURUSD", "up", "1.0850", "1.0855", "right", "5.00"],
    ["EURUSD", "up", "1.0845", "1.0850", "right", "5.00"],
    ["USDJPY", "up", "150.00", "150.05", "right", "5.0000"],
    ["EURUSD", "up", "1.0835", "1.0840", "right", "5.00"],
    ["EURUSD", "down", "1.0835", "1.0840", "wrong", "-5.00"],
    ["EURUSD", "up", "1.08500", "1.085496", "flat", "4.96"],
    ["XAUUSD", "up", "2650.00", "2652.00", "right", "2.000000"],
    ["XAUUSD", "up", "2650.00", "2651.99", "flat", "1.990000"],
    ["US30", "up", "45000", "45020", "right", "20.000000"],
    ["US30", "up", "45000", "45019.9", "flat", "19.900000"],
    ["EURUSD", "down", "1.0900", "1.0890", "right", "10.00"],
    ["EURUSD", "up", "1.0900", "1.0890", "wrong", "-10.00"],
    ["XAUUSD", "down", "2650", "2660", "wrong", "-10.000000"],
  ];
  for (const [symbol, direction, entryLit, exitLit, outcome, move] of cases) {
    const d = nextDay();
    // Built as text, so the prices reach JSON.parse exactly as a sender writes them.
    const raw =
      `{"source":"axiom","calls":[{"symbol":"${symbol}","sessionDate":"${d}","direction":"${direction}",` +
      `"entryPx":${entryLit},"entryBarTs":"${d}T06:00:00Z","exitPx":${exitLit},"exitBarTs":"${d}T20:00:00Z"}]}`;
    const res = await post(raw);
    assert.equal(res.status, 200, `${symbol} ${direction} ${entryLit} -> ${exitLit}: ${JSON.stringify(res.body)}`);
    const r = await stored(d, symbol);
    assert.equal(r.outcome, outcome, `${symbol} ${direction} ${entryLit} -> ${exitLit}`);
    assert.equal(r.move_t, move, `${symbol} ${direction} ${entryLit} -> ${exitLit}: move`);
  }
});
