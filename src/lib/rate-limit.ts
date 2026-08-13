import { Ratelimit } from "@upstash/ratelimit";
import { Redis } from "@upstash/redis";

let keyLimiter: Ratelimit | null = null;
let ipLimiter: Ratelimit | null = null;
// Heartbeat is high-frequency by design (the client beats on a timer), so it gets its
// own, looser windows keyed independently from the one-shot /v1/validate path.
let hbKeyLimiter: Ratelimit | null = null;
let hbIpLimiter: Ratelimit | null = null;
// /v1/hft-alert: per-key windows per the spec (~20/min + 300/hr), separate per-IP cap
// since one IP can host many license keys (a trading box running multiple accounts).
let hftAlertKeyMinuteLimiter: Ratelimit | null = null;
let hftAlertKeyHourLimiter: Ratelimit | null = null;
let hftAlertIpLimiter: Ratelimit | null = null;
let initialized = false;

function init(): {
  keyLimiter: Ratelimit;
  ipLimiter: Ratelimit;
  hbKeyLimiter: Ratelimit;
  hbIpLimiter: Ratelimit;
  hftAlertKeyMinuteLimiter: Ratelimit;
  hftAlertKeyHourLimiter: Ratelimit;
  hftAlertIpLimiter: Ratelimit;
} | null {
  if (initialized) {
    return keyLimiter &&
      ipLimiter &&
      hbKeyLimiter &&
      hbIpLimiter &&
      hftAlertKeyMinuteLimiter &&
      hftAlertKeyHourLimiter &&
      hftAlertIpLimiter
      ? { keyLimiter, ipLimiter, hbKeyLimiter, hbIpLimiter, hftAlertKeyMinuteLimiter, hftAlertKeyHourLimiter, hftAlertIpLimiter }
      : null;
  }
  initialized = true;

  const url = process.env.UPSTASH_REDIS_REST_URL;
  const token = process.env.UPSTASH_REDIS_REST_TOKEN;
  if (!url || !token) return null; // Not configured (e.g. local dev) — callers fail open.

  const redis = new Redis({ url, token });
  keyLimiter = new Ratelimit({ redis, limiter: Ratelimit.slidingWindow(60, "1 h"), prefix: "rl:license-key" });
  ipLimiter = new Ratelimit({ redis, limiter: Ratelimit.slidingWindow(600, "1 h"), prefix: "rl:license-ip" });
  hbKeyLimiter = new Ratelimit({ redis, limiter: Ratelimit.slidingWindow(120, "1 h"), prefix: "rl:hb-key" });
  hbIpLimiter = new Ratelimit({ redis, limiter: Ratelimit.slidingWindow(1200, "1 h"), prefix: "rl:hb-ip" });
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
  return { keyLimiter, ipLimiter, hbKeyLimiter, hbIpLimiter, hftAlertKeyMinuteLimiter, hftAlertKeyHourLimiter, hftAlertIpLimiter };
}

/** Per-license-key + per-source-IP counters for /api/verify-license. In-memory counters don't work across serverless invocations, hence Upstash. */
export async function checkVerifyLicenseRateLimit(licenseKey: string, ip: string): Promise<boolean> {
  const limiters = init();
  if (!limiters) return true;
  const [keyResult, ipResult] = await Promise.all([
    limiters.keyLimiter.limit(licenseKey),
    limiters.ipLimiter.limit(ip),
  ]);
  return keyResult.success && ipResult.success;
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
  const [keyMinuteResult, keyHourResult, ipResult] = await Promise.all([
    limiters.hftAlertKeyMinuteLimiter.limit(licenseKey),
    limiters.hftAlertKeyHourLimiter.limit(licenseKey),
    limiters.hftAlertIpLimiter.limit(ip),
  ]);
  return keyMinuteResult.success && keyHourResult.success && ipResult.success;
}

/** /v1/hb — looser windows since the client heartbeats on a timer. */
export async function checkHeartbeatRateLimit(licenseKey: string, ip: string): Promise<boolean> {
  const limiters = init();
  if (!limiters) return true;
  const [keyResult, ipResult] = await Promise.all([
    limiters.hbKeyLimiter.limit(licenseKey),
    limiters.hbIpLimiter.limit(ip),
  ]);
  return keyResult.success && ipResult.success;
}
