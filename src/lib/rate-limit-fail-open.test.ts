/* Run: npx tsx --test --experimental-test-module-mocks src/lib/rate-limit-fail-open.test.ts
 *
 * The 2026-10-19 licence outage (~9.5h of 500s): the Upstash free-tier monthly command cap ran out, every
 * Ratelimit.limit() threw "Command failed: ERR max requests limit exceeded. Limit: 500000, Usage: 500002", and
 * /v1/validate, /v1/hb, /v1/hft-alert and /api/verify-license all answered 500 (marcus m73346).
 *
 * The REAL @upstash/redis client and the REAL @upstash/ratelimit run here; only fetch is stubbed. The stub answers
 * the way that log line says Upstash answered: a pipeline request gets 200 with a per-command error (that is the
 * auto-pipeline path, which is what prefixes "Command failed: "), any other request gets 400 with the same error.
 * The licence lookup, the connection-IP capture and the Telegram bot are mocked; nothing here touches Postgres.
 */
import { test, before, beforeEach, mock } from "node:test";
import assert from "node:assert/strict";

const CAP_ERROR = "ERR max requests limit exceeded. Limit: 500000, Usage: 500002";
const UPSTASH_URL = "https://upstash.test.invalid";

/** mixed: the licence-key window denies and every other command gets the cap error, in the same pipeline.
 *  http: the whole request answers 400, the path whose message appends ", command was: <request body>". */
type Mode = "cap" | "ok" | "deny" | "mixed" | "http";
let mode: Mode = "cap";
/** Every Redis command the code sent, as [COMMAND, ...args], in order. */
let commands: string[][] = [];
let logged: string[] = [];

/** Sliding-window script reply: [remaining, effective limit]; the library reads remaining < 0 as a denial. */
function reply(cmd: string[]): unknown {
  const name = cmd[0].toUpperCase();
  if (name === "EVALSHA" || name === "EVAL") return mode === "deny" ? [-1, 60] : [59, 60];
  if (name === "HSET" || name === "HSETNX" || name === "HINCRBY" || name === "SADD" || name === "EXPIRE") return 1;
  return null;
}

async function upstashFetch(input: string | URL | Request, init?: RequestInit): Promise<Response> {
  const url = String(input instanceof Request ? input.url : input);
  assert.ok(url.startsWith(UPSTASH_URL), `unexpected fetch ${url}`);
  const body = JSON.parse(String(init?.body ?? "null"));
  const pipeline = url.endsWith("/pipeline") || url.endsWith("/multi-exec");
  const sent: string[][] = pipeline ? body : [body];
  commands.push(...sent.map((c) => c.map(String)));
  if (mode === "http") return Response.json({ error: CAP_ERROR }, { status: 400 });
  if (mode === "mixed" && pipeline) {
    return Response.json(
      sent.map((c) => (c.some((a) => String(a).startsWith("rl:license-key:")) ? { result: [-1, 60] } : { error: CAP_ERROR }))
    );
  }
  if (mode === "cap" || mode === "mixed") {
    return pipeline
      ? Response.json(sent.map(() => ({ error: CAP_ERROR })))
      : Response.json({ error: CAP_ERROR }, { status: 400 });
  }
  return pipeline ? Response.json(sent.map((c) => ({ result: reply(c) }))) : Response.json({ result: reply(sent[0]) });
}

/* eslint-disable @typescript-eslint/no-explicit-any */
before(() => {
  Object.assign(process.env, {
    UPSTASH_REDIS_REST_URL: UPSTASH_URL,
    UPSTASH_REDIS_REST_TOKEN: "test-token",
    NEON_DATABASE_URL: "postgres://unused",
  });
  (globalThis as any).fetch = upstashFetch;
  mock.module("@/lib/licenses", {
    namedExports: {
      verifyLicenseKey: async (key: string) =>
        key === "KEY-ACTIVE"
          ? { status: "active", licenseId: null, expiresAt: new Date("2027-01-01T00:00:00Z") }
          : { status: "not_found", licenseId: null, expiresAt: null },
      getAlertTargetForLicense: async () => null,
    },
  });
  mock.module("@/lib/server-registration", { namedExports: { captureConnectionIp: async () => {} } });
  console.error = (...args: unknown[]) => {
    logged.push(args.map((a) => (a instanceof Error ? a.message : String(a))).join(" "));
  };
});

beforeEach(() => {
  mode = "cap";
  commands = [];
  logged = [];
});

function post(path: string, body: unknown, headers: Record<string, string> = {}) {
  return new Request(`https://portal.horizonhft.com${path}`, {
    method: "POST",
    headers: { "content-type": "application/json", "x-forwarded-for": "203.0.113.7", ...headers },
    body: JSON.stringify(body),
  }) as any;
}

const evals = () => commands.filter((c) => c[0].toUpperCase() === "EVALSHA" || c[0].toUpperCase() === "EVAL");

test("1: the stub reproduces the 10-19 failure: the real limiter throws the exact prod error", async () => {
  const { Ratelimit } = await import("@upstash/ratelimit");
  const { Redis } = await import("@upstash/redis");
  const limiter = new Ratelimit({
    redis: new Redis({ url: UPSTASH_URL, token: "t" }),
    limiter: Ratelimit.slidingWindow(60, "1 h"),
    prefix: "rl:test",
  });
  await assert.rejects(limiter.limit("k"), (err: Error) => err.message === `Command failed: ${CAP_ERROR}`);
});

test("2: cap hit -> /v1/validate still answers (unknown key 404 not_found, not 500)", async () => {
  const route = await import("../app/v1/validate/route");
  const res = await route.POST(post("/v1/validate", { licensekey: "KEY-NOPE", hardwareid: "HW", currentversion: "2.1" }));
  assert.equal(res.status, 404);
  assert.deepEqual(await res.json(), { status: "not_found" });
  assert.ok(evals().length > 0, "the limiter really was called and really failed");
  assert.ok(logged.some((l) => l.includes(CAP_ERROR)), "the failure is logged, not swallowed");
});

test("3: cap hit -> /api/verify-license still answers (active key 200)", async () => {
  const route = await import("../app/api/verify-license/route");
  const res = await route.POST(post("/api/verify-license", { license_key: "KEY-ACTIVE" }));
  assert.equal(res.status, 200);
  assert.equal((await res.json()).status, "active");
});

test("4: cap hit -> /v1/hft-alert still answers (unknown key 404, not 500)", async () => {
  const route = await import("../app/v1/hft-alert/route");
  const res = await route.POST(
    post("/v1/hft-alert", { alert_type: "t", message: "m" }, { authorization: "Bearer KEY-NOPE" })
  );
  assert.equal(res.status, 404);
});

test("5: cap hit -> /v1/hb still answers 204", async () => {
  const route = await import("../app/v1/hb/route");
  const res = await route.POST(post("/v1/hb", { lk: "KEY-ACTIVE", hid: "HW", v: "2.1" }));
  assert.equal(res.status, 204);
});

test("6: /v1/hb sends no limiter command at all; a beat costs only the buffer pipeline", async () => {
  mode = "ok";
  const route = await import("../app/v1/hb/route");
  const res = await route.POST(post("/v1/hb", { lk: "KEY-ACTIVE", hid: "HW", v: "2.1" }));
  assert.equal(res.status, 204);
  assert.deepEqual(evals(), []);
  assert.deepEqual(
    commands.map((c) => c[0].toUpperCase()),
    ["HSET", "HSETNX", "HINCRBY", "SADD", "EXPIRE"]
  );
});

test("7: fail-open is for errors only: a real limiter verdict still answers 429", async () => {
  mode = "deny";
  const route = await import("../app/v1/validate/route");
  const res = await route.POST(post("/v1/validate", { licensekey: "KEY-NOPE", hardwareid: "HW" }));
  assert.equal(res.status, 429);
  const alert = await import("../app/v1/hft-alert/route");
  const res2 = await alert.POST(post("/v1/hft-alert", { alert_type: "t", message: "m" }, { authorization: "Bearer KEY-NOPE" }));
  assert.equal(res2.status, 429);
});

test("8: a healthy limiter lets the request through", async () => {
  mode = "ok";
  const route = await import("../app/api/verify-license/route");
  // Fresh key and IP: test 7's denials sit in the limiter's in-memory block cache for the window.
  const res = await route.POST(post("/api/verify-license", { license_key: "KEY-OTHER" }, { "x-forwarded-for": "198.51.100.9" }));
  assert.equal(res.status, 404);
  assert.equal(evals().length, 2, "key + ip windows both consulted");
});

test("9: one window denies while another errors in the same call -> still 429 (Fable S1)", async () => {
  mode = "mixed";
  const route = await import("../app/api/verify-license/route");
  // Fresh key and IP, so the verdict comes from Redis and not from an earlier test's block cache.
  const res = await route.POST(post("/api/verify-license", { license_key: "KEY-MIXED" }, { "x-forwarded-for": "192.0.2.44" }));
  assert.equal(res.status, 429);
  assert.equal(evals().length, 2, "both windows really reached Redis");
});

test("10: the failure log carries no licence key and no IP (Fable N1)", async (t) => {
  mode = "http";
  // Step past the once-a-minute throttle that test 2's line armed, so this test really logs.
  const later = Date.now() + 120_000;
  t.mock.method(Date, "now", () => later);
  const route = await import("../app/api/verify-license/route");
  const res = await route.POST(
    post("/api/verify-license", { license_key: "KEY-SECRET-77" }, { "x-forwarded-for": "198.51.100.77" })
  );
  assert.equal(res.status, 404);
  assert.equal(logged.length, 1);
  assert.ok(logged[0].includes(CAP_ERROR), "the error itself is still logged");
  assert.ok(!logged[0].includes("KEY-SECRET-77"), `licence key in log: ${logged[0]}`);
  assert.ok(!logged[0].includes("198.51.100.77"), `IP in log: ${logged[0]}`);
});
