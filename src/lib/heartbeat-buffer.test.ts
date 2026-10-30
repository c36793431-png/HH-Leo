/* Run: npx tsx --test --experimental-test-module-mocks src/lib/heartbeat-buffer.test.ts
 *
 * What marcus GO'd on 2026-10-30 after the Upstash free-tier cap stopped every beat reaching Postgres
 * (client_heartbeats newest last_seen 10-18, and nothing said so for 12 days):
 *  1. The flush fails LOUD when it cannot read the buffer: "buffer unreachable" in the log and a non-2xx.
 *  2. The beat buffer's own failure log carries no licence key, hwid or IP.
 * A beat stays the five-command pipeline (a script is billed 1 + one per redis.call, so it would cost 6; Fable S1).
 *
 * The REAL @upstash/redis client runs here; only fetch is stubbed. The stub answers the way the 10-19 log line says
 * Upstash answered: a pipeline request gets 200 with a per-command error, any other request gets 400 with the same
 * error and, as @upstash/redis does, the request body appended after ", command was:".
 */
import { test, before, beforeEach, mock } from "node:test";
import assert from "node:assert/strict";

const CAP_ERROR = "ERR max requests limit exceeded. Limit: 500000, Usage: 500002";
const UPSTASH_URL = "https://upstash.test.invalid";
const LICENCE_KEY = "LK-SECRET-1234";

/** cap: per-command errors (auto-pipeline). http: the whole request answers 400, the path whose message appends ", command was: <body>". */
type Mode = "ok" | "cap" | "http";
let mode: Mode = "ok";
/** Every Redis command the code sent, as [COMMAND, ...args], in order. */
let commands: string[][] = [];
let logged: string[] = [];

async function upstashFetch(input: string | URL | Request, init?: RequestInit): Promise<Response> {
  const url = String(input instanceof Request ? input.url : input);
  assert.ok(url.startsWith(UPSTASH_URL), `unexpected fetch ${url}`);
  const raw = String(init?.body ?? "null");
  const body = JSON.parse(raw);
  const pipeline = url.endsWith("/pipeline") || url.endsWith("/multi-exec");
  const sent: string[][] = pipeline ? body : [body];
  commands.push(...sent.map((c) => c.map(String)));
  if (mode === "http") return Response.json({ error: CAP_ERROR }, { status: 400 });
  if (mode === "cap") {
    return pipeline
      ? Response.json(sent.map(() => ({ error: CAP_ERROR })))
      : Response.json({ error: CAP_ERROR }, { status: 400 });
  }
  // ok: every command succeeds (SPOP -> no members left). The client auto-pipelines, so a reply is an array per request.
  const result = () => ({ result: null });
  return pipeline ? Response.json(sent.map(result)) : Response.json(result());
}

/* eslint-disable @typescript-eslint/no-explicit-any */
before(() => {
  Object.assign(process.env, {
    UPSTASH_REDIS_REST_URL: UPSTASH_URL,
    UPSTASH_REDIS_REST_TOKEN: "test-token",
    NEON_DATABASE_URL: "postgres://unused",
    CRON_SECRET: "cron-secret",
  });
  (globalThis as any).fetch = upstashFetch;
  mock.module("@/lib/server-registration", { namedExports: { captureConnectionIp: async () => {} } });
  mock.module("@/lib/client-heartbeats", {
    namedExports: {
      resolveLicenseKey: async () => null,
      upsertBufferedHeartbeat: async () => {},
    },
  });
  console.error = (...args: unknown[]) => {
    logged.push(args.map((a) => (a instanceof Error ? a.message : String(a))).join(" "));
  };
  console.log = () => {};
});

beforeEach(() => {
  mode = "ok";
  commands = [];
  logged = [];
});

const beat = (over: Record<string, unknown> = {}) => ({
  licenseKey: LICENCE_KEY,
  hwid: "HW:1",
  clientVersion: "2.1",
  d1: true,
  d2: null,
  d3: false,
  sp: null,
  exeHash: null,
  ip: "203.0.113.7",
  raw: '{"lk":"x"}',
  ...over,
});

function flushRequest(auth = "Bearer cron-secret") {
  return new Request("https://portal.horizonhft.com/api/cron/flush-heartbeats", {
    headers: { authorization: auth },
  }) as any;
}

test("1: a beat is the five-command pipeline, in order, over the beat hash and the dirty set", async () => {
  const { bufferBeat } = await import("./heartbeat-buffer");
  assert.equal(await bufferBeat(beat()), true, logged.join(" | "));
  assert.deepEqual(
    commands.map((c) => c[0].toUpperCase()),
    ["HSET", "HSETNX", "HINCRBY", "SADD", "EXPIRE"]
  );
  assert.equal(commands[0][1], "hb:LK-SECRET-1234:HW:1");
  assert.deepEqual(commands[3].slice(1), ["hb:dirty", "LK-SECRET-1234:HW:1"]);
  assert.deepEqual(commands[4].slice(1), ["hb:LK-SECRET-1234:HW:1", String(7 * 24 * 60 * 60)]);
});

test("2: the HSET carries every field with '' as the null sentinel; HSETNX first_seen is the same instant as last_seen", async () => {
  const { bufferBeat } = await import("./heartbeat-buffer");
  await bufferBeat(beat());
  const pairs = commands[0].slice(2);
  assert.equal(pairs.length % 2, 0, "HSET args after the key are field/value pairs");
  const fields = Object.fromEntries(Array.from({ length: pairs.length / 2 }, (_, i) => [pairs[2 * i], pairs[2 * i + 1]]));
  assert.deepEqual(Object.keys(fields), ["lk", "hid", "v", "d1", "d2", "d3", "sp", "eh", "ip", "raw", "last_seen"]);
  assert.equal(fields.lk, LICENCE_KEY);
  assert.equal(fields.hid, "HW:1");
  assert.equal(fields.v, "2.1");
  assert.equal(fields.d1, "true");
  assert.equal(fields.d2, "", "null -> '' sentinel, so an older beat's value is overwritten");
  assert.equal(fields.d3, "false");
  assert.equal(fields.sp, "");
  const upper = (c: string[]) => [c[0].toUpperCase(), ...c.slice(1)];
  assert.deepEqual(upper(commands[1]).slice(0, 3), ["HSETNX", "hb:LK-SECRET-1234:HW:1", "first_seen"]);
  assert.equal(commands[1][3], fields.last_seen);
  assert.deepEqual(upper(commands[2]), ["HINCRBY", "hb:LK-SECRET-1234:HW:1", "beats", "1"]);
});

test("3: Upstash refuses -> bufferBeat drops the beat (false), does not throw, and the log has no licence key or IP", async () => {
  // This must stay the first test that makes bufferBeat fail: the log is throttled to one line a minute per process.
  mode = "http";
  const { bufferBeat } = await import("./heartbeat-buffer");
  assert.equal(await bufferBeat(beat()), false);
  assert.equal(logged.length, 1);
  assert.ok(logged[0].includes(CAP_ERROR), "the failure is logged");
  mode = "cap";
  assert.equal(await bufferBeat(beat()), false, "the per-command error path drops the beat too");
  assert.ok(!logged[0].includes(LICENCE_KEY) && !logged[0].includes("203.0.113.7"), `leaked into the log: ${logged[0]}`);
});

test("4: the flush FAILS LOUD when Upstash refuses: 'buffer unreachable' in the log and a non-2xx", async () => {
  mode = "cap";
  const route = await import("../app/api/cron/flush-heartbeats/route");
  const res = await route.GET(flushRequest());
  assert.equal(res.status, 503);
  assert.deepEqual(await res.json(), { error: "buffer unreachable" });
  assert.equal(logged.length, 1);
  assert.ok(logged[0].includes("buffer unreachable") && logged[0].includes(CAP_ERROR), logged[0]);
});

test("5: a healthy empty buffer is still a quiet 200 with keys=0 (loud only when it cannot look)", async () => {
  const route = await import("../app/api/cron/flush-heartbeats/route");
  const res = await route.GET(flushRequest());
  assert.equal(res.status, 200);
  assert.equal((await res.json()).keysFlushed, 0);
  assert.deepEqual(logged, []);
});

test("6: the flush still refuses a caller without the cron secret", async () => {
  const route = await import("../app/api/cron/flush-heartbeats/route");
  assert.equal((await route.GET(flushRequest("Bearer nope"))).status, 401);
});
