/* Run: npx tsx --test src/lib/agent-api.test.ts
 *
 * The agent API (scope m60807, fable m60833 C2-C7, marcus m60835): POST /api/agent/trial and
 * /api/agent/feed through handleAgentRequest. Covers the gate (production only, claw1's IP, the
 * token's sha256 in constant time), the strict body, plan = zero writes, the trimmed response,
 * idempotency (replay, 409 on a different payload, 409 in flight, reconcile of a stale pending row
 * both ways), the daily cap, the hard-refused overrides, the audit stamp and the pings, and that
 * the advisory lock is held from the cap count to the outcome.
 * Same harness as assign-trial.test.ts: in-memory PGlite on the REAL migration chain.
 * PGlite is ONE session, so it cannot show two requests interleaving: the lock is proven by
 * statement order on the lock client, and concurrency itself is unmeasured. Needs Node >= 22. */
import { test, before, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
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

const TOKEN = "agent-test-token-0123456789abcdefghijklmnopqrstuvwxyz";
const CLAW1 = "88.99.67.48";
const ENV: Record<string, string> = {
  VERCEL_ENV: "production",
  AGENT_API_TOKEN_SHA256: createHash("sha256").update(TOKEN).digest("hex"),
  AGENT_API_ALLOWED_IP: CLAW1,
  NEON_DATABASE_URL: "postgres://unused",
  HORIZON_PORTAL_BOT_TOKEN: "portal-token",
  AUTH_RESEND_KEY: "re_test",
  EMAIL_FROM: "Horizon <noreply@example.invalid>",
  TELEMETRY_BOT_TOKEN: "telemetry-token",
};

/* eslint-disable @typescript-eslint/no-explicit-any */
let db: any;
let api: typeof import("./agent-api");
let inl: typeof import("./issue-new-license");
let fs: typeof import("./feed-subscriptions");
let actorId = "";

// Every statement, tagged with who sent it: "pool" or the connect() client that sent it.
const statements: { by: string; text: string }[] = [];
let clients = 0;
/** When set, the lock client throws on a statement matching it (to land a request in doubt). */
let failClientOn: RegExp | null = null;
const sends: { kind: "portal" | "telemetry" | "email"; to: string; text: string }[] = [];
let portalThrows = false;

async function run(by: string, text: string, params: unknown[] = []) {
  statements.push({ by, text });
  const r = await db.query(text, params);
  return { rows: r.rows as any[], rowCount: (r.rows.length || r.affectedRows || 0) as number };
}

async function nextXid(): Promise<string> {
  return String((await db.query(`select pg_snapshot_xmax(pg_current_snapshot())::text as x`)).rows[0].x);
}

before(async () => {
  db = new PGlite();
  const files = readdirSync(MIGRATIONS).filter((f) => f.endsWith(".sql") && !f.includes("rollback")).sort();
  for (const f of files) {
    if (SKIPPED.has(f)) continue;
    if (SEEDS[f]) await db.exec(SEEDS[f]);
    await db.exec(readFileSync(path.join(MIGRATIONS, f), "utf8"));
  }
  (globalThis as any)._pgPool = {
    query: (t: string, p?: unknown[]) => run("pool", t, p),
    connect: async () => {
      const tag = `client${++clients}`;
      return {
        query: async (t: string, p?: unknown[]) => {
          if (failClientOn?.test(t) && tag !== "pool") throw new Error("injected: connection lost");
          return run(tag, t, p);
        },
        release() {},
      };
    },
    end: async () => {},
  };
  Object.assign(process.env, ENV);
  (globalThis as any).fetch = async (url: string, init?: { body?: string }) => {
    const u = String(url);
    const body = init?.body ? JSON.parse(init.body) : {};
    if (u.includes(`/bot${ENV.HORIZON_PORTAL_BOT_TOKEN}/sendMessage`)) {
      if (portalThrows) throw new TypeError("fetch failed");
      sends.push({ kind: "portal", to: String(body.chat_id), text: body.text });
    } else if (u.includes(`/bot${ENV.TELEMETRY_BOT_TOKEN}/sendMessage`)) sends.push({ kind: "telemetry", to: String(body.chat_id), text: body.text });
    else if (u.includes("resend.com")) sends.push({ kind: "email", to: [body.to].flat().join(","), text: body.text });
    else throw new Error(`unexpected outbound fetch: ${u}`);
    return new Response(JSON.stringify({ ok: true, result: {}, id: "email-id" }), { status: 200 });
  };
  api = await import("./agent-api");
  inl = await import("./issue-new-license");
  fs = await import("./feed-subscriptions");
  await db.exec(readFileSync(path.join(process.cwd(), "scripts/seed-agent-actor.sql"), "utf8"));
  actorId = (await db.query(`select id from users where email = 'marcus-agent@horizonhft.internal'`)).rows[0].id;
});

beforeEach(async () => {
  // The cap is per UTC day; each test starts from an empty day unless it builds one.
  await db.query(`delete from agent_grants`);
  failClientOn = null;
  portalThrows = false;
});

let seq = 0;
/** A client; with feeds, an active licence and its registered server. */
async function makeClient(opts: { feeds?: string[]; email?: string } = {}) {
  seq++;
  const email = opts.email ?? `agentclient${seq}@example.invalid`;
  const tg = 9000 + seq;
  const id = (await db.query(`insert into users (email, telegram_user_id) values ($1, $2) returning id`, [email, tg])).rows[0].id as string;
  let ip = "";
  if (opts.feeds) {
    const l = (
      await db.query(`insert into licenses (user_id, license_key, expires_at, feed_types) values ($1, $2, now() + interval '30 days', $3) returning id`, [
        id,
        `HHFT-AGENT${seq}-SECRET-KEY`,
        opts.feeds,
      ])
    ).rows[0].id;
    ip = `198.51.100.${seq}`;
    await db.query(
      `insert into server_registrations (license_id, user_id, server_name, vps_provider, server_location, declared_ip)
       values ($1, $2, $3, 'other', 'London', $4)`,
      [l, id, `box-${seq}`, ip]
    );
  }
  return { id, email, telegramId: String(tg), ip };
}

let keySeq = 0;
const newKey = () => `test-key-${String(++keySeq).padStart(8, "0")}`;

function request(action: "trial" | "feed", body: unknown, headers: Record<string, string> = {}) {
  const raw = typeof body === "string" ? body : JSON.stringify(body);
  return new Request(`https://horizonhft.com/api/agent/${action}`, {
    method: "POST",
    headers: { "content-type": "application/json", authorization: `Bearer ${TOKEN}`, "x-forwarded-for": CLAW1, ...headers },
    body: raw,
  });
}

const call = (action: "trial" | "feed", body: unknown, headers?: Record<string, string>, env: Record<string, string | undefined> = process.env) =>
  api.handleAgentRequest(action, request(action, body, headers), env);

const trialBody = (user: string, extra: Record<string, unknown> = {}) => ({ mode: "execute", idempotencyKey: newKey(), user, days: 7, feeds: ["london"], ...extra });
const feedBody = (user: string, extra: Record<string, unknown> = {}) => ({ mode: "execute", idempotencyKey: newKey(), user, tierKey: "ld-beta-56", ...extra });

async function ledger(key: string) {
  return (await db.query(`select status, response_json, target_user_id from agent_grants where idempotency_key = $1`, [key])).rows[0];
}

async function counts() {
  const r = await db.query(`select
      (select count(*) from licenses)::int as licences,
      (select count(*) from feed_subscriptions)::int as subs,
      (select count(*) from admin_actions)::int as actions,
      (select count(*) from agent_grants)::int as ledger`);
  return { ...r.rows[0], sends: sends.length };
}

/** Insert a ledger row directly, as a request that died at that point would have left it. */
async function seedLedger(key: string, body: any, userId: string, status: string, ageSeconds: number) {
  const { json, hash } = api.requestFingerprint({ action: body.tierKey ? "feed" : "trial", ...body });
  await db.query(
    `insert into agent_grants (idempotency_key, action, request_hash, request_json, target_user_id, status, response_json, created_at)
     values ($1, $2, $3, $4, $5, $6, $7, now() - make_interval(secs => $8))`,
    [key, json.action, hash, JSON.stringify(json), userId, status, status === "pending" ? null : JSON.stringify({ action: json.action, status: "granted" }), ageSeconds]
  );
}

/** What C5 forbids in any response: a licence key or its masked message, a Telegram id, a server IP,
 * a provider email. */
function assertTrimmed(body: unknown, client: { telegramId: string; ip: string }) {
  const s = JSON.stringify(body);
  assert.ok(!/HHFT-/.test(s), `no licence key: ${s}`);
  assert.ok(!s.includes("license key:"), `no key message: ${s}`);
  assert.ok(!s.includes(client.telegramId), `no telegram id: ${s}`);
  if (client.ip) assert.ok(!s.includes(client.ip), `no server IP: ${s}`);
  assert.ok(!s.includes("seed-provider@"), `no provider email: ${s}`);
}

test("the gate: production only, claw1's first hop, the token's sha256 in constant time", async () => {
  const h = (extra: Record<string, string> = {}) => new Headers({ authorization: `Bearer ${TOKEN}`, "x-forwarded-for": CLAW1, ...extra });
  assert.equal(api.gateAgentRequest(h(), ENV), null);
  assert.equal(api.gateAgentRequest(h(), { ...ENV, VERCEL_ENV: "preview" })?.status, 404, "a preview shares the prod DB: it must not answer");
  assert.equal(api.gateAgentRequest(h(), { ...ENV, VERCEL_ENV: undefined })?.status, 404);
  assert.deepEqual(api.gateAgentRequest(h(), { ...ENV, AGENT_API_TOKEN_SHA256: undefined }), { status: 401, error: "agent api not configured" });
  assert.equal(api.gateAgentRequest(h(), { ...ENV, AGENT_API_TOKEN_SHA256: "abc" })?.status, 401, "a malformed hash is not configured");
  assert.equal(api.gateAgentRequest(h(), { ...ENV, AGENT_API_ALLOWED_IP: "" })?.status, 401);
  assert.equal(api.gateAgentRequest(h({ "x-forwarded-for": "203.0.113.9" }), ENV)?.status, 403);
  assert.equal(api.gateAgentRequest(h({ "x-forwarded-for": `${CLAW1}, 10.0.0.1` }), ENV), null, "first hop is the caller");
  assert.equal(api.gateAgentRequest(h({ "x-forwarded-for": `10.0.0.1, ${CLAW1}` }), ENV)?.status, 403, "a later hop is not");
  assert.equal(api.gateAgentRequest(new Headers({ "x-forwarded-for": CLAW1 }), ENV)?.status, 401, "no token");
  assert.equal(api.gateAgentRequest(h({ authorization: `Bearer ${TOKEN}x` }), ENV)?.status, 401, "wrong token");
  assert.equal(api.gateAgentRequest(h({ authorization: "Bearer short" }), ENV)?.status, 401, "short token");
  assert.equal(api.gateAgentRequest(h({ authorization: `Basic ${TOKEN}` }), ENV)?.status, 401);
  // The hash in env may be upper-case hex; it is the same hash.
  assert.equal(api.gateAgentRequest(h(), { ...ENV, AGENT_API_TOKEN_SHA256: ENV.AGENT_API_TOKEN_SHA256.toUpperCase() }), null);
  const src = readFileSync(path.join(process.cwd(), "src/lib/agent-api.ts"), "utf8");
  assert.match(src, /timingSafeEqual\(presented, Buffer\.from\(expectedHex, "hex"\)\)/, "constant-time compare, not ===");

  // Through the handler: a refused gate reads no body and writes nothing.
  const t0 = await counts();
  assert.equal((await call("trial", trialBody("x@example.invalid"), { "x-forwarded-for": "203.0.113.9" })).status, 403);
  assert.equal((await call("trial", trialBody("x@example.invalid"), {}, { ...process.env, VERCEL_ENV: "preview" })).status, 404);
  assert.deepEqual(await counts(), t0);
});

test("the body: strict fields and types, JSON only, at most 4 KB", async () => {
  const c = await makeClient();
  const bad = async (body: unknown, re: RegExp, action: "trial" | "feed" = "trial") => {
    const r = await call(action, body);
    assert.equal(r.status, 400, JSON.stringify(r.body));
    assert.match(r.body.error ?? "", re);
  };
  await bad(trialBody(c.email, { allowInternal: true }), /unknown field\(s\): allowInternal/);
  await bad(trialBody(c.email, { allowRepeatTrial: true }), /unknown field\(s\): allowRepeatTrial/);
  await bad(feedBody(c.email, { days: 7 }), /unknown field/, "feed");
  await bad({ ...trialBody(c.email), mode: "go" }, /mode must be/);
  await bad({ mode: "execute", user: c.email, days: 7, feeds: ["london"] }, /execute needs an idempotencyKey/);
  await bad(trialBody(c.email, { idempotencyKey: "short" }), /idempotencyKey must match/);
  await bad(trialBody(c.email, { idempotencyKey: "has space in it 12345" }), /idempotencyKey must match/);
  for (const days of [0, 91, 1.5, "7", null]) await bad(trialBody(c.email, { days }), /days must be a whole number from 1 to 90/);
  await bad(trialBody(c.email, { feeds: [] }), /feeds must be a non-empty array/);
  await bad(trialBody(c.email, { feeds: ["mars"] }), /unknown feed/);
  await bad(trialBody(c.email, { feeds: ["london", "london"] }), /duplicates/);
  await bad(trialBody("not a user"), /uuid or an email/);
  await bad(feedBody(c.email, { tierKey: "LD BETA" }), /tierKey/, "feed");
  await bad("[1,2]", /JSON object/);
  await bad("{nope", /not JSON/);

  assert.equal((await call("trial", trialBody(c.email), { "content-type": "text/plain" })).status, 415);
  const huge = JSON.stringify({ ...trialBody(c.email), user: "a".repeat(5000) });
  assert.equal((await call("trial", huge)).status, 413);
  assert.equal((await call("trial", trialBody(c.email), { "content-length": "999999" })).status, 413);
});

test("both routes: POST only, maxDuration a literal equal to AGENT_MAX_DURATION_S", () => {
  for (const action of ["trial", "feed"]) {
    const src = readFileSync(path.join(process.cwd(), `src/app/api/agent/${action}/route.ts`), "utf8");
    assert.match(src, new RegExp(`export const maxDuration = ${api.AGENT_MAX_DURATION_S};`));
    assert.deepEqual([...src.matchAll(/export async function (\w+)/g)].map((m) => m[1]), ["POST"]);
    assert.match(src, new RegExp(`handleAgentRequest\\("${action}", req\\)`));
  }
  assert.ok(api.SETTLE_CAP_MS < api.AGENT_MAX_DURATION_S * 1000);
});

test("plan: reads only (no ledger row, no lock, no xid), and the answer is trimmed", async () => {
  const c = await makeClient({ feeds: ["london", "ny"] });
  const fresh = await makeClient();
  for (const [action, body] of [
    ["trial", { mode: "plan", user: fresh.email, days: 7, feeds: ["london"] }],
    ["feed", { mode: "plan", user: c.email, tierKey: "ld-beta-56" }],
  ] as const) {
    const [s0, c0, x0, t0] = [statements.length, clients, await nextXid(), await counts()];
    const r = await call(action, body);
    assert.equal(r.status, 200, JSON.stringify(r.body));
    assert.equal(r.body.status, "would_grant", JSON.stringify(r.body));
    assert.deepEqual(r.body.refusals, []);
    assert.equal(r.body.capRemainingToday, 5);
    assert.equal(clients, c0, "no pool.connect: no transaction, no lock");
    assert.equal(await nextXid(), x0, "no xid consumed");
    assert.deepEqual(await counts(), t0, "nothing written, nothing sent");
    assert.ok(!statements.slice(s0).some((s) => /\b(insert\s+into|delete\s+from|pg_advisory\w*)\b|\bupdate\s+\w+\s+(\w+\s+)?set\b/i.test(s.text)));
    assertTrimmed(r.body, action === "trial" ? fresh : c);
  }
  const r = await call("feed", { mode: "plan", user: c.email, tierKey: "ld-beta-56" });
  assert.deepEqual(Object.keys(r.body.feed ?? {}).sort(), ["existingRowStatus", "licence", "regionKey", "serverRegistered", "tierKey", "tierName", "wouldBe"]);
  const nobody = await call("trial", { mode: "plan", user: "nobody@example.invalid", days: 7, feeds: ["london"] });
  assert.equal(nobody.body.status, "would_refuse");
  assert.match(nobody.body.refusals?.[0] ?? "", /No user matches/);
});

test("execute trial: granted once, stamped via agent-api + key, pinged, the key never in the answer", async () => {
  const c = await makeClient();
  const body = trialBody(c.email, { days: 14, feeds: ["london", "ny"] });
  const before = sends.length;
  const r = await call("trial", body);
  assert.equal(r.status, 200, JSON.stringify(r.body));
  assert.equal(r.body.status, "granted");
  assert.equal(r.body.trial?.tier, "trial");
  assert.equal(r.body.capRemainingToday, 4);
  assertTrimmed(r.body, c);

  const lic = (await db.query(`select id, tier, feed_types, license_key from licenses where user_id = $1`, [c.id])).rows;
  assert.equal(lic.length, 1);
  assert.equal(lic[0].tier, "trial");
  assert.ok(!JSON.stringify(r.body).includes(lic[0].license_key));
  const act = (await db.query(`select admin_user_id, details_json from admin_actions where target_license_id = $1`, [lic[0].id])).rows;
  assert.equal(act.length, 1);
  assert.equal(act[0].admin_user_id, actorId, "the seeded agent actor, never coxwell's row");
  assert.equal(act[0].details_json.via, "agent-api");
  assert.equal(act[0].details_json.idempotencyKey, body.idempotencyKey);

  const mine = sends.slice(before);
  assert.ok(mine.some((s) => s.kind === "portal" && s.to === c.telegramId), "the client got the key DM (the panel's path)");
  const ping = mine.find((s) => s.kind === "telemetry" && s.text.startsWith("agent-api trial: granted"));
  assert.ok(ping, mine.map((s) => s.text).join("\n---\n"));
  assert.equal(ping!.to, "7225949234");
  assert.ok(ping!.text.includes(c.email) && ping!.text.includes(body.idempotencyKey.slice(0, 8)) && ping!.text.includes("marcus-agent@"));
  assert.ok(!ping!.text.includes(lic[0].license_key), "no key in the ping");
  assert.equal((await ledger(body.idempotencyKey)).status, "granted");
});

test("idempotency: a replay returns the stored answer and grants nothing; a different payload is 409", async () => {
  const c = await makeClient();
  const body = trialBody(c.email);
  const first = await call("trial", body);
  assert.equal(first.body.status, "granted");
  const t0 = await counts();
  const again = await call("trial", body);
  assert.equal(again.status, 200);
  assert.deepEqual(again.body, { ...first.body, replayed: true });
  assert.deepEqual(await counts(), t0, "no licence, no action, no ping on a replay");

  const other = await call("trial", { ...body, days: 30 });
  assert.equal(other.status, 409);
  assert.match(other.body.error ?? "", /already used for a different request/);
  // The user is normalised: the same email in another case is the same request.
  assert.equal((await call("trial", { ...body, user: c.email.toUpperCase() })).body.replayed, true);
  assert.deepEqual(await counts(), t0);
});

test("idempotency: a fresh pending row is in flight (409, no grant); a stale one is reconciled", async (t) => {
  await t.test("in flight", async () => {
    const c = await makeClient();
    const body = trialBody(c.email);
    await seedLedger(body.idempotencyKey, body, c.id, "pending", 5);
    const t0 = await counts();
    const r = await call("trial", body);
    assert.equal(r.status, 409);
    assert.equal(r.body.status, "in_flight");
    assert.deepEqual(await counts(), t0);
  });
  await t.test("stale, nothing landed -> not granted, row failed, pinged", async () => {
    const c = await makeClient();
    const body = trialBody(c.email);
    await seedLedger(body.idempotencyKey, body, c.id, "pending", api.AGENT_STALE_PENDING_S + 5);
    const before = sends.length;
    const r = await call("trial", body);
    assert.equal(r.status, 200);
    assert.equal(r.body.status, "not_granted");
    assert.match(r.body.note ?? "", /NEW idempotencyKey/);
    assert.equal((await ledger(body.idempotencyKey)).status, "failed");
    assert.equal((await db.query(`select count(*)::int as n from licenses where user_id = $1`, [c.id])).rows[0].n, 0, "reconcile grants nothing");
    assert.ok(sends.slice(before).some((s) => s.kind === "telemetry" && s.text.includes("NOT LANDED")));
    // Settled now: the next same-key request replays it.
    assert.equal((await call("trial", body)).body.replayed, true);
  });
  await t.test("stale, the trial DID land (audit row with the key) -> granted, delivery unverified", async () => {
    const c = await makeClient();
    const body = trialBody(c.email);
    await seedLedger(body.idempotencyKey, body, c.id, "pending", api.AGENT_STALE_PENDING_S + 5);
    // What the dead request got as far as: the panel's issue path, stamped with the key.
    await inl.issueNewLicenseForUser({ actorUserId: actorId, userId: c.id, expiresAt: new Date(Date.now() + 7 * 864e5), feedTypes: ["london"], tier: "trial", via: "agent-api", idempotencyKey: body.idempotencyKey });
    const t0 = await counts();
    const r = await call("trial", body);
    assert.equal(r.body.status, "granted", JSON.stringify(r.body));
    assert.match(r.body.note ?? "", /WAS issued\. Whether the key DM\/email went out is not recorded/);
    assert.equal((await ledger(body.idempotencyKey)).status, "granted");
    assert.equal((await counts()).licences, t0.licences, "no second licence");
    assertTrimmed(r.body, c);
  });
  await t.test("stale, the feed grant landed but its audit row did not -> granted from the subscription row", async () => {
    const c = await makeClient({ feeds: ["london"] });
    const body = feedBody(c.email);
    await seedLedger(body.idempotencyKey, body, c.id, "pending", api.AGENT_STALE_PENDING_S + 5);
    await fs.assignFeedTierSubscription(c.id, "ld-beta-56");
    const r = await call("feed", body);
    assert.equal(r.body.status, "granted", JSON.stringify(r.body));
    assert.match(r.body.note ?? "", /WAS written \(no admin_actions row for it\)/);
    assertTrimmed(r.body, c);
  });
});

test("the grant throws after the insert (key DM fails): reconciled at once under the lock, granted + flagged", async () => {
  const c = await makeClient();
  const body = trialBody(c.email);
  portalThrows = true;
  const before = sends.length;
  const r = await call("trial", body);
  assert.equal(r.status, 200, JSON.stringify(r.body));
  assert.equal(r.body.status, "granted");
  assert.match(r.body.note ?? "", /The grant threw TypeError\. The trial licence WAS issued\. Whether the key DM\/email went out is not recorded/);
  assert.ok(!(r.body.note ?? "").includes("fetch failed"), "an unlisted error is named, not quoted");
  assert.equal((await ledger(body.idempotencyKey)).status, "granted");
  assert.ok(sends.slice(before).some((s) => s.kind === "telemetry" && s.text.includes("LANDED, delivery unverified")));
});

test("in doubt: the outcome write fails after the grant -> 500 in_doubt, pinged, the row stays pending", async () => {
  const c = await makeClient();
  const body = trialBody(c.email);
  failClientOn = /^update agent_grants/;
  const before = sends.length;
  const r = await call("trial", body);
  failClientOn = null;
  assert.equal(r.status, 500);
  assert.equal(r.body.status, "in_doubt");
  assert.match(r.body.note ?? "", new RegExp(`after ${api.AGENT_STALE_PENDING_S} s, reconciles`));
  assert.equal((await ledger(body.idempotencyKey)).status, "pending", "committed before the lock transaction, so it survives the rollback");
  assert.ok(sends.slice(before).some((s) => s.kind === "telemetry" && s.text.includes("IN DOUBT")));
  assert.equal((await call("trial", body)).body.status, "in_flight", "a same-key retry inside the window does not grant");
});

test("the lock: the pending row commits first, then one client holds the xact lock from the cap count to the outcome", async () => {
  for (const action of ["trial", "feed"] as const) {
    const c = action === "trial" ? await makeClient() : await makeClient({ feeds: ["london"] });
    const b = action === "trial" ? trialBody(c.email) : feedBody(c.email);
    const s0 = statements.length;
    const r = await call(action, b);
    assert.equal(r.body.status, "granted", JSON.stringify(r.body));
    const log = statements.slice(s0);
    const at = (re: RegExp, by?: string) => log.findIndex((s) => re.test(s.text) && (!by || s.by === by));
    const pending = at(/^insert into agent_grants/, "pool");
    const lock = at(/pg_advisory_xact_lock/);
    const lockBy = log[lock].by;
    const begin = log.findIndex((s) => s.by === lockBy && /^begin$/i.test(s.text));
    const count = at(/select count\(\*\)::int as n from agent_grants/, lockBy);
    const write = at(action === "trial" ? /insert into licenses/ : /insert into feed_subscriptions/);
    const audit = at(/insert into admin_actions/);
    const outcome = at(/^update agent_grants/, lockBy);
    const commit = log.findIndex((s, i) => i > outcome && s.by === lockBy && /^commit$/i.test(s.text));
    assert.ok(lockBy.startsWith("client"), "the lock is on a dedicated connect() client");
    assert.ok(pending >= 0 && pending < begin && begin < lock, `${action}: pending insert, then begin, then the lock`);
    assert.ok(lock < count && count < write && write < audit && audit < outcome && outcome < commit, `${action}: lock < count < grant < audit < outcome < commit`);
  }
});

test("hard-refused overrides: internal/test targets and repeat trials refuse, naming no flag", async () => {
  const internal = await makeClient({ email: `qa-agent${seq + 1}@horizonhft.internal` });
  const r1 = await call("trial", trialBody(internal.email));
  assert.equal(r1.body.status, "refused");
  assert.match(r1.body.refusals?.join(" | ") ?? "", /internal or test account .*: the agent API cannot override this \(the admin panel can\)/);
  assert.ok(!(r1.body.refusals ?? []).some((x) => x.includes("--allow")));

  const c = await makeClient();
  await db.query(`insert into licenses (user_id, license_key, status, expires_at, tier) values ($1, 'OLD-${seq}', 'revoked', now() - interval '1 day', 'trial')`, [c.id]);
  const r2 = await call("trial", trialBody(c.email));
  assert.equal(r2.body.status, "refused");
  assert.match(r2.body.refusals?.join(" | ") ?? "", /trial licence\(s\) before \(see history\): the agent API cannot override this/);
  assert.equal((await db.query(`select count(*)::int as n from licenses where user_id = $1`, [c.id])).rows[0].n, 1, "nothing issued");
});

test("refusals: refused executes write only the ledger row, ping nobody, and do not count toward the cap", async () => {
  const c = await makeClient({ feeds: ["ny"] });
  const before = sends.length;
  const t0 = await counts();
  const r = await call("feed", feedBody(c.email));
  assert.equal(r.body.status, "refused");
  assert.match(r.body.refusals?.join(" | ") ?? "", /would not offer/);
  const t1 = await counts();
  assert.deepEqual({ ...t1, ledger: t0.ledger }, t0, "only the ledger row");
  assert.equal(t1.ledger, t0.ledger + 1);
  assert.equal(sends.length, before, "a refused execute is a log line, not a ping");
  assert.equal((await call("feed", { mode: "plan", user: c.email, tierKey: "ld-beta-56" })).body.capRemainingToday, 5);
});

test("the panel's Grant-button gate holds here too (phase 2 S1): a lapsed entitlement refuses", async () => {
  const c = await makeClient({ feeds: ["london", "ny"] });
  assert.equal((await call("feed", feedBody(c.email))).body.status, "granted");
  await db.query(`update licenses set feed_types = array['ny'] where user_id = $1`, [c.id]);
  const r = await call("feed", feedBody(c.email, { tierKey: "ld-gamma-19" }));
  assert.equal(r.body.status, "refused");
  assert.match(r.body.refusals?.join(" | ") ?? "", /Entitlement lapsed/);
});

test("execute feed: granted, stamped, pinged; no IP or provider email in the answer", async () => {
  const c = await makeClient({ feeds: ["london"] });
  const body = feedBody(c.email);
  const before = sends.length;
  const r = await call("feed", body);
  assert.equal(r.body.status, "granted", JSON.stringify(r.body));
  assert.deepEqual(r.body.feed, { tierKey: "ld-beta-56", outcome: "created", licenseNumber: 1, subscriptionStatus: "active" });
  assertTrimmed(r.body, c);
  const act = (await db.query(`select admin_user_id, details_json from admin_actions where target_user_id = $1`, [c.id])).rows;
  assert.equal(act.length, 1);
  assert.equal(act[0].admin_user_id, actorId);
  assert.deepEqual(act[0].details_json, { tierKey: "ld-beta-56", via: "agent-api", idempotencyKey: body.idempotencyKey });
  assert.ok(sends.slice(before).some((s) => s.kind === "telemetry" && s.text.startsWith("agent-api feed: granted")));
});

test("the daily cap: 5 pending+granted per action per UTC day; refused/failed and yesterday's rows don't count", async () => {
  const filler = await makeClient();
  for (let i = 0; i < 5; i++) await seedLedger(newKey(), trialBody(filler.email, { days: i + 1 }), filler.id, i < 2 ? "pending" : "granted", 0);
  for (const st of ["refused", "failed"]) await seedLedger(newKey(), trialBody(filler.email, { days: 50 }), filler.id, st, 0);
  const c = await makeClient();
  const t0 = await counts();
  const plan = await call("trial", { mode: "plan", user: c.email, days: 7, feeds: ["london"] });
  assert.equal(plan.body.status, "would_refuse");
  assert.equal(plan.body.capRemainingToday, 0);
  const r = await call("trial", trialBody(c.email));
  assert.equal(r.body.status, "refused");
  assert.match(r.body.refusals?.[0] ?? "", /Daily cap reached: 5 trial grants per UTC day/);
  assert.equal((await counts()).licences, t0.licences);
  // The feed cap is separate.
  assert.equal((await call("feed", { mode: "plan", user: c.email, tierKey: "ld-beta-56" })).body.capRemainingToday, 5);
  // Yesterday's rows don't count.
  await db.query(`update agent_grants set created_at = created_at - interval '1 day'`);
  assert.equal((await call("trial", trialBody(c.email))).body.status, "granted");
});

test("the actor: with the seeded row gone, execute refuses before any write (C7)", async () => {
  const c = await makeClient();
  await db.query(`update users set email = 'parked-agent@example.invalid' where id = $1`, [actorId]);
  try {
    const t0 = await counts();
    const r = await call("trial", trialBody(c.email));
    assert.equal(r.body.status, "refused");
    assert.match(r.body.refusals?.join(" | ") ?? "", /seed-agent-actor\.sql/);
    assert.equal((await counts()).licences, t0.licences);
  } finally {
    await db.query(`update users set email = 'marcus-agent@horizonhft.internal' where id = $1`, [actorId]);
  }
});

test("execute: no such user is refused with no ledger row", async () => {
  const t0 = await counts();
  const r = await call("trial", trialBody("nobody-at-all@example.invalid"));
  assert.equal(r.body.status, "refused");
  assert.match(r.body.refusals?.[0] ?? "", /No user matches/);
  assert.deepEqual(await counts(), t0);
});
