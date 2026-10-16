/* Run: npx tsx --test --experimental-test-module-mocks src/lib/feed-box-events.test.tsx
 *
 * Feed-box EVENTS: POST /api/feed-box/events, migration 0115, the /admin/feed-health events block, the provider box
 * scope and the provider page /feed/dashboard/health that reads it (S2, BUILD GO m70609). Plan m70008-10; rulings
 * marcus m70015 (Q1-Q7) + m70036 (databento_error); Fable PASS WITH STRIKES m70029 (S1 non-empty tier set, S2 bounded
 * open cut; notes N1-N7); BUILD GO m70031.
 * PGlite with the REAL migration chain through db.ts's global._pgPool seam (the feed-status.test.tsx harness), no prod. */
import { test, before, beforeEach, mock } from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { generateKeyPairSync } from "node:crypto";
import { renderToStaticMarkup } from "react-dom/server";
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
  mock.module("@/lib/auth", { namedExports: { auth: async () => session } });
});

/** The provider page reads session.user.id; the layout has already admitted only feed_provider accounts. */
let session: { user: { id: string; role: string } } | null = null;
const signInAs = (id: string) => (session = { user: { id, role: "feed_provider" } });

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

async function postEvents(token: string, body: unknown, opts: { contentType?: string; raw?: string; length?: string } = {}) {
  const route = await import("../app/api/feed-box/events/route");
  const headers: Record<string, string> = { authorization: `Bearer ${token}`, "content-type": opts.contentType ?? "application/json" };
  if (opts.length) headers["content-length"] = opts.length;
  const res = await route.POST(
    new Request("https://portal.horizonhft.com/api/feed-box/events", { method: "POST", headers, body: opts.raw ?? JSON.stringify(body) }) as any
  );
  return { status: res.status, body: (await res.json()) as any };
}

async function postStatus(token: string, body: unknown) {
  const route = await import("../app/api/feed-box/status/route");
  const res = await route.POST(
    new Request("https://portal.horizonhft.com/api/feed-box/status", {
      method: "POST",
      headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
      body: JSON.stringify(body),
    }) as any
  );
  return { status: res.status, body: (await res.json()) as any };
}

const iso = (msAgo: number) => new Date(Date.now() - msAgo).toISOString();
const MIN = 60_000;
const ev = (kind: string, msAgo: number, over: Record<string, unknown> = {}) => ({ ts: iso(msAgo), kind, ...over });
const rows = async (boxId: string) =>
  (await sql(`select ts, kind, duration_s, detail, received_at from feed_box_events where box_id = $1 order by ts, kind`, [boxId])).rows;

// First, while the chain has no box: the empty state (Fable m70234 N4).
test("N4: /admin/feed-health with no box says status OR events; it no longer reads as status-only", async () => {
  const { default: Page } = await import("../app/admin/feed-health/page");
  assert.equal(Number((await sql(`select count(*) as n from feed_boxes`)).rows[0].n), 0, "precondition: no box yet");
  const page = renderToStaticMarkup(await Page());
  assert.match(page, /data-feed-health-empty="">No box reports feed status or events yet\. A box shows here once it has status tiers \(set them on Feed boxes\) or its bridge sends an event\.</);
  assert.ok(!/No box reports feed status yet\./.test(page));
});

// ---------- the route: auth and body gates ----------

test("route: preview 404, bad token 401, wrong content-type 415, over 16 KB 413, bad JSON 400, box name mismatch 400; nothing written", async () => {
  const box = await newBox([T["cme-ctrader-fix"]], [T["cme-ctrader-fix"]]);
  const ok = { box: box.name, events: [ev("databento_silent", MIN, { duration_s: 131 })] };
  assert.equal((await postEvents("z".repeat(43), ok)).status, 401);
  assert.equal((await postEvents(box.token, ok, { contentType: "text/plain" })).status, 415);
  assert.equal((await postEvents(box.token, ok, { length: "20000" })).status, 413);
  assert.equal((await postEvents(box.token, null, { raw: JSON.stringify({ ...ok, pad: "x".repeat(17_000) }) })).status, 413, "bytes read, not only the header");
  assert.equal((await postEvents(box.token, null, { raw: "{not json" })).status, 400);
  const wrong = await postEvents(box.token, { ...ok, box: "tommy4" });
  assert.equal(wrong.status, 400);
  assert.match(wrong.body.error, /box/);
  process.env.VERCEL_ENV = "preview";
  assert.equal((await postEvents(box.token, ok)).status, 404, "a preview shares the prod DB: it must never take an event");
  assert.equal((await rows(box.id)).length, 0, "nothing written");
});

test("N3: 100 compact events with a 32-char detail fit in 16 KB; 101 events are a 400", async () => {
  const box = await newBox([T["cme-ctrader-fix"]], []);
  const hundred = Array.from({ length: 100 }, (_, i) => ev("client_reject", (i + 1) * 1000, { detail: "a".repeat(32) }));
  const body = { box: box.name, events: hundred };
  assert.ok(Buffer.byteLength(JSON.stringify(body)) < 16 * 1024);
  const r = await postEvents(box.token, body);
  assert.equal(r.status, 200, JSON.stringify(r.body));
  assert.equal(r.body.stored, 100);
  const over = await postEvents(box.token, { box: box.name, events: [...hundred, ev("client_reject", 200_000)] });
  assert.equal(over.status, 400);
});

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

// ---------- the write (E2 dedup + open/close, E4 retention, N5 ignored) ----------

test("E2: a replay is a duplicate; an open cut closes once; a closed cut is never re-timed or reopened; the close keeps detail + received_at (N4)", async () => {
  const box = await newBox([T["cme-ctrader-fix"]], []);
  const ts = iso(10 * MIN);
  const open = await postEvents(box.token, { box: box.name, events: [{ ts, kind: "databento_silent", duration_s: null, detail: "after_error" }, ev("client_reject", 9 * MIN, { detail: "ip_not_allowlisted" })] });
  assert.equal(open.status, 200, JSON.stringify(open.body));
  assert.deepEqual([open.body.stored, open.body.closed, open.body.duplicate], [2, 0, 0]);
  const before = (await rows(box.id)).find((r: any) => r.kind === "databento_silent");
  assert.equal(before.duration_s, null);

  const replay = await postEvents(box.token, { box: box.name, events: [{ ts, kind: "databento_silent" }] });
  assert.deepEqual([replay.body.stored, replay.body.closed, replay.body.duplicate], [0, 0, 1], "an open re-sent is a duplicate");

  const close = await postEvents(box.token, { box: box.name, events: [{ ts, kind: "databento_silent", duration_s: 131, detail: "other" }] });
  assert.deepEqual([close.body.stored, close.body.closed, close.body.duplicate], [0, 1, 0]);
  const after = (await rows(box.id)).find((r: any) => r.kind === "databento_silent");
  assert.equal(after.duration_s, 131);
  assert.equal(after.detail, "after_error", "N4: the close's detail is not taken");
  assert.equal(new Date(after.received_at).getTime(), new Date(before.received_at).getTime(), "N4: received_at is the open row's");

  const retime = await postEvents(box.token, { box: box.name, events: [{ ts, kind: "databento_silent", duration_s: 999 }] });
  const reopen = await postEvents(box.token, { box: box.name, events: [{ ts, kind: "databento_silent", duration_s: null }] });
  assert.deepEqual([retime.body.duplicate, reopen.body.duplicate], [1, 1]);
  assert.equal((await rows(box.id)).find((r: any) => r.kind === "databento_silent").duration_s, 131, "still 131");
  assert.equal((await rows(box.id)).length, 2);
});

test("E2: open + close in ONE POST = one row with the duration, whichever order; send-once-at-end also works", async () => {
  const box = await newBox([T["cme-ctrader-fix"]], []);
  const ts = iso(5 * MIN);
  const r = await postEvents(box.token, { box: box.name, events: [{ ts, kind: "databento_silent", duration_s: 120 }, { ts, kind: "databento_silent" }] });
  // Sorted by (ts, kind) the two are equal keys: whichever goes first is stored, the other closes or duplicates.
  assert.equal(r.body.stored, 1);
  assert.equal((await rows(box.id))[0].duration_s, 120);
  const once = await postEvents(box.token, { box: box.name, events: [ev("databento_silent", 3 * MIN, { duration_s: 141 })] });
  assert.deepEqual([once.body.stored, once.body.closed], [1, 0]);
});

test("E4: the write deletes the box's rows older than 30 d (only that box's); the read filters them too", async () => {
  const { loadBoxEvents } = await import("./feed-box-events");
  const a = await newBox([T["cme-ctrader-fix"]], []);
  const b = await newBox([T["cme-ctrader-fix"]], []);
  const hand = (boxId: string, interval: string, kind: string) =>
    sql(`insert into feed_box_events (box_id, ts, kind) values ($1, now() - interval '${interval}', $2)`, [boxId, kind]);
  await hand(a.id, "31 days", "bridge_start");
  await hand(a.id, "29 days", "bridge_stop");
  await hand(b.id, "31 days", "bridge_start");
  const r = await postEvents(a.token, { box: a.name, events: [ev("reconnect_ok", MIN)] });
  assert.equal(r.status, 200);
  assert.deepEqual((await rows(a.id)).map((x: any) => x.kind), ["bridge_stop", "reconnect_ok"]);
  assert.equal((await rows(b.id)).length, 1, "another box's old row waits for that box's own write");
  const read = await loadBoxEvents([b.id]);
  assert.deepEqual(read.get(b.id)!.events, [], "but it is never read");
});

test("N1: the read is capped per box at READ_CAP per group; a reject flood can't push an open cut out; the newest 50 stay exact", async () => {
  const { loadBoxEvents, resolveEvents, summarize24h, READ_CAP } = await import("./feed-box-events");
  const box = await newBox([T["cme-ctrader-fix"]], []);
  await sql(`insert into feed_box_events (box_id, ts, kind) values ($1, now() - interval '3 hours', 'databento_silent')`, [box.id]);
  // 2500 rejects, one a second, all after the cut.
  await sql(
    `insert into feed_box_events (box_id, ts, kind, detail)
     select $1, now() - interval '2 hours' + make_interval(secs => i), 'client_reject', 'ip_not_allowlisted' from generate_series(1, 2500) i`,
    [box.id]
  );
  const now = new Date();
  const got = (await loadBoxEvents([box.id], now)).get(box.id)!;
  assert.equal(got.events.filter((e) => e.kind === "client_reject").length, READ_CAP);
  assert.equal(got.events.length, READ_CAP + 1, "the cut is read as well");
  assert.equal(got.truncatedBefore, null, "only the client group hit the cap");
  const newest = (await sql(`select ts from feed_box_events where box_id = $1 order by ts desc limit 50`, [box.id])).rows.map((r: any) => new Date(r.ts).getTime());
  assert.deepEqual(got.events.slice(0, 50).map((e) => e.ts.getTime()), newest);
  const s = summarize24h(resolveEvents(got.events, { latestUpTickAt: null }, now), now, got.truncatedBefore);
  assert.ok(s.open, "still dark now under 2500 rejects");
  assert.deepEqual([s.cuts, s.partial], [1, false]);
});

test("N1: a non-client flood past READ_CAP inside 24 h marks the 24 h line a floor, on the page too", async () => {
  const { default: Page } = await import("../app/admin/feed-health/page");
  const { loadBoxEvents, summarize24h, resolveEvents, READ_CAP } = await import("./feed-box-events");
  const box = await newBox([T["cme-ctrader-fix"]], []);
  await sql(
    `insert into feed_box_events (box_id, ts, kind, detail)
     select $1, now() - make_interval(secs => i * 10), 'databento_error', 'gateway' from generate_series(1, ${READ_CAP + 1}) i`,
    [box.id]
  );
  const now = new Date();
  const got = (await loadBoxEvents([box.id], now)).get(box.id)!;
  assert.equal(got.events.length, READ_CAP);
  assert.equal(got.truncatedBefore!.getTime(), got.events[READ_CAP - 1].ts.getTime(), "the oldest row read");
  const s = summarize24h(resolveEvents(got.events, { latestUpTickAt: null }, now), now, got.truncatedBefore);
  assert.deepEqual([s.errors, s.partial], [READ_CAP, true]);
  assert.equal(summarize24h([], now, new Date(now.getTime() - 25 * 60 * MIN)).partial, false, "a cap that bit before the 24 h window leaves the line whole");
  const page = renderToStaticMarkup(await Page());
  const start = page.indexOf(`data-box="${box.name}"`);
  assert.match(page.slice(start, page.indexOf("</section>", start)), /2000 Databento errors · counted from the newest 2,000 events only, so at least this many/);
});

test("N5 + Fable m70044: events_ignored = the last POST's skips {count, first <= 50}, overwritten by a clean POST; a 400 leaves it", async () => {
  const { default: Page } = await import("../app/admin/feed-health/page");
  const box = await newBox([T["cme-ctrader-fix"]], [T["cme-ctrader-fix"]]);
  const stored = async () => (await sql(`select events_ignored from feed_boxes where id = $1`, [box.id])).rows[0].events_ignored;
  const ahead = new Date(Date.now() + 5 * MIN).toISOString();
  const r = await postEvents(box.token, { box: box.name, events: [{ ts: ahead, kind: "bridge_start" }] });
  assert.equal(r.status, 200);
  assert.deepEqual([r.body.stored, r.body.ignored], [0, [{ ts: ahead, kind: "bridge_start", reason: "ts more than 60 s ahead" }]]);
  assert.deepEqual(await stored(), { count: 1, first: r.body.ignored });

  // A whole bad-clock batch: every event skipped, the row keeps the count and the first 50 only.
  const skew = Array.from({ length: 100 }, (_, i) => ({ ts: new Date(Date.now() + 5 * MIN + i * 1000).toISOString(), kind: "client_reject" }));
  const bulk = await postEvents(box.token, { box: box.name, events: skew });
  assert.equal(bulk.body.ignored.length, 100, "the 200 body lists them all");
  const s = await stored();
  assert.equal(s.count, 100);
  assert.equal(s.first.length, 50);
  assert.equal(s.first[0].ts, skew[0].ts);
  const page = renderToStaticMarkup(await Page());
  const start = page.indexOf(`data-box="${box.name}"`);
  assert.match(page.slice(start, page.indexOf("</section>", start)), /last events POST skipped 100 events \(first 50 listed\): client_reject /);

  assert.equal((await postEvents(box.token, { box: box.name, events: [{ ts: "bad", kind: "bridge_start" }] })).status, 400);
  assert.equal((await stored()).count, 100, "a refused body changes nothing");
  await postEvents(box.token, { box: box.name, events: [ev("bridge_start", MIN)] });
  assert.deepEqual(await stored(), { count: 0, first: [] }, "a clean POST clears the earlier skips");
  const after = renderToStaticMarkup(await Page());
  const at2 = after.indexOf(`data-box="${box.name}"`);
  assert.ok(!/data-events-ignored/.test(after.slice(at2, after.indexOf("</section>", at2))));
});

test("E5: events never touch the box's status clock", async () => {
  const box = await newBox([T["cme-ctrader-fix"]], [T["cme-ctrader-fix"]]);
  await postEvents(box.token, { box: box.name, events: [ev("reconnect_ok", MIN)] });
  const b = (await sql(`select status_reported_at, status_sent_at, last_seen_at from feed_boxes where id = $1`, [box.id])).rows[0];
  assert.deepEqual([b.status_reported_at, b.status_sent_at, b.last_seen_at], [null, null, null]);
});

// ---------- S1 (Fable m70029): provider scope = non-empty tier set AND every tier is the provider's ----------

test("S1 scope: own box (cme-pip shape: one tier, apply + status, provider = Pip) is Pip's and no one else's", async () => {
  const { providerBoxIds } = await import("./feed-box-events");
  const box = await newBox([T["cme-ctrader-fix"]], [T["cme-ctrader-fix"]]);
  assert.ok((await providerBoxIds(PIP)).includes(box.id));
  assert.ok(!(await providerBoxIds(OTHER)).includes(box.id));
});

test("S1 scope: mixed box (tommy4 shape: one Pip tier + one other provider's, or + one NULL) is hidden from everyone", async () => {
  const { providerBoxIds } = await import("./feed-box-events");
  const twoProviders = await newBox([], [T["cme-ctrader-fix"], T["cme-other"]]);
  const withNull = await newBox([T["cme-ctrader-fix"]], [T["cme-unowned"]]);
  for (const who of [PIP, OTHER, SEED_PROVIDER]) {
    const ids = await providerBoxIds(who);
    assert.ok(!ids.includes(twoProviders.id) && !ids.includes(withNull.id), who);
  }
});

test("S1 scope: a tier-less box (status set emptied, no apply set) is hidden from everyone (\"no tier differs\" is vacuous)", async () => {
  const fb = await import("./feed-boxes");
  const { providerBoxIds } = await import("./feed-box-events");
  const box = await newBox([], [T["cme-ctrader-fix"]]);
  await fb.setBoxStatusTiers(box.id, []);
  assert.equal((await sql(`select (select count(*) from feed_box_tiers where box_id = $1) + (select count(*) from feed_box_status_tiers where box_id = $1) as n`, [box.id])).rows[0].n, 0);
  await postEvents(box.token, { box: box.name, events: [ev("client_reject", MIN, { detail: "ip_not_allowlisted" })] });
  for (const who of [PIP, OTHER, SEED_PROVIDER]) assert.ok(!(await providerBoxIds(who)).includes(box.id), who);
});

test("S1 scope: a box whose only tier has NULL provider is hidden from everyone", async () => {
  const { providerBoxIds } = await import("./feed-box-events");
  const box = await newBox([T["cme-unowned"]], [T["cme-unowned"]]);
  for (const who of [PIP, OTHER, SEED_PROVIDER]) assert.ok(!(await providerBoxIds(who)).includes(box.id), who);
});

// ---------- S2 (Fable m70029): an open cut is bounded on read ----------

const NOW = new Date("2026-10-16T12:00:00.000Z");
const at = (minAgo: number) => new Date(NOW.getTime() - minAgo * MIN);
const E = (kind: string, minAgo: number, durationS: number | null = null, detail: string | null = null) => ({ ts: at(minAgo), kind, durationS, detail }) as any;

test("S2: open cut + a LATER reconnect_ok (or bridge_start) = 'closed, duration unknown', not in the seconds sum", async () => {
  const { resolveEvents, summarize24h } = await import("./feed-box-events");
  const evs = [E("reconnect_ok", 170), E("databento_silent", 180), E("reconnect_ok", 200)];
  const r = resolveEvents(evs, { latestUpTickAt: null }, NOW);
  const cut = r.find((e) => e.kind === "databento_silent")!.cut!;
  assert.equal(cut.state, "ended_unknown");
  assert.equal(cut.endedBy!.ts.getTime(), at(170).getTime(), "the FIRST later one; the earlier reconnect (200 min ago) doesn't count");
  const s = summarize24h(r, NOW);
  assert.deepEqual([s.cuts, s.darkS, s.noDuration, s.open], [1, 0, 1, null]);
  const viaStart = resolveEvents([E("bridge_start", 100), E("databento_silent", 180)], { latestUpTickAt: null }, NOW);
  assert.equal(viaStart[1].cut!.state, "ended_unknown");
});

test("S2: open cut + an up status row with a tick after the cut = 'cut not closed by the sender', not dark now", async () => {
  const { resolveEvents, summarize24h } = await import("./feed-box-events");
  const r = resolveEvents([E("databento_silent", 180)], { latestUpTickAt: at(1) }, NOW);
  assert.equal(r[0].cut!.state, "not_closed");
  assert.equal(summarize24h(r, NOW).darkS, 0);
  // A tick from BEFORE the cut proves nothing.
  assert.equal(resolveEvents([E("databento_silent", 180)], { latestUpTickAt: at(181) }, NOW)[0].cut!.state, "open");
});

test("S2 + Fable m70044: a second databento_silent (sender restarted mid-cut) ends the first; only the newest open cut is dark now", async () => {
  const { resolveEvents, summarize24h } = await import("./feed-box-events");
  // Newest first, as loadBoxEvents returns them.
  const r = resolveEvents([E("databento_silent", 2), E("databento_silent", 10)], { latestUpTickAt: null }, NOW);
  assert.equal(r[0].cut!.state, "open");
  assert.equal(r[1].cut!.state, "ended_unknown");
  assert.deepEqual([r[1].cut!.endedBy!.kind, r[1].cut!.endedBy!.ts.getTime()], ["databento_silent", at(2).getTime()]);
  const s = summarize24h(r, NOW);
  assert.deepEqual([s.cuts, s.darkS, s.noDuration], [2, 120, 1]);
  assert.equal(s.open!.ts.getTime(), at(2).getTime());
  // A later cut that CLOSED also ends it: data can't still be dark from the first.
  const closedLater = resolveEvents([E("databento_silent", 2, 60), E("databento_silent", 10)], { latestUpTickAt: null }, NOW);
  assert.equal(closedLater[1].cut!.state, "ended_unknown");
  assert.equal(summarize24h(closedLater, NOW).open, null);
});

test("N2: open cut + a LATER bridge_stop = 'closed, duration unknown (Bridge stopped …)', not dark now", async () => {
  const { resolveEvents, summarize24h } = await import("./feed-box-events");
  const { cutText } = await import("../components/feed/box-events");
  const r = resolveEvents([E("bridge_stop", 30, null, "process_gone"), E("databento_silent", 40)], { latestUpTickAt: null }, NOW);
  const cut = r[1].cut!;
  assert.deepEqual([cut.state, cut.endedBy!.kind, cut.endedBy!.ts.getTime()], ["ended_unknown", "bridge_stop", at(30).getTime()]);
  assert.match(cutText(r[1]), /^closed, duration unknown \(Bridge stopped \d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2} UTC\)$/);
  const s = summarize24h(r, NOW);
  assert.deepEqual([s.cuts, s.darkS, s.noDuration, s.open], [1, 0, 1, null]);
  // A bridge_stop BEFORE the cut ends nothing.
  assert.equal(resolveEvents([E("databento_silent", 40), E("bridge_stop", 50)], { latestUpTickAt: null }, NOW)[0].cut!.state, "open");
});

test("S2: open cut alone (silent box) still reads dark now, counts now - ts, capped at 86400 s", async () => {
  const { resolveEvents, summarize24h } = await import("./feed-box-events");
  const r = resolveEvents([E("databento_silent", 3)], { latestUpTickAt: null }, NOW);
  assert.deepEqual([r[0].cut!.state, r[0].cut!.seconds, r[0].cut!.capped], ["open", 180, false]);
  const s = summarize24h(r, NOW);
  assert.deepEqual([s.cuts, s.darkS, s.longestS], [1, 180, 180]);
  assert.equal(s.open!.ts.getTime(), at(3).getTime());
  const old = resolveEvents([E("databento_silent", 3 * 24 * 60)], { latestUpTickAt: null }, NOW);
  assert.deepEqual([old[0].cut!.seconds, old[0].cut!.capped], [86_400, true]);
  const so = summarize24h(old, NOW);
  assert.deepEqual([so.cuts, so.darkS], [0, 0], "started 3 days ago: not in the 24 h line");
  assert.ok(so.open, "but still dark now");
});

test("24 h line: cuts STARTED in the last 24 h (N7), closed seconds summed, longest, databento_error counted apart", async () => {
  const { resolveEvents, summarize24h } = await import("./feed-box-events");
  const r = resolveEvents(
    [E("databento_silent", 10, 131), E("databento_error", 20, null, "licence_auth"), E("databento_silent", 60, 120), E("databento_silent", 24 * 60 + 1, 141), E("databento_error", 24 * 60 + 1)],
    { latestUpTickAt: null },
    NOW
  );
  const s = summarize24h(r, NOW);
  assert.deepEqual([s.cuts, s.darkS, s.longestS, s.noDuration, s.errors, s.open], [2, 251, 131, 0, 1, null]);
  const edge = summarize24h(resolveEvents([E("databento_silent", 24 * 60, 5)], { latestUpTickAt: null }, NOW), NOW);
  assert.equal(edge.cuts, 1, "exactly 24 h ago is in");
});

// ---------- /admin/feed-health ----------

test("/admin/feed-health: 24 h line, recent events with labels, open cut dark now, silence note, skipped events on the header", async () => {
  const { default: Page } = await import("../app/admin/feed-health/page");
  const box = await newBox([T["cme-ctrader-fix"]], [T["cme-ctrader-fix"]]);
  await postEvents(box.token, {
    box: box.name,
    events: [
      ev("databento_silent", 30 * MIN, { duration_s: 131, detail: "after_error" }),
      ev("reconnect_ok", 28 * MIN, { detail: "after_silence" }),
      ev("client_reject", 20 * MIN, { detail: "ip_not_allowlisted" }),
      ev("databento_error", 15 * MIN, { detail: "licence_auth" }),
      ev("databento_silent", 2 * MIN),
      { ts: new Date(Date.now() + 5 * MIN).toISOString(), kind: "bridge_stop" },
    ],
  });
  const page = renderToStaticMarkup(await Page());
  const start = page.indexOf(`data-box="${box.name}"`);
  assert.ok(start > 0, "the box has a section");
  const html = page.slice(start, page.indexOf("</section>", start));
  assert.match(html, /Last 24 h: 2 cuts started · \d+ min \d+ s dark · longest \d+ min \d+ s · 1 Databento error · dark now, since \d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2} UTC/);
  assert.match(html, /box has never sent a status report: events may be missing/, "no status report yet: '0 cuts' can't read green");
  assert.match(html, /Client rejected<\/td><td[^>]*>[^<]*<\/td><td[^>]*>IP not allowlisted/);
  assert.match(html, /Databento error<\/td><td[^>]*>[^<]*<\/td><td[^>]*>licence \/ auth/);
  assert.match(html, /data-cut="closed"[\s\S]*?2 min 11 s/);
  assert.match(html, /data-cut="open"[\s\S]*?dark now · /);
  assert.match(html, /last events POST skipped 1 event: bridge_stop .* \(ts more than 60 s ahead\)/);
  assert.ok(!/203\.0\.113|\d+\.\d+\.\d+\.\d+/.test(html), "no IP anywhere in the box's events");
});

test("/admin/feed-health: a fresh up status after an open cut reads 'cut not closed by the sender'; no silence note while fresh", async () => {
  const { default: Page } = await import("../app/admin/feed-health/page");
  const box = await newBox([], [T["cme-ctrader-fix"]]);
  await postEvents(box.token, { box: box.name, events: [ev("databento_silent", 5 * MIN)] });
  const st = await postStatus(box.token, {
    box: box.name,
    sent_at: iso(0),
    collector: { version: "0.1.0", measuring: true },
    feeds: [{ feed_id: "cme-ctrader-fix", symbol: "ALL", source: "bridge_status", state: "up", last_tick_utc: iso(1000) }],
  });
  assert.equal(st.status, 200, JSON.stringify(st.body));
  const page = renderToStaticMarkup(await Page());
  const start = page.indexOf(`data-box="${box.name}"`);
  const html = page.slice(start, page.indexOf("</section>", start));
  assert.match(html, /cut not closed by the sender/);
  assert.ok(!/dark now/.test(html), html);
  assert.ok(!/data-events-silence/.test(html));
  assert.match(html, /ALL via bridge_status/, "m70036: one symbol=ALL row needs no schema change");
});

test("/admin/feed-health: a box with events but no status set is listed; a box with neither shows no events block", async () => {
  const { default: Page } = await import("../app/admin/feed-health/page");
  const applyOnly = await newBox([T["cme-ctrader-fix"]], []);
  const quiet = await newBox([T["cme-ctrader-fix"]], []);
  await postEvents(applyOnly.token, { box: applyOnly.name, events: [ev("bridge_start", MIN, { detail: "uptime_reset" })] });
  const page = renderToStaticMarkup(await Page());
  const start = page.indexOf(`data-box="${applyOnly.name}"`);
  assert.ok(start > 0);
  assert.match(page.slice(start, page.indexOf("</section>", start)), /Bridge started<\/td><td[^>]*><\/td><td[^>]*>uptime reset/);
  assert.ok(!page.includes(`data-box="${quiet.name}"`));
});

// ---------- /feed/dashboard/health (S2, BUILD GO m70609) ----------

const card = (page: string, name: string) => {
  const start = page.indexOf(`data-box="${name}"`);
  return start < 0 ? null : page.slice(start, page.indexOf("</section>", start));
};

test("S2 page: Pip sees his box's 24 h line, cuts, reason labels and a No report pill; another provider's box and a mixed box are not on it, nor admin-only parts", async () => {
  const { default: Page } = await import("../app/feed/dashboard/health/page");
  const pip = await newBox([T["cme-ctrader-fix"]], [T["cme-ctrader-fix"]]);
  const other = await newBox([T["cme-other"]], [T["cme-other"]]);
  const mixed = await newBox([T["cme-ctrader-fix"]], [T["cme-other"]]);
  await postEvents(pip.token, {
    box: pip.name,
    events: [
      ev("databento_silent", 30 * MIN, { duration_s: 131 }),
      ev("client_reject", 20 * MIN, { detail: "ip_not_allowlisted" }),
      ev("databento_error", 15 * MIN, { detail: "licence_auth" }),
      ev("databento_silent", 2 * MIN),
      { ts: new Date(Date.now() + 5 * MIN).toISOString(), kind: "bridge_stop" },
    ],
  });
  for (const b of [other, mixed]) await postEvents(b.token, { box: b.name, events: [ev("client_reject", MIN, { detail: "logon_rejected" })] });

  signInAs(PIP);
  const page = renderToStaticMarkup(await Page());
  const html = card(page, pip.name);
  assert.ok(html, "Pip's box has a card");
  assert.match(html, /data-freshness="no_report"[^>]*>No report</);
  assert.match(html, /Last 24 h: 2 cuts started · \d+ min \d+ s dark · longest \d+ min \d+ s · 1 Databento error · dark now, since \d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2} UTC/);
  assert.match(html, /box has never sent a status report: events may be missing/);
  assert.match(html, /data-cut="closed"[\s\S]*?<td>2 min 11 s<\/td><td><\/td>/, "Q-A: a cut with no detail leaves the reason empty");
  assert.match(html, /data-cut="open"[\s\S]*?<td class="dark-now">dark now · [^<]+ so far<\/td>/);
  assert.match(html, /<td>Client rejected<\/td><td><\/td><td>IP not allowlisted<\/td>/);
  assert.match(html, /<td>Databento error<\/td><td><\/td><td>licence \/ auth<\/td>/);
  assert.ok(!/skipped|collector|ip_not_allowlisted|\d+\.\d+\.\d+\.\d+/.test(html), "no skipped events, collector, raw code or IP");
  assert.equal(card(page, other.name), null, "another provider's box");
  assert.equal(card(page, mixed.name), null, "a mixed box (U3)");
  assert.ok(!/Gaps · 30d|data-feed-health-empty/.test(page), "Q-B: no Gaps tile; not the empty state");
  assert.match(page, /Uptime · 30d[\s\S]*?not measured/);

  signInAs(OTHER);
  const page2 = renderToStaticMarkup(await Page());
  assert.ok(card(page2, other.name), "the other provider sees their own box");
  assert.equal(card(page2, pip.name), null, "and none of Pip's");
  assert.equal(card(page2, mixed.name), null);
});

test("S2 page: a fresh up status after the open cut reads Live and 'cut not closed by the sender' (same latestUpTickAt as /admin)", async () => {
  const { default: Page } = await import("../app/feed/dashboard/health/page");
  const pip = await newBox([T["cme-ctrader-fix"]], [T["cme-ctrader-fix"]]);
  await postEvents(pip.token, { box: pip.name, events: [ev("databento_silent", 5 * MIN)] });
  const st = await postStatus(pip.token, {
    box: pip.name,
    sent_at: iso(0),
    collector: { version: "0.1.0", measuring: true },
    feeds: [{ feed_id: "cme-ctrader-fix", symbol: "ALL", source: "bridge_status", state: "up", last_tick_utc: iso(1000) }],
  });
  assert.equal(st.status, 200, JSON.stringify(st.body));
  signInAs(PIP);
  const html = card(renderToStaticMarkup(await Page()), pip.name)!;
  assert.match(html, /data-freshness="fresh"[^>]*>Live</);
  assert.match(html, /cut not closed by the sender/);
  assert.ok(!/dark now|data-events-silence|0\.1\.0|ALL via/.test(html), html);
});

test("S2 page: a provider with no box of their own gets the empty state and no card", async () => {
  const { default: Page } = await import("../app/feed/dashboard/health/page");
  const none = "00000000-0000-4000-8000-00000000e003";
  await sql(`insert into users (id, email, role) values ($1, 'no-box-provider@example.invalid', 'feed_provider') on conflict do nothing`, [none]);
  signInAs(none);
  const page = renderToStaticMarkup(await Page());
  assert.match(page, /data-feed-health-empty=""[\s\S]*?Nothing reported yet/);
  assert.ok(!page.includes("data-box="));
});

test("S2 guard: the provider page reads boxes only through providerBoxIds and never names the admin-only parts", async () => {
  const src = readFileSync(path.join(process.cwd(), "src/app/feed/dashboard/health/page.tsx"), "utf8");
  assert.match(src, /providerBoxIds\(session!\.user!\.id!\)/);
  assert.match(src, /\.filter\(\(b\) => ids\.has\(b\.id\)\)/);
  assert.ok(!/events_ignored|ignored|listAllowlistBoxPolls|collectorVersion|measuring|ticksPerMin|gapP|<BoxEvents/.test(src), "admin-only names");
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
