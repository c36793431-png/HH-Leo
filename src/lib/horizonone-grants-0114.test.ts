/* Run: npx tsx --test src/lib/horizonone-grants-0114.test.ts
 *
 * Horizon One own-app plan, grants files (marcus BUILD GO m69582; fable m69580 S3): migration 0113
 * (horizonone_login_attempts, plain DDL) and 0114 (horizonone_app grants, 0104's shape), with both rollbacks.
 * Pinned here:
 *  - 0113 applies on the real chain: table, primary key on (key, window_start), the key and failures CHECKs, the
 *    ledger row;
 *  - 0114 on the real chain, role absent: nothing granted and NO ledger row (the replay every other harness does);
 *  - each 0114 guard skips with no ledger row and no grant: SUPERUSER, BYPASSRLS, and a wide membership;
 *  - applied: has_table_privilege / has_column_privilege per grant (the cutover S1 proof row, fable m69580 S3),
 *    and as the role itself the ingest insert, the fill/score update and the rate-limit statements pass while a
 *    DELETE on signal_calls, an UPDATE of a NEVER column and a SELECT on users are refused;
 *  - 0113_rollback refuses while 0114 is applied; 0114_rollback revokes every grant and the ledger row; then
 *    0113_rollback drops the table and its ledger row.
 * Real Postgres, no prod: the PGlite harness of signal-calls-0110.test.ts (the REAL migration chain, same seeds). */
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

/** 0114's two column lists, from src/lib/signal-ingest.ts :306-307 and :363-377. */
const INSERT_COLS = [
  "source", "symbol", "session_date", "direction", "entry_ts", "exit_ts", "entry_px", "entry_bar_ts", "entry_px_at",
  "exit_px", "exit_bar_ts", "move", "outcome", "scored_at", "meta",
];
const UPDATE_COLS = ["entry_px", "entry_bar_ts", "entry_px_at", "meta", "exit_px", "exit_bar_ts", "move", "outcome", "scored_at", "updated_at"];
const ROLE = "horizonone_app";
const KEY = "a".repeat(64);

/* eslint-disable @typescript-eslint/no-explicit-any */
let db: any;

async function sql(text: string, params: unknown[] = []) {
  const r = await db.query(text, params);
  return { rows: r.rows as any[], rowCount: (r.rows.length || r.affectedRows || 0) as number };
}
const migration = (f: string) => readFileSync(path.join(MIGRATIONS, f), "utf8");
const ledger = async (v: string) =>
  (await sql(`select count(*)::int n from schema_migrations where version = $1`, [v])).rows[0].n as number;
const tablePriv = async (table: string, priv: string) =>
  (await sql(`select has_table_privilege($1, $2, $3) p`, [ROLE, table, priv])).rows[0].p as boolean;
const colPriv = async (col: string, priv: string) =>
  (await sql(`select has_column_privilege($1, 'signal_calls', $2, $3) p`, [ROLE, col, priv])).rows[0].p as boolean;

/** Run `body` as horizonone_app, then reset, whatever happens. */
async function asRole<T>(body: () => Promise<T>): Promise<T> {
  await db.exec(`set role ${ROLE}`);
  try {
    return await body();
  } finally {
    await db.exec("reset role");
  }
}
async function permissionDenied(p: Promise<unknown>) {
  await assert.rejects(p, (e: any) => {
    assert.equal(e.code, "42501", `expected 42501, got ${e.code}: ${e.message}`);
    return true;
  });
}
/** Nothing granted and no ledger row: the shape of every 0114 skip. */
async function skipped(why: string) {
  assert.equal(await ledger("0114"), 0, `${why}: no ledger row`);
  assert.equal(await tablePriv("signal_calls", "SELECT"), false, `${why}: no SELECT on signal_calls`);
  assert.equal(await tablePriv("horizonone_login_attempts", "SELECT"), false, `${why}: no SELECT on login attempts`);
  assert.equal(await colPriv("entry_px", "UPDATE"), false, `${why}: no UPDATE (entry_px)`);
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

test("0113 applies on the real chain: table, primary key, CHECKs, ledger row", async () => {
  assert.notEqual((await sql(`select to_regclass('horizonone_login_attempts') r`)).rows[0].r, null);
  assert.deepEqual((await sql(`select name from schema_migrations where version = '0113'`)).rows, [{ name: "0113_horizonone_login_attempts.sql" }]);
  const pk = await sql(
    `select a.attname from pg_index i join pg_attribute a on a.attrelid = i.indrelid and a.attnum = any(i.indkey)
     where i.indrelid = 'horizonone_login_attempts'::regclass and i.indisprimary order by array_position(i.indkey, a.attnum)`,
  );
  assert.deepEqual(pk.rows.map((r) => r.attname), ["key", "window_start"]);

  const w = "2026-01-01T00:15:00Z";
  await sql(`insert into horizonone_login_attempts (key, window_start, failures) values ($1, $2, 1)`, [KEY, w]);
  await assert.rejects(sql(`insert into horizonone_login_attempts (key, window_start, failures) values ($1, $2, 1)`, [KEY, w]), /horizonone_login_attempts_pkey/);
  for (const bad of ["A".repeat(64), "a".repeat(63), "g".repeat(64)]) {
    await assert.rejects(sql(`insert into horizonone_login_attempts (key, window_start, failures) values ($1, $2, 1)`, [bad, w]), /horizonone_login_attempts_key_check/, bad);
  }
  await assert.rejects(sql(`insert into horizonone_login_attempts (key, window_start, failures) values ($1, now(), 0)`, ["b".repeat(64)]), /horizonone_login_attempts_failures_check/);
  await sql(`delete from horizonone_login_attempts`);
});

test("0114 on the real chain with no role: nothing granted, no ledger row", async () => {
  assert.equal((await sql(`select count(*)::int n from pg_roles where rolname = $1`, [ROLE])).rows[0].n, 0);
  assert.equal(await ledger("0114"), 0);
});

test("0114 guards: SUPERUSER, BYPASSRLS and a wide membership each skip with nothing granted", async () => {
  await db.exec(`create role ${ROLE} nologin`);
  await db.exec(`alter role ${ROLE} superuser`);
  await db.exec(migration("0114_horizonone_app_grants.sql"));
  await db.exec(`alter role ${ROLE} nosuperuser`);
  await skipped("SUPERUSER");

  await db.exec(`alter role ${ROLE} bypassrls`);
  await db.exec(migration("0114_horizonone_app_grants.sql"));
  await db.exec(`alter role ${ROLE} nobypassrls`);
  await skipped("BYPASSRLS");

  // Through another role, as 0104's guard 2 says (direct or through another role).
  await db.exec(`create role horizonone_wide nologin; grant pg_read_all_data to horizonone_wide; grant horizonone_wide to ${ROLE}`);
  await db.exec(migration("0114_horizonone_app_grants.sql"));
  await db.exec(`revoke horizonone_wide from ${ROLE}; drop role horizonone_wide`);
  await skipped("member of pg_read_all_data through another role");
});

test("0114 applied: the ledger row and one privilege row per grant (cutover S1 proof row)", async () => {
  await db.exec(migration("0114_horizonone_app_grants.sql"));
  assert.deepEqual((await sql(`select name from schema_migrations where version = '0114'`)).rows, [{ name: "0114_horizonone_app_grants.sql" }]);

  assert.equal(await tablePriv("signal_calls", "SELECT"), true);
  for (const priv of ["INSERT", "UPDATE", "DELETE", "TRUNCATE", "REFERENCES", "TRIGGER"]) {
    assert.equal(await tablePriv("signal_calls", priv), false, `no table-level ${priv} on signal_calls`);
  }
  const cols = (await sql(`select attname from pg_attribute where attrelid = 'signal_calls'::regclass and attnum > 0 and not attisdropped`)).rows.map((r) => r.attname as string);
  assert.equal(cols.length, 18, "signal_calls has 18 columns at 0110");
  for (const col of cols) {
    assert.equal(await colPriv(col, "INSERT"), INSERT_COLS.includes(col), `INSERT (${col})`);
    assert.equal(await colPriv(col, "UPDATE"), UPDATE_COLS.includes(col), `UPDATE (${col})`);
  }
  for (const priv of ["SELECT", "INSERT", "UPDATE", "DELETE"]) {
    assert.equal(await tablePriv("horizonone_login_attempts", priv), true, `${priv} on horizonone_login_attempts`);
  }
  for (const table of ["users", "user_roles", "schema_migrations", "licenses", "payments"]) {
    assert.equal(await tablePriv(table, "SELECT"), false, `no SELECT on ${table}`);
  }

  // A re-run is a no-op: the ledger row stays one row.
  await db.exec(migration("0114_horizonone_app_grants.sql"));
  assert.equal(await ledger("0114"), 1);
});

test("as horizonone_app: ingest and rate-limit statements pass; DELETE, a NEVER column and users are refused", async () => {
  const d = "2026-03-02";
  const id = await asRole(async () => {
    const r = await sql(
      `insert into signal_calls (source, symbol, session_date, direction, entry_ts, exit_ts, meta)
       values ('axiom', 'EURUSD', $1, 'up', $2, $3, '{"source":"card"}') returning id`,
      [d, `${d}T06:00:00Z`, `${d}T21:00:00Z`],
    );
    const rid = r.rows[0].id as string;
    await sql(`update signal_calls set entry_px = 1.085, entry_bar_ts = entry_ts, entry_px_at = now(), updated_at = now() where id = $1`, [rid]);
    await sql(
      `update signal_calls set exit_px = 1.09, exit_bar_ts = exit_ts - interval '1 hour', move = 50, outcome = 'right',
         scored_at = now(), updated_at = now() where id = $1`,
      [rid],
    );
    await sql(`select pg_advisory_xact_lock(1)`);

    await permissionDenied(sql(`delete from signal_calls where id = $1`, [rid]));
    await permissionDenied(sql(`update signal_calls set direction = 'down' where id = $1`, [rid]));
    await permissionDenied(sql(`update signal_calls set received_at = now() where id = $1`, [rid]));
    await permissionDenied(sql(`select id from users limit 1`));
    await permissionDenied(sql(`select version from schema_migrations limit 1`));

    await sql(
      `insert into horizonone_login_attempts (key, window_start, failures) values ($1, now(), 1)
       on conflict (key, window_start) do update set failures = horizonone_login_attempts.failures + 1`,
      [KEY],
    );
    await sql(`update horizonone_login_attempts set failures = failures + 1 where key = $1`, [KEY]);
    await sql(`delete from horizonone_login_attempts where window_start < now() - interval '24 hours'`);
    await sql(`delete from horizonone_login_attempts where key = $1`, [KEY]);
    return rid;
  });
  assert.equal((await sql(`select outcome from signal_calls where id = $1`, [id])).rows[0].outcome, "right");
});

// Last: it runs DDL against the shared database.
test("rollbacks: 0113 refuses while 0114 is applied; 0114 revokes every grant; then 0113 drops the table", async () => {
  await assert.rejects(db.exec(migration("0113_rollback.sql")), /0113 rollback: 0114 is applied/);
  await db.exec("rollback");
  assert.notEqual((await sql(`select to_regclass('horizonone_login_attempts') r`)).rows[0].r, null);

  await db.exec(migration("0114_rollback.sql"));
  assert.equal(await ledger("0114"), 0);
  for (const priv of ["SELECT", "INSERT", "UPDATE"]) assert.equal(await tablePriv("signal_calls", priv), false, `signal_calls ${priv}`);
  for (const col of [...INSERT_COLS, ...UPDATE_COLS]) {
    assert.equal(await colPriv(col, "INSERT"), false, `INSERT (${col}) revoked with the table-level REVOKE`);
    assert.equal(await colPriv(col, "UPDATE"), false, `UPDATE (${col}) revoked with the table-level REVOKE`);
  }
  for (const priv of ["SELECT", "INSERT", "UPDATE", "DELETE"]) {
    assert.equal(await tablePriv("horizonone_login_attempts", priv), false, `login attempts ${priv}`);
  }

  await db.exec(migration("0113_rollback.sql"));
  assert.equal((await sql(`select to_regclass('horizonone_login_attempts') r`)).rows[0].r, null);
  assert.equal(await ledger("0113"), 0);
});
