/* Run: npx tsx --test src/lib/signal-calls.test.ts
 *
 * Axiom signals dashboard S4: src/lib/signal-calls.ts, the page's one read query (marcus GO m67643). Pinned here,
 * fable's S3 notes (m67641) as marcus ruled them requirements:
 *  - move arrives as the numeric's TEXT at its stored scale ("-8.00", "15.000000", "0.000001"), never a float;
 *  - every timestamp is a Date object; session_date is the YYYY-MM-DD text;
 *  - sender_label = meta->>'source', null when meta is null;
 *  - source and the inclusive from / to bounds filter; rows come in session_date, symbol order;
 *  - parseSignalCallsFilter: default source axiom, a bad source or an impossible date reads as the default / no bound.
 * Real Postgres, no prod: the PGlite harness of signal-ingest.test.ts (the REAL migration chain, same seeds), behind
 * the global pool, so the export the page calls (listSignalCalls) is the one under test. */
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

/* eslint-disable @typescript-eslint/no-explicit-any */
let db: any;
let query: (text: string, params?: unknown[]) => Promise<{ rows: any[]; rowCount: number }>;
let lib: typeof import("./signal-calls");

before(async () => {
  db = new PGlite();
  const files = readdirSync(MIGRATIONS).filter((f) => f.endsWith(".sql") && !f.includes("rollback")).sort();
  for (const f of files) {
    if (SKIPPED.has(f)) continue;
    if (SEEDS[f]) await db.exec(SEEDS[f]);
    await db.exec(readFileSync(path.join(MIGRATIONS, f), "utf8"));
  }
  query = async (text: string, params: unknown[] = []) => {
    const r = await db.query(text, params);
    return { rows: r.rows as any[], rowCount: (r.rows.length || r.affectedRows || 0) as number };
  };
  (globalThis as any)._pgPool = { query, connect: async () => ({ query, release() {} }), end: async () => {} };
  process.env.NEON_DATABASE_URL = "postgres://unused";
  lib = await import("./signal-calls");

  // Window 06:00Z -> 21:00Z. Scored rows carry the full stamp set 0110's CHECKs require; instants are sent as
  // ISO strings with Z, so the session TimeZone never enters.
  const at = (d: string, hm: string) => `${d}T${hm}:00Z`;
  const scored = (source: string, symbol: string, d: string, dir: string, entry: string, exit: string, move: string, outcome: string, meta: string | null) =>
    query(
      `insert into signal_calls (source, symbol, session_date, direction, entry_ts, exit_ts, entry_px, entry_px_at,
                                 entry_bar_ts, exit_px, exit_bar_ts, move, outcome, scored_at, meta, received_at)
       values ($1, $2, $3::date, $4, $5::timestamptz, $6::timestamptz, $7::numeric, $8::timestamptz,
               $5::timestamptz, $9::numeric, $10::timestamptz, $11::numeric, $12, $13::timestamptz, $14::jsonb,
               $8::timestamptz)`,
      [source, symbol, d, dir, at(d, "06:00"), at(d, "21:00"), entry, at(d, "06:10"), exit, at(d, "20:00"), move, outcome, at(d, "21:05"), meta]
    );
  await scored("axiom", "EURUSD", "2026-10-06", "down", "1.085000", "1.085800", "-8.00", "wrong", `{"source":"card"}`);
  await scored("axiom", "USDJPY", "2026-10-06", "up", "150.000000", "150.150000", "15.000000", "right", null);
  await scored("axiom", "XAUUSD", "2026-10-07", "up", "2650.000000", "2650.000001", "0.000001", "flat", `{"source":"backfill"}`);
  await scored("sentiment", "EURUSD", "2026-10-07", "up", "1.085000", "1.086000", "10.00", "right", null);
  await query(
    `insert into signal_calls (source, symbol, session_date, direction, entry_ts, exit_ts, meta, received_at)
     values ('axiom', 'US30', '2026-10-08', 'neutral', '2026-10-08T06:00:00Z', '2026-10-08T21:00:00Z',
             '{"source":"card"}', '2026-10-08T05:59:00Z')`
  );
});

const ALL = { source: "axiom", from: null, to: null };

test("move is the numeric's text at its stored scale, never a float", async () => {
  const rows = await lib.listSignalCalls(ALL);
  assert.deepEqual(
    rows.map((r) => r.move),
    ["-8.00", "15.000000", "0.000001", null]
  );
  for (const r of rows) assert.ok(r.move === null || typeof r.move === "string");
});

test("timestamps are Date objects, session_date is YYYY-MM-DD text", async () => {
  const [eur, , , us30] = await lib.listSignalCalls(ALL);
  for (const r of [eur, us30]) {
    assert.ok(r.entryTs instanceof Date && r.exitTs instanceof Date && r.receivedAt instanceof Date);
  }
  assert.equal(eur.sessionDate, "2026-10-06");
  assert.equal(eur.entryTs.toISOString(), "2026-10-06T06:00:00.000Z");
  assert.equal(eur.exitTs.toISOString(), "2026-10-06T21:00:00.000Z");
  assert.equal(eur.receivedAt.toISOString(), "2026-10-06T06:10:00.000Z");
  assert.ok(eur.entryPxAt instanceof Date);
  assert.equal(eur.entryPxAt.toISOString(), "2026-10-06T06:10:00.000Z");
  assert.equal(us30.entryPxAt, null);
  assert.equal(us30.receivedAt.toISOString(), "2026-10-08T05:59:00.000Z");
});

test("sender_label is meta->>'source', null without meta; the other columns pass through", async () => {
  const rows = await lib.listSignalCalls(ALL);
  assert.deepEqual(
    rows.map((r) => [r.symbol, r.direction, r.outcome, r.senderLabel]),
    [
      ["EURUSD", "down", "wrong", "card"],
      ["USDJPY", "up", "right", null],
      ["XAUUSD", "up", "flat", "backfill"],
      ["US30", "neutral", null, "card"],
    ]
  );
});

test("source and the inclusive date bounds filter", async () => {
  const pick = async (f: { source: string; from: string | null; to: string | null }) =>
    (await lib.listSignalCalls(f)).map((r) => `${r.sessionDate} ${r.symbol}`);
  assert.deepEqual(await pick({ source: "sentiment", from: null, to: null }), ["2026-10-07 EURUSD"]);
  assert.deepEqual(await pick({ source: "axiom", from: "2026-10-07", to: null }), ["2026-10-07 XAUUSD", "2026-10-08 US30"]);
  assert.deepEqual(await pick({ source: "axiom", from: null, to: "2026-10-07" }), [
    "2026-10-06 EURUSD",
    "2026-10-06 USDJPY",
    "2026-10-07 XAUUSD",
  ]);
  assert.deepEqual(await pick({ source: "axiom", from: "2026-10-07", to: "2026-10-07" }), ["2026-10-07 XAUUSD"]);
  assert.deepEqual(await pick({ source: "nova", from: null, to: null }), []);
});

test("parseSignalCallsFilter: defaults, and a bad value reads as the default / no bound", () => {
  assert.deepEqual(lib.parseSignalCallsFilter({}), { source: "axiom", from: null, to: null });
  assert.deepEqual(lib.parseSignalCallsFilter({ source: "sentiment", from: "2026-10-01", to: "2026-10-31" }), {
    source: "sentiment",
    from: "2026-10-01",
    to: "2026-10-31",
  });
  assert.deepEqual(lib.parseSignalCallsFilter({ source: "Axiom", from: "2026-02-30", to: "2026-10-1" }), {
    source: "axiom",
    from: null,
    to: null,
  });
  assert.deepEqual(lib.parseSignalCallsFilter({ source: "x", from: "2026-10-01'; drop", to: "" }), {
    source: "axiom",
    from: null,
    to: null,
  });
});
