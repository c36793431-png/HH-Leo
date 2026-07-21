import { Ratelimit } from "@upstash/ratelimit";
import { Redis } from "@upstash/redis";

let keyLimiter: Ratelimit | null = null;
let ipLimiter: Ratelimit | null = null;
let initialized = false;

function init(): { keyLimiter: Ratelimit; ipLimiter: Ratelimit } | null {
  if (initialized) return keyLimiter && ipLimiter ? { keyLimiter, ipLimiter } : null;
  initialized = true;

  const url = process.env.UPSTASH_REDIS_REST_URL;
  const token = process.env.UPSTASH_REDIS_REST_TOKEN;
  if (!url || !token) return null; // Not configured (e.g. local dev) — callers fail open.

  const redis = new Redis({ url, token });
  keyLimiter = new Ratelimit({ redis, limiter: Ratelimit.slidingWindow(60, "1 h"), prefix: "rl:license-key" });
  ipLimiter = new Ratelimit({ redis, limiter: Ratelimit.slidingWindow(600, "1 h"), prefix: "rl:license-ip" });
  return { keyLimiter, ipLimiter };
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
