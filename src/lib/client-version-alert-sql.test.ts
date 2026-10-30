/* Run: npx tsx --test --experimental-test-module-mocks src/lib/client-version-alert-sql.test.ts
 *
 * The one query in client-version-alert.ts, run for real: PGlite with the REAL 0085_client_heartbeats.sql and the
 * real clientNumberSql from licenses.ts, over a minimal users table (only the columns that query reads). Downloads and
 * Telegram are mocked. This is what the mocked-pool tests in client-version-alert.test.ts cannot show: that the SQL
 * parses, groups and numbers clients the way /admin/users does (join order, internal/test accounts left out).
 */
import { test, before, beforeEach, mock } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { PGlite } from "@electric-sql/pglite";

/* eslint-disable @typescript-eslint/no-explicit-any */
let db: PGlite;
let sent: string[] = [];
let run: typeof import("./client-version-alert").runClientVersionAlert;

const NOW = new Date("2026-10-31T05:10:00Z");
const ago = (hours: number) => new Date(NOW.getTime() - hours * 3_600_000).toISOString();

before(async () => {
  db = new PGlite();
  await db.exec(`
    create table schema_migrations (version text primary key, name text);
    create table users (id uuid primary key default gen_random_uuid(), email text, display_name text, created_at timestamptz not null);
  `);
  await db.exec(readFileSync(path.join(process.cwd(), "db/migrations/0085_client_heartbeats.sql"), "utf8"));
  const sql = async (text: string, params?: unknown[]) => {
    const r = await db.query(text, params as any[]);
    return { rows: r.rows as any[], rowCount: r.rows.length || (r as any).affectedRows || 0 };
  };
  (globalThis as any)._pgPool = { query: sql, connect: async () => ({ query: sql, release() {} }), end: async () => {} };
  Object.assign(process.env, { NEON_DATABASE_URL: "postgres://unused" });
  mock.module("@/lib/downloads", { namedExports: { getLatestDownloads: async () => ({ windows: { version: "2.2" } }) } });
  mock.module("@/lib/telemetry-sink", {
    namedExports: { notifyOldClientVersions: async (t: string) => (sent.push(t), true) },
  });
  console.error = () => {};
  ({ runClientVersionAlert: run } = await import("./client-version-alert"));
});

beforeEach(async () => {
  sent = [];
  await db.exec("truncate client_heartbeats; truncate users cascade;");
});

async function user(email: string | null, name: string | null, createdAt: string): Promise<string> {
  const r = await db.query("insert into users (email, display_name, created_at) values ($1, $2, $3) returning id", [email, name, createdAt]);
  return (r.rows[0] as any).id;
}
async function beat(userId: string | null, lk: string, hwid: string, version: string | null, lastSeen: string) {
  await db.query(
    "insert into client_heartbeats (license_key, hwid, license_id, user_id, client_version, last_seen) values ($1, $2, gen_random_uuid(), $3, $4, $5)",
    [lk, hwid, userId, version, lastSeen]
  );
}

test("client numbers follow signup order minus internal/test accounts, exactly like /admin/users", async () => {
  await user("ops@horizonhft.internal", "Ops", "2026-01-01T00:00:00Z"); // internal: no number, not a client
  const a = await user("a@example.com", "Ann A", "2026-02-01T00:00:00Z"); // Client #1
  await user("tester@example.com", "T", "2026-02-15T00:00:00Z"); // '%test%': no number
  const b = await user(null, "Tg Only", "2026-03-01T00:00:00Z"); // Telegram-only (NULL email) is still a client: #2
  const c = await user("c@example.com", "Cy C", "2026-04-01T00:00:00Z"); // #3
  const internal = (await db.query("select id from users where email like '%horizonhft.internal'")).rows[0] as any;
  await beat(a, "LK-A", "HW-A1", "2.0.9", ago(3));
  await beat(a, "LK-A", "HW-A2", "2.0.9", ago(1)); // second machine, same build: one line
  await beat(b, "LK-B", "HW-B", "2.2", ago(2)); // current
  await beat(c, "LK-C", "HW-C", "2.1", ago(30));
  await beat(internal.id, "LK-I", "HW-I", "1.0", ago(1)); // internal: left out
  const res = await run(NOW);
  assert.equal(res.sent, true);
  assert.equal(res.reason, "old_versions");
  assert.equal(sent.length, 1);
  const lines = sent[0].split("\n");
  assert.equal(lines[0], "Old Horizon versions (latest 2.2, seen in the last 7 days)");
  assert.equal(lines[1], `• Client #1 Ann A, 2.0.9, last seen ${ago(1).slice(5, 10)} ${ago(1).slice(11, 16)}Z`);
  assert.equal(lines[2], `• Client #3 Cy C, 2.1, last seen ${ago(30).slice(5, 10)} ${ago(30).slice(11, 16)}Z`);
  assert.ok(lines.includes("2 of 3 active clients are behind. Not seen in 7 days: 0 (not listed)."), sent[0]);
  assert.ok(!/LK-|HW-/.test(sent[0]), "no licence key or hwid in the message");
});

test("a table whose newest row is older than 36h sends the dead-man line, whatever the rows say", async () => {
  const a = await user("a@example.com", "Ann A", "2026-02-01T00:00:00Z");
  await beat(a, "LK-A", "HW-A", "2.0.8", "2026-10-18T03:59:12Z");
  const res = await run(NOW);
  assert.equal(res.reason, "stale");
  assert.equal(sent[0].split("\n")[0], "Heartbeats stale since 10-18 03:59Z; version list unreliable.");
});

test("an empty table sends the dead-man line; a current table sends nothing", async () => {
  assert.equal((await run(NOW)).reason, "stale");
  assert.ok(sent[0].startsWith("No heartbeats recorded at all; version list unreliable."));
  sent = [];
  const a = await user("a@example.com", "Ann A", "2026-02-01T00:00:00Z");
  await beat(a, "LK-A", "HW-A", "2.2", ago(1));
  assert.deepEqual(await run(NOW), { sent: false, reason: "all_current" });
  assert.deepEqual(sent, []);
});
