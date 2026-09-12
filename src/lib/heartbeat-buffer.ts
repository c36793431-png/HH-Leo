import { getRedis } from "./rate-limit";

/**
 * Upstash-backed beat buffer for /v1/hb (marcus's redesign ruling, 2026-09-11).
 *
 * WHY: Postgres is off the beat path entirely. Neon autosuspends today — marcus's live read
 * on 2026-09-12T00:36Z showed `pg_postmaster_start_time` 6 minutes old — and at the real
 * cadence (14 licences x ~2 tabs x 20 beats/hr ~= 560 beats/hr, ~3 queries each) a beat that
 * touches the DB would keep the compute awake permanently. That is the whole plan's compute
 * allowance, and it is not a rate-limit question: the 600/hr per-key and 3600/hr per-IP caps
 * in rate-limit.ts still apply, but after this change they bound Redis, not Postgres.
 *
 * A beat writes one hash and one set member and returns. A cron (every 30 min) drains the
 * dirty set and does ONE upsert per key into client_heartbeats. Projected DB touches for
 * heartbeats: <= 48 runs/day, a handful of statements each, so the compute suspends normally
 * in between.
 *
 * KEY SHAPE: hb:<lk>:<hid>, with the dirty set hb:dirty holding "<lk>:<hid>".
 *
 * The hash also carries `lk` and `hid` as explicit fields. That is NOT redundant with the key
 * name: hid is client-supplied, arbitrary and up to 256 chars on an UNAUTHENTICATED endpoint,
 * so it can contain ":" and the key name cannot be split back into its two parts unambiguously.
 * The flush reads identity from the fields and never parses the member.
 *
 * NULL SENTINEL: every telemetry field is written on every beat, with "" meaning "this beat did
 * not carry the field". Necessary because the hash SURVIVES a flush (only `beats` is decremented),
 * so a field left unwritten would carry an older beat's value forward — and 0085's contract is
 * "what this (key, hwid) reported at last_seen", not "last known value". "" is unambiguous here:
 * the route's optionalString/optionalJson already map empty input to null, so "" is never a
 * legitimate value for v/eh/ip/sp/raw, and optionalBool never produces it for d1/d2/d3.
 */

/** Matches 0085's 7-day practical retention for an idle (key, hwid); a hash that stops beating expires. */
const HASH_TTL_SECONDS = 7 * 24 * 60 * 60;

export const DIRTY_SET_KEY = "hb:dirty";

export function heartbeatHashKey(licenseKey: string, hwid: string): string {
  return `hb:${licenseKey}:${hwid}`;
}

export function dirtyMember(licenseKey: string, hwid: string): string {
  return `${licenseKey}:${hwid}`;
}

export interface BufferedBeat {
  licenseKey: string;
  hwid: string;
  clientVersion: string | null;
  d1: boolean | null;
  d2: boolean | null;
  d3: boolean | null;
  /** Already JSON-serialised, or null. */
  sp: string | null;
  exeHash: string | null;
  ip: string | null;
  /** Already JSON-serialised body of this beat, or null when it exceeded the cap. */
  raw: string | null;
}

/** "" is the null sentinel — see the header. */
function text(value: string | null): string {
  return value ?? "";
}

function bool(value: boolean | null): string {
  return value === null ? "" : value ? "true" : "false";
}

// Redis being down must not turn into a log flood: 560 beats/hr would each emit a line.
// One line per minute per instance is enough to see it in platform logs.
const LOG_THROTTLE_MS = 60_000;
let lastRedisErrorLoggedAt = 0;

function logRedisFailure(where: string, err: unknown): void {
  const now = Date.now();
  if (now - lastRedisErrorLoggedAt < LOG_THROTTLE_MS) return;
  lastRedisErrorLoggedAt = now;
  console.error(`/v1/hb: redis unavailable (${where})`, err);
}

/**
 * Buffer one beat. Never throws and never touches Postgres: on any Redis failure the beat is
 * dropped and the caller still answers 204 (marcus's ruling — no DB fallback, because a
 * fallback is exactly the compute the redesign removes).
 *
 * Returns true when the beat was buffered, false when it was dropped, so the route can tell
 * the two apart in logs without changing its response.
 */
export async function bufferBeat(beat: BufferedBeat): Promise<boolean> {
  const redis = getRedis();
  if (!redis) return false; // not configured (local dev) — same posture as the limiters

  const key = heartbeatHashKey(beat.licenseKey, beat.hwid);
  const seenAt = new Date().toISOString();

  try {
    await redis
      .pipeline()
      // Identity, so the flush never has to split the key name back apart.
      .hset(key, {
        lk: beat.licenseKey,
        hid: beat.hwid,
        v: text(beat.clientVersion),
        d1: bool(beat.d1),
        d2: bool(beat.d2),
        d3: bool(beat.d3),
        sp: text(beat.sp),
        eh: text(beat.exeHash),
        ip: text(beat.ip),
        raw: text(beat.raw),
        last_seen: seenAt,
      })
      // first_seen is set once and never overwritten, so the flush can insert an accurate
      // first_seen instead of the row-creation time up to one flush window later.
      .hsetnx(key, "first_seen", seenAt)
      .hincrby(key, "beats", 1)
      .sadd(DIRTY_SET_KEY, dirtyMember(beat.licenseKey, beat.hwid))
      .expire(key, HASH_TTL_SECONDS)
      .exec();
    return true;
  } catch (err) {
    logRedisFailure("bufferBeat", err);
    return false;
  }
}

/** One (key, hwid)'s buffered state, as the flush sees it. */
export interface DrainedBeat {
  member: string;
  licenseKey: string;
  hwid: string;
  beats: number;
  lastSeen: Date;
  firstSeen: Date;
  clientVersion: string | null;
  d1: boolean | null;
  d2: boolean | null;
  d3: boolean | null;
  sp: string | null;
  exeHash: string | null;
  ip: string | null;
  raw: string | null;
}

/**
 * @upstash/redis deserialises responses, so a field whose value happens to be valid JSON
 * comes back parsed. Normalise every read back to "string or null", treating the ""
 * sentinel and a genuinely missing field identically.
 */
function readText(value: unknown): string | null {
  if (value === undefined || value === null) return null;
  if (typeof value === "string") return value.length > 0 ? value : null;
  return String(value);
}

/** Same, but for the two jsonb columns: hand Postgres a JSON document or nothing at all. */
function readJson(value: unknown): string | null {
  if (value === undefined || value === null) return null;
  if (typeof value === "string") {
    if (value.length === 0) return null;
    try {
      JSON.parse(value);
      return value;
    } catch {
      return null; // not parseable jsonb — storing it would fail the insert, not just this field
    }
  }
  try {
    return JSON.stringify(value);
  } catch {
    return null;
  }
}

function readBool(value: unknown): boolean | null {
  if (value === undefined || value === null || value === "") return null;
  if (typeof value === "boolean") return value;
  if (typeof value === "number") return value !== 0;
  if (typeof value === "string") {
    const normalized = value.trim().toLowerCase();
    if (normalized === "true" || normalized === "1") return true;
    if (normalized === "false" || normalized === "0") return false;
  }
  return null;
}

function readDate(value: unknown, fallback: Date): Date {
  const text = readText(value);
  if (!text) return fallback;
  const parsed = new Date(text);
  return Number.isNaN(parsed.getTime()) ? fallback : parsed;
}

function readInt(value: unknown): number {
  if (typeof value === "number") return Number.isFinite(value) ? Math.trunc(value) : 0;
  const text = readText(value);
  if (!text) return 0;
  const parsed = Number.parseInt(text, 10);
  return Number.isFinite(parsed) ? parsed : 0;
}

/**
 * SPOP up to `limit` dirty members and read each one's hash. Members whose hash has expired
 * or carries no identity are skipped and NOT re-queued — there is nothing left to write.
 */
export async function drainDirty(limit: number): Promise<DrainedBeat[]> {
  const redis = getRedis();
  if (!redis) return [];

  const members: string[] = [];
  while (members.length < limit) {
    const batch = await redis.spop<string[]>(DIRTY_SET_KEY, Math.min(100, limit - members.length));
    const popped = Array.isArray(batch) ? batch : batch ? [batch] : [];
    if (popped.length === 0) break;
    members.push(...popped);
  }
  if (members.length === 0) return [];

  const drained: DrainedBeat[] = [];
  for (const member of members) {
    const hash = await redis.hgetall<Record<string, unknown>>(`hb:${member}`);
    if (!hash) continue; // hash expired out from under the dirty member
    const licenseKey = readText(hash.lk);
    const hwid = readText(hash.hid);
    if (!licenseKey || !hwid) continue; // no identity, nothing upsertable
    const lastSeen = readDate(hash.last_seen, new Date());
    drained.push({
      member,
      licenseKey,
      hwid,
      beats: readInt(hash.beats),
      lastSeen,
      firstSeen: readDate(hash.first_seen, lastSeen),
      clientVersion: readText(hash.v),
      d1: readBool(hash.d1),
      d2: readBool(hash.d2),
      d3: readBool(hash.d3),
      sp: readJson(hash.sp),
      exeHash: readText(hash.eh),
      ip: readText(hash.ip),
      raw: readJson(hash.raw),
    });
  }
  return drained;
}

/**
 * Subtract exactly the beats that were written to Postgres, keeping the rest of the hash so
 * the next beat still diffs against it.
 *
 * WHY HINCRBY AND NOT HDEL (marcus's ruling, superseding "DEL the `beats` field only" — the
 * intent was "clear the count"): a beat landing between drainDirty()'s HGETALL and this call
 * increments `beats` after the flush has already read it. HDEL would remove that beat's
 * increment along with the flushed ones, so beat_count would undercount by whatever arrived in
 * that window. Subtracting the exact number flushed leaves the newcomer's increment in place,
 * and that beat has already re-SADDed its member, so the next run picks it up and counts it.
 * Same single command, no window.
 *
 * `flushed` is the `beats` value the flush actually wrote; 0 means there is nothing to subtract.
 */
export async function clearBeatCount(licenseKey: string, hwid: string, flushed: number): Promise<void> {
  const redis = getRedis();
  if (!redis || flushed <= 0) return;
  await redis.hincrby(heartbeatHashKey(licenseKey, hwid), "beats", -flushed);
}

/** Put members back on the dirty set after a failed flush, so the next run retries them. */
export async function requeue(members: string[]): Promise<void> {
  const redis = getRedis();
  if (!redis || members.length === 0) return;
  // sadd's signature wants at least one member positionally, hence the split.
  const [first, ...rest] = members;
  try {
    await redis.sadd(DIRTY_SET_KEY, first, ...rest);
  } catch (err) {
    logRedisFailure("requeue", err);
  }
}
