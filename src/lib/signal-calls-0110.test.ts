/* Run: npx tsx --test src/lib/signal-calls-0110.test.ts
 *
 * Axiom signals dashboard S1: migration 0110 (signal_calls + its BEFORE UPDATE trigger) and 0110_rollback
 * (marcus m67349; plan docs/specs/axiom-signals-dashboard-plan.md sections 3 and 7 at S1; fable PASS WITH
 * CHANGES m67474 of S0.2 7eb9a73, D1-D3 + the S1 test additions). Pinned here:
 *  - every CHECK refuses its bad row, and each bad row breaks exactly one constraint, so the refusal names it;
 *  - each arm of signal_calls_entry_stamp (D1/Q9) and signal_calls_scored_stamp (D3) refuses on its own;
 *  - a neutral row is never priced or scored (fable N1 m67474);
 *  - one call per (source, symbol, entry_ts);
 *  - the trigger's three families (fable P2 m67410, G1/G2 m67417, D2/D3 m67474), the fill statement and the
 *    register-then-score statement pass, `set local signal_calls.allow_correction = 'on'` bypasses all three;
 *  - DELETE passes; the rollback refuses while rows exist, then drops the table, the function and the ledger row.
 * Real Postgres, no prod: the PGlite harness of consult-0105.test.ts (the REAL migration chain, same seeds). */
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
const DAY = 24 * 60 * 60 * 1000;

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
/** The trigger raised (plpgsql RAISE EXCEPTION, SQLSTATE P0001) with this message. */
const guarded = (p: Promise<unknown>, message: string) => refused(p, "P0001", message);

before(async () => {
  db = new PGlite();
  const files = readdirSync(MIGRATIONS).filter((f) => f.endsWith(".sql") && !f.includes("rollback")).sort();
  for (const f of files) {
    if (SKIPPED.has(f)) continue;
    if (SEEDS[f]) await db.exec(SEEDS[f]);
    await db.exec(readFileSync(path.join(MIGRATIONS, f), "utf8"));
  }
});

/** A fresh window per row (Axiom's: session_date 06:00Z -> 21:00Z), so the unique key never collides by accident. */
let seq = 0;
function nextDay() {
  return new Date(Date.UTC(2026, 0, 1) + ++seq * DAY).toISOString().slice(0, 10);
}
const ENTRY = (d: string) => ({ entry_px: "1.0850", entry_px_at: `${d}T06:10:00Z`, entry_bar_ts: `${d}T06:00:00Z` });
const SCORED = (d: string) => ({
  exit_px: "1.0900", exit_bar_ts: `${d}T20:00:00Z`, move: "50", outcome: "right", scored_at: `${d}T21:05:00Z`,
});

/** A signal_calls row: "bare" = registered with no price, "entry" = entry filled, "scored" = entry + scored form.
 * `cols` overrides (null clears a column). */
async function insertCall(shape: "bare" | "entry" | "scored", cols: Record<string, unknown> = {}) {
  const d = nextDay();
  const row: Record<string, unknown> = {
    source: "axiom", symbol: "EURUSD", direction: "up",
    session_date: d, entry_ts: `${d}T06:00:00Z`, exit_ts: `${d}T21:00:00Z`,
    ...(shape === "bare" ? {} : ENTRY(d)),
    ...(shape === "scored" ? SCORED(d) : {}),
    ...cols,
  };
  const keys = Object.keys(row);
  const r = await sql(
    `insert into signal_calls (${keys.join(", ")}) values (${keys.map((_, i) => `$${i + 1}`).join(", ")}) returning id`,
    keys.map((k) => row[k]),
  );
  return r.rows[0].id as string;
}
const update = (id: string, set: string, params: unknown[] = []) =>
  sql(`update signal_calls set ${set} where id = $1`, [id, ...params]);
const row = async (id: string) => (await sql(`select * from signal_calls where id = $1`, [id])).rows[0];

test("0110 applies on the real chain: table, trigger function, trigger and the ledger row", async () => {
  assert.notEqual((await sql(`select to_regclass('signal_calls') as r`)).rows[0].r, null);
  assert.notEqual((await sql(`select to_regprocedure('signal_calls_guard_update()') as r`)).rows[0].r, null);
  assert.equal((await sql(`select count(*)::int n from pg_trigger where tgname = 'signal_calls_guard'`)).rows[0].n, 1);
  assert.deepEqual((await sql(`select name from schema_migrations where version = '0110'`)).rows, [{ name: "0110_signal_calls.sql" }]);
});

test("good rows: a bare registration, an entry-filled call, a scored call per outcome, a neutral registration", async () => {
  await insertCall("bare");
  await insertCall("entry", { direction: "down" });
  for (const outcome of ["right", "wrong", "flat"]) await insertCall("scored", { outcome });
  await insertCall("scored", { direction: "down" });
  await insertCall("bare", { direction: "neutral", meta: JSON.stringify({ source: "card" }) });
  const r = await row(await insertCall("bare"));
  assert.ok(r.received_at instanceof Date, "received_at defaults to now()");
  assert.equal(r.meta, null, "meta is nullable with no default (plan section 3, G2)");
});

test("column CHECKs: direction, source and symbol format, outcome vocabulary, the window", async () => {
  await refused(insertCall("bare", { direction: "buy" }), "23514", "signal_calls_direction_check");
  await refused(insertCall("bare", { source: "Axiom" }), "23514", "signal_calls_source_check");
  await refused(insertCall("bare", { source: "a" }), "23514", "signal_calls_source_check");
  await refused(insertCall("bare", { symbol: "eur/usd" }), "23514", "signal_calls_symbol_check");
  await refused(insertCall("scored", { outcome: "hit" }), "23514", "signal_calls_outcome_check");
  await refused(insertCall("bare", { exit_ts: "2026-01-01T06:00:00Z", entry_ts: "2026-01-01T06:00:00Z" }), "23514", "signal_calls_window");
});

test("signal_calls_entry_stamp: entry_px, entry_px_at and entry_bar_ts are all null or all set (fable D1 + Q9 m67474)", async () => {
  await refused(insertCall("entry", { entry_px_at: null }), "23514", "signal_calls_entry_stamp");
  await refused(insertCall("entry", { entry_bar_ts: null }), "23514", "signal_calls_entry_stamp");
  await refused(insertCall("entry", { entry_px: null }), "23514", "signal_calls_entry_stamp");
  await refused(insertCall("bare", { entry_px_at: "2026-01-01T06:10:00Z" }), "23514", "signal_calls_entry_stamp");
  await refused(insertCall("bare", { entry_bar_ts: "2026-01-01T06:00:00Z" }), "23514", "signal_calls_entry_stamp");
  await refused(insertCall("bare", { entry_px: "1.0850" }), "23514", "signal_calls_entry_stamp");
});

test("signal_calls_scored_stamp: each arm on its own, exit_bar_ts included (fable D3 m67474)", async () => {
  for (const col of ["exit_px", "move", "scored_at", "exit_bar_ts"]) {
    await refused(insertCall("scored", { [col]: null }), "23514", "signal_calls_scored_stamp");
  }
  const d = "2026-01-01";
  for (const [col, v] of Object.entries(SCORED(d))) {
    if (col === "outcome") continue;
    await refused(insertCall("entry", { [col]: v }), "23514", "signal_calls_scored_stamp");
  }
  await refused(insertCall("scored", { entry_px: null, entry_px_at: null, entry_bar_ts: null }), "23514", "signal_calls_scored_stamp");
});

test("signal_calls_neutral_unscored: a neutral call carries no entry price and no scored form (fable N1 m67474)", async () => {
  await refused(insertCall("entry", { direction: "neutral" }), "23514", "signal_calls_neutral_unscored");
  await refused(insertCall("scored", { direction: "neutral" }), "23514", "signal_calls_neutral_unscored");
});

test("one call per (source, symbol, entry_ts); another symbol or source in the same window is a different call", async () => {
  const w = { session_date: "2025-06-02", entry_ts: "2025-06-02T06:00:00Z", exit_ts: "2025-06-02T21:00:00Z" };
  await insertCall("bare", { ...w, symbol: "GBPUSD" });
  await refused(insertCall("bare", { ...w, symbol: "GBPUSD", direction: "down" }), "23505", "signal_calls_one_per_window");
  await insertCall("bare", { ...w, symbol: "USDJPY" });
  await insertCall("bare", { ...w, symbol: "GBPUSD", source: "sentiment" });
});

test("trigger NEVER family: each column refused, scored or not; re-setting the same value passes", async () => {
  const bare = await insertCall("bare");
  const changes: [string, string][] = [
    ["source", `source = 'sentiment'`],
    ["symbol", `symbol = 'GBPUSD'`],
    ["entry_ts", `entry_ts = entry_ts - interval '1 hour'`],
    ["exit_ts", `exit_ts = exit_ts + interval '1 hour'`],
    ["session_date", `session_date = session_date + 1`],
    ["direction", `direction = 'down'`],
    ["received_at", `received_at = received_at - interval '1 day'`],
  ];
  for (const [col, set] of changes) await guarded(update(bare, set), `signal_calls: ${col} never changes`);
  const scored = await insertCall("scored");
  await guarded(update(scored, `direction = 'down'`), "signal_calls: direction never changes");
  await update(bare, `direction = direction, source = source, received_at = received_at`);
});

test("trigger FILL-ONLY family: the fill statement passes; once set, entry_px, entry_px_at, entry_bar_ts and meta never change", async () => {
  const id = await insertCall("bare");
  // fable m67474: the fill statement setting entry_px + entry_px_at + entry_bar_ts in one statement passes.
  await update(id, `entry_px = 1.0850, entry_px_at = now(), entry_bar_ts = entry_ts`);
  await update(id, `meta = $2`, [JSON.stringify({ source: "card" })]);
  // A numerically equal value is not a change.
  await update(id, `entry_px = 1.085`);
  const scored = await insertCall("scored", { meta: JSON.stringify({ source: "card" }) });
  for (const target of [id, scored]) {
    await guarded(update(target, `entry_px = 1.0851`), "signal_calls: entry_px is fill-only");
    await guarded(update(target, `entry_px_at = entry_px_at + interval '1 minute'`), "signal_calls: entry_px_at is fill-only");
    await guarded(update(target, `entry_bar_ts = entry_bar_ts + interval '1 hour'`), "signal_calls: entry_bar_ts is fill-only");
    await guarded(update(target, `meta = $2`, [JSON.stringify({ source: "backfill" })]), "signal_calls: meta is fill-only");
    await guarded(update(target, `meta = null`), "signal_calls: meta is fill-only");
  }
  await guarded(update(id, `entry_px = null, entry_px_at = null, entry_bar_ts = null`), "signal_calls: entry_px is fill-only");
  const r = await row(id);
  assert.equal(Number(r.entry_px), 1.085);
  assert.deepEqual(r.meta, { source: "card" });
});

test("trigger FROZEN-ONCE-SCORED family: register-then-score passes; then each scored column is frozen", async () => {
  const id = await insertCall("entry");
  await update(id, `exit_px = 1.0900, exit_bar_ts = exit_ts - interval '1 hour', move = 50, outcome = 'right', scored_at = now()`);
  const changes: [string, string][] = [
    ["exit_px", `exit_px = 1.0901`],
    ["exit_bar_ts", `exit_bar_ts = exit_bar_ts - interval '1 hour'`],
    ["move", `move = 51`],
    ["outcome", `outcome = 'wrong'`],
    ["scored_at", `scored_at = scored_at + interval '1 minute'`],
  ];
  for (const [, set] of changes) await guarded(update(id, set), "signal_calls: the scored form is frozen once scored");
  await guarded(
    update(id, `exit_px = null, exit_bar_ts = null, move = null, outcome = null, scored_at = null`),
    "signal_calls: the scored form is frozen once scored",
  );
  // updated_at is in no family.
  await update(id, `updated_at = now()`);
});

test("set local signal_calls.allow_correction = 'on' bypasses every family inside its transaction only; 'off' does not", async () => {
  const id = await insertCall("scored", { meta: JSON.stringify({ source: "card" }) });
  await db.exec(`
    begin;
    set local signal_calls.allow_correction = 'on';
    update signal_calls set direction = 'down', entry_px = 1.0800, meta = '{"source":"backfill"}',
      move = -100, outcome = 'wrong' where id = '${id}';
    commit;`);
  const r = await row(id);
  assert.deepEqual([r.direction, Number(r.entry_px), r.meta, Number(r.move), r.outcome], ["down", 1.08, { source: "backfill" }, -100, "wrong"]);
  await guarded(update(id, `direction = 'up'`), "signal_calls: direction never changes");
  await assert.rejects(
    db.exec(`begin; set local signal_calls.allow_correction = 'off'; update signal_calls set direction = 'up' where id = '${id}'; commit;`),
    /signal_calls: direction never changes/,
  );
  await db.exec("rollback");
  assert.equal((await row(id)).direction, "down");
});

test("DELETE is not blocked by the trigger", async () => {
  const id = await insertCall("scored");
  await sql(`delete from signal_calls where id = $1`, [id]);
  assert.equal(await row(id), undefined);
});

// Last: it runs DDL against the shared database.
test("0110_rollback refuses while signal_calls has rows, then drops the table, the trigger function and the ledger row", async () => {
  const rollback = readFileSync(path.join(MIGRATIONS, "0110_rollback.sql"), "utf8");
  assert.ok((await sql(`select 1 from signal_calls`)).rows.length > 0, "earlier tests left rows");
  await assert.rejects(db.exec(rollback), /0110 rollback: signal_calls has rows/);
  await db.exec("rollback");
  assert.equal((await sql(`select count(*)::int n from schema_migrations where version = '0110'`)).rows[0].n, 1);
  await sql(`delete from signal_calls`);
  await db.exec(rollback);
  assert.equal((await sql(`select to_regclass('signal_calls') as r`)).rows[0].r, null);
  assert.equal((await sql(`select to_regprocedure('signal_calls_guard_update()') as r`)).rows[0].r, null);
  assert.equal((await sql(`select count(*)::int n from schema_migrations where version = '0110'`)).rows[0].n, 0);
});
