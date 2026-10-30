/* Run: npx tsx --test --experimental-test-module-mocks src/lib/client-version-alert.test.ts
 *
 * The daily old-client-version note (marcus m80072, 2026-10-30). Fixtures are the shapes seen in client_heartbeats on
 * 2026-10-30: "2.0.9"-style client strings against "2.2"-style download versions, and the oddballs "V2.02", "2",
 * "2.0.7-dev". The pure planner is tested directly; the route is tested with the DB, downloads and Telegram mocked.
 * Nothing here touches Postgres or Telegram.
 */
import { test, before, beforeEach, mock } from "node:test";
import assert from "node:assert/strict";
import type { HeartbeatVersionRow } from "./client-version-alert";

// Loaded in before(), AFTER mock.module: a static import would pull in the real db / downloads / telemetry-sink.
let compareParts: typeof import("./client-version-alert").compareParts;
let parseVersion: typeof import("./client-version-alert").parseVersion;
let planAlert: typeof import("./client-version-alert").planAlert;

const NOW = new Date("2026-10-31T05:10:00Z");
const hoursAgo = (h: number) => new Date(NOW.getTime() - h * 3_600_000);
const daysAgo = (d: number) => hoursAgo(d * 24);

function row(over: Partial<HeartbeatVersionRow> & { n?: number | null }): HeartbeatVersionRow {
  const { n, ...rest } = over;
  const clientNumber = n === undefined ? 1 : n;
  return {
    userId: clientNumber === null ? "u-internal" : `u-${clientNumber}`,
    licenseId: `${String(clientNumber).padStart(8, "0")}-aaaa-bbbb-cccc-dddddddddddd`,
    clientVersion: "2.2",
    lastSeen: hoursAgo(2),
    displayName: null,
    clientNumber,
    ...rest,
  };
}

const plan = (rows: HeartbeatVersionRow[], over: { newest?: Date | null; latest?: string | null } = {}) =>
  planAlert({
    rows,
    newestLastSeen: over.newest === undefined ? hoursAgo(1) : over.newest,
    latestVersion: over.latest === undefined ? "2.2" : over.latest,
    now: NOW,
  });

test("1: parseVersion: releases compare as dotted numbers; anything else is never a release", () => {
  const parts = (v: string) => {
    const p = parseVersion(v);
    assert.equal(p.kind, "release", v);
    return (p as { parts: number[] }).parts;
  };
  assert.deepEqual(parts("2.2"), [2, 2]);
  assert.deepEqual(parts("2.0.9"), [2, 0, 9]);
  assert.deepEqual(parts("V2.2"), [2, 2]);
  assert.deepEqual(parts(" v2.1 "), [2, 1]);
  assert.equal(parseVersion("2.0.7-dev").kind, "dev");
  assert.equal(parseVersion("V2.02").kind, "unrecognised", "leading zero: 2.0.2 or 2.2, not guessed");
  assert.equal(parseVersion("2").kind, "unrecognised", "a bare major is not a shipped build string");
  for (const bad of ["", "   ", null, undefined, "2.2 beta", "2.x", "latest", "2..2", "2.2.", "99999999999999999999.1"]) {
    assert.equal(parseVersion(bad as string).kind, "unrecognised", String(bad));
  }
});

test("2: compareParts: 2.0.10 > 2.0.9, 2.2 = 2.2.0, 2.1 < 2.2 (string order would get the first wrong)", () => {
  assert.equal(compareParts([2, 0, 10], [2, 0, 9]), 1);
  assert.equal(compareParts([2, 2], [2, 2, 0]), 0);
  assert.equal(compareParts([2, 1], [2, 2]), -1);
  assert.equal(compareParts([2, 0, 9], [2, 2]), -1);
});

test("3: lists clients behind the latest, with Client #N, name, version and last seen; counts the rest", () => {
  const p = plan([
    row({ n: 12, displayName: "Jane D", clientVersion: "2.0.8", lastSeen: new Date("2026-10-28T14:02:00Z") }),
    row({ n: 31, clientVersion: "2.0.7", lastSeen: new Date("2026-10-29T09:40:00Z") }),
    row({ n: 5, clientVersion: "2.2" }),
    row({ n: 6, clientVersion: "2.1.0", lastSeen: daysAgo(9) }), // old AND not seen in 7 days: counted there, not listed
  ]);
  assert.equal(p.send, true);
  assert.equal(p.reason, "old_versions");
  if (p.reason !== "old_versions") return;
  assert.equal(p.behind, 2);
  assert.equal(p.active, 3);
  const lines = p.text.split("\n");
  assert.equal(lines[0], "Old Horizon versions (latest 2.2, seen in the last 7 days)");
  assert.equal(lines[1], "• Client #12 Jane D, 2.0.8, last seen 10-28 14:02Z");
  assert.equal(lines[2], "• Client #31, 2.0.7, last seen 10-29 09:40Z");
  assert.ok(lines.includes("2 of 3 active clients are behind. Not seen in 7 days: 1 (not listed)."), p.text);
  assert.ok(p.text.includes("trading tab running"), "footer: only clients with a tab running are counted");
  assert.ok(!p.text.includes("Client #6"), "a client not seen in 7 days is counted, never listed");
  assert.ok(!p.text.includes("Client #5"), "a current client is not listed");
});

test("4: an older-numbered but newer-than-latest build is not old; 2.0.10 is newer than 2.0.9", () => {
  const p = plan([row({ n: 1, clientVersion: "2.3" }), row({ n: 2, clientVersion: "2.0.10" })], { latest: "2.0.9" });
  assert.deepEqual(p, { send: false, reason: "all_current" });
});

test("5: dev and unrecognised versions are listed separately and never called old", () => {
  const p = plan([
    row({ n: 2, clientVersion: "2.0.7-dev" }),
    row({ n: 3, clientVersion: "V2.02" }),
    row({ n: 4, clientVersion: "2" }),
    row({ n: 5, clientVersion: null }),
    row({ n: 6, clientVersion: "2.0.8" }),
  ]);
  assert.equal(p.send, true);
  if (!p.send) return;
  const [head, ...rest] = p.text.split("\n");
  assert.equal(head, "Old Horizon versions (latest 2.2, seen in the last 7 days)");
  const split = rest.indexOf("Not compared (dev or unrecognised version strings):");
  assert.ok(split > 0, p.text);
  const oldPart = rest.slice(0, split).join("\n");
  const otherPart = rest.slice(split).join("\n");
  assert.ok(oldPart.includes("Client #6, 2.0.8"));
  for (const n of [2, 3, 4, 5]) assert.ok(!oldPart.includes(`Client #${n}`), `#${n} is not called old`);
  assert.ok(otherPart.includes("Client #2, 2.0.7-dev (dev build)"));
  assert.ok(otherPart.includes("Client #3, V2.02 (unrecognised)"));
  assert.ok(otherPart.includes("Client #5, none reported (unrecognised)"));
});

test("6: internal/test accounts (no client number) are not clients; a licence with no user is listed as such", () => {
  const p = plan([
    row({ n: null, clientVersion: "1.0" }),
    row({ n: null, userId: null, licenseId: "abcdef12-1111-2222-3333-444444444444", clientVersion: "2.0.1" }),
  ]);
  assert.equal(p.send, true);
  if (!p.send) return;
  assert.ok(p.text.includes("• Unlinked licence abcdef12, 2.0.1"), p.text);
  assert.ok(!p.text.includes("u-internal") && !p.text.includes("1.0,"), "the internal account is left out");
  assert.ok(p.text.includes("1 of 1 active clients are behind"));
});

test("7: two machines or licences of one client on the same build are one line, newest last seen", () => {
  const p = plan([
    row({ n: 9, clientVersion: "2.0.9", lastSeen: hoursAgo(30), licenseId: "l1" }),
    row({ n: 9, clientVersion: "2.0.9", lastSeen: hoursAgo(5), licenseId: "l2" }),
    row({ n: 9, clientVersion: "2.1", lastSeen: hoursAgo(4), licenseId: "l1" }),
  ]);
  assert.equal(p.send, true);
  if (!p.send) return;
  const bullets = p.text.split("\n").filter((l) => l.startsWith("• "));
  assert.equal(bullets.length, 2, p.text);
  assert.ok(bullets[0].includes("2.0.9") && bullets[0].includes("10-31 00:10Z"), bullets[0]);
  assert.ok(p.text.includes("1 of 1 active clients are behind"), "one client, not one per row");
});

test("8: everyone current -> nothing is sent", () => {
  assert.deepEqual(plan([row({ n: 1 }), row({ n: 2, clientVersion: "2.2.0" })]), { send: false, reason: "all_current" });
});

test("9: DEAD-MAN: newest last_seen in the table older than 36h -> 'Heartbeats stale since <date>; version list unreliable.'", () => {
  // The 2026-10-30 state: newest row 10-18 03:59:12Z, and every row is outside the 7-day window.
  const stale = new Date("2026-10-18T03:59:12Z");
  const p = plan([row({ n: 1, clientVersion: "2.0.8", lastSeen: stale })], { newest: stale });
  assert.equal(p.send, true);
  assert.equal(p.reason, "stale");
  if (!p.send) return;
  assert.ok(p.text.startsWith("Heartbeats stale since 10-18 03:59Z; version list unreliable."), p.text);
  assert.ok(!p.text.includes("Client #"), "no list when the pipe is stale");
  // Even with old-looking rows inside the 7-day window, a stale pipe wins: the list would be a stale picture.
  const p2 = plan([row({ n: 2, clientVersion: "2.0.1", lastSeen: daysAgo(2) })], { newest: daysAgo(2) });
  assert.equal(p2.send && p2.reason, "stale");
});

test("10: DEAD-MAN boundary: 35h59m is fine, 36h01m is stale; an empty table is stale", () => {
  const rows = [row({ n: 1, clientVersion: "2.0.8" })];
  assert.equal(plan(rows, { newest: new Date(NOW.getTime() - (36 * 60 - 1) * 60_000) }).reason, "old_versions");
  assert.equal(plan(rows, { newest: new Date(NOW.getTime() - (36 * 60 + 1) * 60_000) }).reason, "stale");
  const empty = plan([], { newest: null });
  assert.equal(empty.send && empty.reason, "stale");
  assert.ok(empty.send && empty.text.startsWith("No heartbeats recorded at all; version list unreliable."));
});

test("11: no comparable published release -> say the check was skipped instead of staying silent", () => {
  for (const latest of [null, "", "nightly"]) {
    const p = plan([row({ n: 1, clientVersion: "2.0.8" })], { latest });
    assert.equal(p.send && p.reason, "check_skipped", String(latest));
  }
});

test("12: the text carries no licence key, hwid or IP, and user-controlled strings are flattened and capped", () => {
  const p = plan([
    row({
      n: 1,
      displayName: "Eve\nINJECTED LINE " + "x".repeat(100),
      clientVersion: "2.0.1",
      licenseId: "KEYSHOULDNEVERAPPEAR-0000-0000-0000-000000000000",
    }),
    row({ n: 2, clientVersion: "9.9.9-evil\nline two " + "y".repeat(100) }),
  ]);
  assert.equal(p.send, true);
  if (!p.send) return;
  assert.ok(!p.text.includes("KEYSHOULDNEVERAPPEAR"));
  assert.ok(!/\nINJECTED LINE/.test(p.text) && !/\nline two/.test(p.text), "newlines in client strings cannot start a new line");
  assert.ok(p.text.split("\n").every((l) => l.length < 200), "every line is capped");
});

// ---- the route: DB, downloads and Telegram mocked ----

let dbRows: Record<string, unknown>[] = [];
let latestDownloads: Record<string, { version: string }> = {};
let sent: string[] = [];
let sendOk = true;

/* eslint-disable @typescript-eslint/no-explicit-any */
before(async () => {
  Object.assign(process.env, { CRON_SECRET: "cron-secret", NEON_DATABASE_URL: "postgres://unused" });
  mock.module("@/lib/db", { namedExports: { pool: { query: async () => ({ rows: dbRows }) } } });
  mock.module("@/lib/downloads", { namedExports: { getLatestDownloads: async () => latestDownloads } });
  mock.module("@/lib/licenses", { namedExports: { clientNumberSql: () => "0" } });
  mock.module("@/lib/telemetry-sink", {
    namedExports: {
      notifyOldClientVersions: async (text: string) => {
        sent.push(text);
        return sendOk;
      },
    },
  });
  console.error = () => {};
  ({ compareParts, parseVersion, planAlert } = await import("./client-version-alert"));
});

beforeEach(() => {
  dbRows = [];
  latestDownloads = { windows: { version: "2.1" }, macos: { version: "2.2" } };
  sent = [];
  sendOk = true;
});

const dbRow = (n: number, v: string, lastSeen: Date) => ({
  user_id: `u-${n}`,
  license_id: `l-${n}`,
  client_version: v,
  last_seen: lastSeen,
  display_name: `Name ${n}`,
  client_number: String(n), // pg returns count(*) as a string
});

async function call(auth = "Bearer cron-secret") {
  const route = await import("../app/api/cron/client-version-alert/route");
  return route.GET(new Request("https://portal.horizonhft.com/api/cron/client-version-alert", { headers: { authorization: auth } }) as any);
}

test("13: route refuses a caller without the cron secret and sends nothing", async () => {
  assert.equal((await call("Bearer nope")).status, 401);
  assert.deepEqual(sent, []);
});

test("14: route compares against the highest published version across platforms and sends one message", async () => {
  const now = Date.now();
  dbRows = [dbRow(12, "2.1", new Date(now - 3_600_000)), dbRow(13, "2.2", new Date(now - 3_600_000))];
  const res = await call();
  assert.equal(res.status, 200);
  assert.deepEqual(await res.json(), { sent: true, reason: "old_versions", behind: 1, active: 2 });
  assert.equal(sent.length, 1);
  assert.ok(sent[0].includes("(latest 2.2,") && sent[0].includes("Client #12 Name 12, 2.1"), sent[0]);
});

test("15: route: stale table -> the dead-man message goes out, not an all-clear", async () => {
  dbRows = [dbRow(1, "2.0.8", new Date("2026-10-18T03:59:12Z"))];
  const res = await call();
  assert.equal((await res.json()).reason, "stale");
  assert.equal(sent.length, 1);
  assert.ok(sent[0].startsWith("Heartbeats stale since 10-18 03:59Z; version list unreliable."));
});

test("16: route: everyone current -> 200, nothing sent; a failed send -> 502 so the cron run shows as failed", async () => {
  dbRows = [dbRow(1, "2.2", new Date(Date.now() - 3_600_000))];
  const ok = await call();
  assert.equal(ok.status, 200);
  assert.deepEqual(await ok.json(), { sent: false, reason: "all_current" });
  assert.deepEqual(sent, []);

  dbRows = [dbRow(1, "2.0.8", new Date(Date.now() - 3_600_000))];
  sendOk = false;
  assert.equal((await call()).status, 502);
});
