import { Ratelimit } from "@upstash/ratelimit";
import { Redis } from "@upstash/redis";

let redisClient: Redis | null = null;
let keyLimiter: Ratelimit | null = null;
let ipLimiter: Ratelimit | null = null;
// /v1/hft-alert: per-key windows per the spec (~20/min + 300/hr), separate per-IP cap
// since one IP can host many license keys (a trading box running multiple accounts).
let hftAlertKeyMinuteLimiter: Ratelimit | null = null;
let hftAlertKeyHourLimiter: Ratelimit | null = null;
let hftAlertIpLimiter: Ratelimit | null = null;
let initialized = false;

// /v1/hb has NO limiter (marcus m73346, after the 2026-10-19 outage). Every limit() call is a
// billed Upstash command whatever its threshold, so loosening the windows would have saved
// nothing; the two hb windows were 2 of the 7 commands a beat cost. They also bounded little:
// distinct hids under one IP still created a new hash per beat up to 3600/hr. Nothing now
// bounds how many beats or hashes a caller writes; the route's field caps bound each hash's
// size and heartbeat-buffer.ts's 7-day TTL its lifetime.

function init(): {
  keyLimiter: Ratelimit;
  ipLimiter: Ratelimit;
  hftAlertKeyMinuteLimiter: Ratelimit;
  hftAlertKeyHourLimiter: Ratelimit;
  hftAlertIpLimiter: Ratelimit;
} | null {
  if (initialized) {
    return keyLimiter && ipLimiter && hftAlertKeyMinuteLimiter && hftAlertKeyHourLimiter && hftAlertIpLimiter
      ? { keyLimiter, ipLimiter, hftAlertKeyMinuteLimiter, hftAlertKeyHourLimiter, hftAlertIpLimiter }
      : null;
  }
  initialized = true;

  const url = process.env.UPSTASH_REDIS_REST_URL;
  const token = process.env.UPSTASH_REDIS_REST_TOKEN;
  if (!url || !token) return null; // Not configured (e.g. local dev) — callers fail open.

  const redis = new Redis({ url, token });
  redisClient = redis;
  keyLimiter = new Ratelimit({ redis, limiter: Ratelimit.slidingWindow(60, "1 h"), prefix: "rl:license-key" });
  ipLimiter = new Ratelimit({ redis, limiter: Ratelimit.slidingWindow(600, "1 h"), prefix: "rl:license-ip" });
  hftAlertKeyMinuteLimiter = new Ratelimit({
    redis,
    limiter: Ratelimit.slidingWindow(20, "1 m"),
    prefix: "rl:hft-alert-key-min",
  });
  hftAlertKeyHourLimiter = new Ratelimit({
    redis,
    limiter: Ratelimit.slidingWindow(300, "1 h"),
    prefix: "rl:hft-alert-key-hour",
  });
  hftAlertIpLimiter = new Ratelimit({
    redis,
    limiter: Ratelimit.slidingWindow(60, "1 m"),
    prefix: "rl:hft-alert-ip",
  });
  return { keyLimiter, ipLimiter, hftAlertKeyMinuteLimiter, hftAlertKeyHourLimiter, hftAlertIpLimiter };
}

/**
 * The one Upstash client this process owns — the same instance the limiters above use.
 * Exported so the /v1/hb beat buffer (src/lib/heartbeat-buffer.ts) can reuse it rather than
 * constructing a second connection to the same database (marcus's ruling, 2026-09-11).
 * Returns null when Upstash isn't configured, exactly like init(); every caller must treat
 * that as "no Redis" and degrade, never throw.
 */
export function getRedis(): Redis | null {
  init();
  return redisClient;
}

// One line per minute per instance: a failing Upstash would otherwise log once per request.
const LOG_THROTTLE_MS = 60_000;
let lastLimiterErrorLoggedAt = 0;

/**
 * FAIL OPEN (marcus m73346). On 2026-10-19 the Upstash monthly command cap ran out, every
 * limit() threw "ERR max requests limit exceeded", and the licence routes answered 500 for
 * ~9.5h. A limiter that cannot answer now lets the request through: the same posture as
 * Upstash not being configured (init() returns null) and as the library's own 5s timeout,
 * which already resolves success. Only an actual verdict from Redis can refuse a request.
 */
async function allowed(where: string, checks: () => Promise<{ success: boolean }>[]): Promise<boolean> {
  try {
    const results = await Promise.all(checks());
    return results.every((r) => r.success);
  } catch (err) {
    const now = Date.now();
    if (now - lastLimiterErrorLoggedAt >= LOG_THROTTLE_MS) {
      lastLimiterErrorLoggedAt = now;
      console.error(`rate-limit: limiter unavailable, failing open (${where})`, err);
    }
    return true;
  }
}

/** Per-license-key + per-source-IP counters for /api/verify-license. In-memory counters don't work across serverless invocations, hence Upstash. */
export async function checkVerifyLicenseRateLimit(licenseKey: string, ip: string): Promise<boolean> {
  const limiters = init();
  if (!limiters) return true;
  return allowed("verify-license", () => [limiters.keyLimiter.limit(licenseKey), limiters.ipLimiter.limit(ip)]);
}

/** /v1/validate — one-shot activation call, reuses the same tight windows as verify-license. */
export async function checkValidateRateLimit(licenseKey: string, ip: string): Promise<boolean> {
  return checkVerifyLicenseRateLimit(licenseKey, ip);
}

/** /v1/hft-alert — fire-and-forget alert DMs, capped both per-license-key (minute + hour
 * windows) and per-IP so a leaked key or a runaway client can't turn into a Telegram spam
 * cannon or blow through the bot's own rate limits. */
export async function checkHftAlertRateLimit(licenseKey: string, ip: string): Promise<boolean> {
  const limiters = init();
  if (!limiters) return true;
  return allowed("hft-alert", () => [
    limiters.hftAlertKeyMinuteLimiter.limit(licenseKey),
    limiters.hftAlertKeyHourLimiter.limit(licenseKey),
    limiters.hftAlertIpLimiter.limit(ip),
  ]);
}
