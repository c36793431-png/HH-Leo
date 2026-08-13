import { pool } from "./db";

export interface GeoIpResult {
  country: string | null;
  city: string | null;
  isp: string | null;
  org: string | null;
}

const CACHE_TTL_DAYS = 30;
const PRIVATE_IP_RE = /^(10\.|127\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.|::1$|fc|fd)/i;

interface GeoIpCacheRow {
  ip: string;
  country: string | null;
  city: string | null;
  isp: string | null;
  org: string | null;
  resolved_at: Date;
}

/** ip-api.com free tier (45 req/min, no key). Results cached 30d in geoip_cache — ISPs
 * don't change daily, and burning the free-tier quota on every heartbeat isn't worth it. */
export async function resolveGeoIp(ip: string): Promise<GeoIpResult | null> {
  if (!ip || ip === "unknown" || PRIVATE_IP_RE.test(ip)) return null;

  const cached = await pool.query<GeoIpCacheRow>("select * from geoip_cache where ip = $1", [ip]);
  const row = cached.rows[0];
  if (row && Date.now() - row.resolved_at.getTime() < CACHE_TTL_DAYS * 24 * 60 * 60 * 1000) {
    return { country: row.country, city: row.city, isp: row.isp, org: row.org };
  }

  let result: GeoIpResult;
  try {
    const res = await fetch(
      `http://ip-api.com/json/${encodeURIComponent(ip)}?fields=status,country,city,isp,org`
    );
    if (!res.ok) return row ? { country: row.country, city: row.city, isp: row.isp, org: row.org } : null;
    const data = await res.json();
    if (data.status !== "success") {
      return row ? { country: row.country, city: row.city, isp: row.isp, org: row.org } : null;
    }
    result = {
      country: data.country ?? null,
      city: data.city ?? null,
      isp: data.isp ?? null,
      org: data.org ?? null,
    };
  } catch (err) {
    console.error("resolveGeoIp: lookup failed", err);
    return row ? { country: row.country, city: row.city, isp: row.isp, org: row.org } : null;
  }

  await pool.query(
    `insert into geoip_cache (ip, country, city, isp, org, resolved_at)
     values ($1, $2, $3, $4, $5, now())
     on conflict (ip) do update set
       country = excluded.country, city = excluded.city, isp = excluded.isp,
       org = excluded.org, resolved_at = now()`,
    [ip, result.country, result.city, result.isp, result.org]
  );
  return result;
}
