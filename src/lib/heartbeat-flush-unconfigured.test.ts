/* Run: npx tsx --test --experimental-test-module-mocks src/lib/heartbeat-flush-unconfigured.test.ts
 *
 * Own file because rate-limit.ts reads UPSTASH_REDIS_REST_* once, on first use; node --test gives each file its own
 * process, so this one can start with the env unset. That is the "Production scope removed" state of the 10-19 stopgap:
 * getRedis() is null, bufferBeat drops silently, and the flush used to answer 200 keys=0 as if nothing had beaten.
 */
import { test, before, mock } from "node:test";
import assert from "node:assert/strict";

const logged: string[] = [];

/* eslint-disable @typescript-eslint/no-explicit-any */
before(() => {
  delete process.env.UPSTASH_REDIS_REST_URL;
  delete process.env.UPSTASH_REDIS_REST_TOKEN;
  Object.assign(process.env, { NEON_DATABASE_URL: "postgres://unused", CRON_SECRET: "cron-secret" });
  mock.module("@/lib/server-registration", { namedExports: { captureConnectionIp: async () => {} } });
  mock.module("@/lib/client-heartbeats", {
    namedExports: { resolveLicenseKey: async () => null, upsertBufferedHeartbeat: async () => {} },
  });
  console.error = (...args: unknown[]) => {
    logged.push(args.map(String).join(" "));
  };
});

test("flush with Upstash not configured answers 503 'buffer unreachable', not a quiet 200 keys=0", async () => {
  const route = await import("../app/api/cron/flush-heartbeats/route");
  const res = await route.GET(
    new Request("https://portal.horizonhft.com/api/cron/flush-heartbeats", {
      headers: { authorization: "Bearer cron-secret" },
    }) as any
  );
  assert.equal(res.status, 503);
  assert.deepEqual(await res.json(), { error: "buffer unreachable" });
  assert.ok(logged.some((l) => l.includes("buffer unreachable") && l.includes("not configured")), logged.join("\n"));
});
