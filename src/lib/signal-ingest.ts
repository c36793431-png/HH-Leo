import { createHash, timingSafeEqual } from "crypto";
import type { PoolClient } from "@neondatabase/serverless";
import { pool, type Db } from "./db";
import { signalInstrument } from "./signal-instruments";
import { signalsHostOk } from "./horizonone-host";

/** POST /api/signals/ingest/[source], minus NextResponse (Axiom signals dashboard S2a; plan
 * docs/specs/axiom-signals-dashboard-plan.md section 4 at 0e61f2c). A source registers its daily calls and
 * later sends the prices; the portal stores them in signal_calls (0110) and is the only scorer (R4 m67429).
 *
 * Layers, outermost first, each only if every one above it passed (fable m67417): production only, then the
 * horizonone.horizonhft.com host (fable S3 m68780), then a known and configured source, then the source's IP if one is set, then the bearer token's sha256 in constant
 * time; only then the body, strict, any failure 400 with nothing written; then one transaction for the whole
 * batch, any 409 rolls all of it back. */

type Env = Record<string, string | undefined>;

export interface SignalSource {
  /** Env var holding the sha256 hex of this source's token. A token is bound to its source. */
  tokenEnv: string;
  /** Env var holding the one IP allowed to post for this source; unset = no IP rule (axiom: R7 m67429). */
  ipEnv: string;
  /** The call window in UTC hours on sessionDate, [open, close). Derived here, never sent (N3, m67474). */
  windowUtcH: readonly [number, number];
}

/** Adding a source = a reviewed commit here plus one env var, no migration (fable C2 m67410). */
export const SIGNAL_SOURCES: Readonly<Record<string, SignalSource>> = {
  axiom: { tokenEnv: "SIGNAL_INGEST_SHA256_AXIOM", ipEnv: "SIGNAL_INGEST_ALLOWED_IP_AXIOM", windowUtcH: [6, 21] },
};

export const MAX_BODY_BYTES = 64 * 1024;
export const MAX_CALLS = 200;
/** One pg_advisory_xact_lock key ("HHSI"): ingests run one at a time, so two posts of one new call cannot both
 * find no row and both insert. A day's traffic is one post per call plus the backfill loop. */
export const SIGNAL_INGEST_LOCK_KEY = 0x48485349;
/** Prices are handled as Math.round(px * 1e6) integers and stored at 6 dp (fable N4 m67474, A1 m67483). */
const PX_SCALE = 1_000_000;
const MIN_TOKEN_CHARS = 32;

/** The 0110 CHECK on signal_calls.source. */
const SOURCE_RE = /^[a-z][a-z0-9-]{1,31}$/;
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const UTC_TS_RE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{1,3})?Z$/;
const BODY_FIELDS = ["source", "calls"];
const CALL_FIELDS = ["symbol", "sessionDate", "direction", "entryPx", "entryBarTs", "exitPx", "exitBarTs", "meta"];
const DIRECTIONS = ["up", "down", "neutral"] as const;
/** meta.source (fable R8 m67446, kept m67483). Not the source column. */
const META_SOURCES = ["card", "backfill"];

export type SignalDirection = (typeof DIRECTIONS)[number];
export type SignalOutcome = "right" | "wrong" | "flat";

export interface SignalCallInput {
  symbol: string;
  sessionDate: string;
  direction: SignalDirection;
  entryTs: Date;
  exitTs: Date;
  /** Math.round(entryPx * 1e6). */
  entryI?: number;
  entryBarTs?: Date;
  /** Math.round(exitPx * 1e6). */
  exitI?: number;
  exitBarTs?: Date;
  meta?: Record<string, unknown>;
}

export interface SignalIngestCounts {
  inserted: number;
  scored: number;
  filled: number;
  unchanged: number;
}

export interface SignalIngestError {
  error: string;
  index?: number;
  symbol?: string;
}

export interface SignalIngestResult {
  status: number;
  body: SignalIngestCounts | SignalIngestError;
}

/** One code and one body for a bad source, an unknown one, an unconfigured one and a bad token (fable C2). */
const unauthorized = (): SignalIngestResult => ({ status: 401, body: { error: "unauthorized" } });

/** Before the body is read. null = let it through. */
export function gateSignalIngest(
  source: string,
  headers: Headers,
  env: Env = process.env,
  sources: Readonly<Record<string, SignalSource>> = SIGNAL_SOURCES
): SignalIngestResult | null {
  // Previews share the production database, so a preview must not write.
  if (env.VERCEL_ENV !== "production") return { status: 404, body: { error: "not found" } };
  // horizonone.horizonhft.com only, hard cutover (marcus m68767 Q3): any other host, portal.* included, gets the
  // same 404 before the token is looked at, so a valid token on the old URL is 404, not 401 (fable S3 m68780).
  if (!signalsHostOk(headers.get("host"), env)) return { status: 404, body: { error: "not found" } };

  const s = SOURCE_RE.test(source) && Object.hasOwn(sources, source) ? sources[source] : undefined;
  const expectedHex = s ? env[s.tokenEnv]?.trim().toLowerCase() : undefined;
  if (!s || !expectedHex || !/^[0-9a-f]{64}$/.test(expectedHex)) return unauthorized();

  const allowedIp = env[s.ipEnv]?.trim();
  if (allowedIp) {
    // Vercel overwrites x-forwarded-for, so its first hop is the caller (agent-api's rule).
    const ip = headers.get("x-forwarded-for")?.split(",")[0]?.trim();
    if (ip !== allowedIp) return { status: 403, body: { error: "forbidden" } };
  }

  const m = /^Bearer (\S+)$/.exec(headers.get("authorization") ?? "");
  if (!m || m[1].length < MIN_TOKEN_CHARS) return unauthorized();
  const presented = createHash("sha256").update(m[1], "utf8").digest();
  if (!timingSafeEqual(presented, Buffer.from(expectedHex, "hex"))) return unauthorized();
  return null;
}

/** Math.round(px * 1e6), or null for anything that is not a positive price. */
function scaledPrice(v: unknown): number | null {
  if (typeof v !== "number" || !Number.isFinite(v) || v <= 0) return null;
  const i = Math.round(v * PX_SCALE);
  return i >= 1 && Number.isSafeInteger(i) ? i : null;
}

/** An ISO-8601 UTC instant with seconds, that names a real calendar time. */
function utcInstant(v: unknown): Date | null {
  if (typeof v !== "string" || !UTC_TS_RE.test(v)) return null;
  const t = Date.parse(v);
  if (Number.isNaN(t)) return null;
  const d = new Date(t);
  return d.toISOString().slice(0, 19) === v.slice(0, 19) ? d : null;
}

function isRealDate(v: unknown): v is string {
  return typeof v === "string" && DATE_RE.test(v) && new Date(`${v}T00:00:00Z`).toISOString().slice(0, 10) === v;
}

/** n / scale as an exact decimal string, scale a power of ten: (108550, 100) -> "1085.50". */
export function scaledDecimal(n: number, scale: number): string {
  const dp = String(scale).length - 1;
  const abs = String(Math.abs(n)).padStart(dp + 1, "0");
  const s = dp ? `${abs.slice(0, -dp)}.${abs.slice(-dp)}` : abs;
  return n < 0 ? `-${s}` : s;
}

/** move and outcome from the two scaled prices, integers only (fable N4 m67474): d = exit - entry, sign
 * flipped for down; FLAT when |d| < bandInt (strict, coxwell's "under"); else right if d > 0, wrong if d < 0.
 * move = d / unit, exact, never rounded: a true 4.96-pip move stays 4.96 and stays FLAT. */
export function scoreMove(symbol: string, direction: "up" | "down", entryI: number, exitI: number): { move: string; outcome: SignalOutcome } {
  const inst = signalInstrument(symbol);
  if (!inst) throw new Error(`no instrument for ${symbol}`);
  const ui = Math.round(inst.unit * PX_SCALE);
  const d = (exitI - entryI) * (direction === "down" ? -1 : 1);
  const outcome: SignalOutcome = Math.abs(d) < inst.bandInt ? "flat" : d > 0 ? "right" : "wrong";
  return { move: scaledDecimal(d, ui), outcome };
}

type Parsed = { ok: true; calls: SignalCallInput[] } | { ok: false; error: SignalIngestError };

const bad = (error: string, index?: number, symbol?: string): Parsed => ({
  ok: false,
  error: { error, ...(index === undefined ? {} : { index }), ...(symbol === undefined ? {} : { symbol }) },
});

/** Strict: only the known fields, each checked; the first bad call refuses the whole batch. */
export function parseSignalBody(source: string, raw: string, sources: Readonly<Record<string, SignalSource>> = SIGNAL_SOURCES): Parsed {
  let body: unknown;
  try {
    body = JSON.parse(raw);
  } catch {
    return bad("body is not JSON");
  }
  if (!body || typeof body !== "object" || Array.isArray(body)) return bad("body must be a JSON object");
  const b = body as Record<string, unknown>;
  const unknownTop = Object.keys(b).filter((k) => !BODY_FIELDS.includes(k));
  if (unknownTop.length) return bad(`unknown field(s): ${unknownTop.join(", ")}`);
  if (b.source !== source) return bad("body source must equal the path source");
  if (!Array.isArray(b.calls) || b.calls.length < 1 || b.calls.length > MAX_CALLS) return bad(`calls must be an array of 1 to ${MAX_CALLS} calls`);

  if (!Object.hasOwn(sources, source)) return bad("unknown source");
  const [openH, closeH] = sources[source].windowUtcH;
  const calls: SignalCallInput[] = [];
  for (let i = 0; i < b.calls.length; i++) {
    const c = b.calls[i] as Record<string, unknown>;
    if (!c || typeof c !== "object" || Array.isArray(c)) return bad("each call must be a JSON object", i);
    const unknown = Object.keys(c).filter((k) => !CALL_FIELDS.includes(k));
    if (unknown.length) return bad(`unknown field(s): ${unknown.join(", ")}`, i);

    if (typeof c.symbol !== "string") return bad("symbol must be a string", i);
    if (!signalInstrument(c.symbol)) return bad("unknown symbol", i, c.symbol);
    if (!isRealDate(c.sessionDate)) return bad("sessionDate must be a real YYYY-MM-DD date", i);
    if (!(DIRECTIONS as readonly unknown[]).includes(c.direction)) return bad(`direction must be one of ${DIRECTIONS.join(", ")}`, i);
    const direction = c.direction as SignalDirection;

    const [y, mo, d] = c.sessionDate.split("-").map(Number);
    const entryTs = new Date(Date.UTC(y, mo - 1, d, openH));
    const exitTs = new Date(Date.UTC(y, mo - 1, d, closeH));
    const call: SignalCallInput = { symbol: c.symbol, sessionDate: c.sessionDate, direction, entryTs, exitTs };

    if (direction === "neutral" && (c.entryPx !== undefined || c.exitPx !== undefined)) {
      return bad("a neutral call carries no prices", i);
    }
    for (const [px, ts, key] of [
      ["entryPx", "entryBarTs", "entryI"],
      ["exitPx", "exitBarTs", "exitI"],
    ] as const) {
      if ((c[px] === undefined) !== (c[ts] === undefined)) return bad(`${px} and ${ts} are sent together or not at all`, i);
      if (c[px] === undefined) continue;
      const pi = scaledPrice(c[px]);
      if (pi === null) return bad(`${px} must be a positive number`, i);
      const bar = utcInstant(c[ts]);
      if (!bar) return bad(`${ts} must be an ISO-8601 UTC time with seconds`, i);
      // The bar is inside the window: [open, close).
      if (bar < entryTs || bar >= exitTs) return bad(`${ts} must be at or after ${entryTs.toISOString()} and before ${exitTs.toISOString()}`, i);
      call[key] = pi;
      call[ts] = bar;
    }

    if (c.meta !== undefined) {
      if (!c.meta || typeof c.meta !== "object" || Array.isArray(c.meta)) return bad("meta must be a JSON object", i);
      const m = c.meta as Record<string, unknown>;
      if (m.source !== undefined && !META_SOURCES.includes(m.source as string)) return bad(`meta.source must be one of ${META_SOURCES.join(", ")}`, i);
      call.meta = m;
    }
    calls.push(call);
  }
  return { ok: true, calls };
}

/** The full route: the gate, the body, then every call in one transaction. */
export async function handleSignalIngest(
  source: string,
  req: Pick<Request, "headers" | "text">,
  env: Env = process.env,
  sources: Readonly<Record<string, SignalSource>> = SIGNAL_SOURCES
): Promise<SignalIngestResult> {
  const denied = gateSignalIngest(source, req.headers, env, sources);
  if (denied) return denied;

  if (!(req.headers.get("content-type") ?? "").toLowerCase().startsWith("application/json")) {
    return { status: 400, body: { error: "content-type must be application/json" } };
  }
  if (Number(req.headers.get("content-length") ?? 0) > MAX_BODY_BYTES) return tooLarge();
  const raw = await req.text();
  if (Buffer.byteLength(raw, "utf8") > MAX_BODY_BYTES) return tooLarge();

  const parsed = parseSignalBody(source, raw, sources);
  if (!parsed.ok) return { status: 400, body: parsed.error };

  // connect() inside the try, so a database that cannot be reached still answers the JSON 500 and logs the
  // line below (fable m67577 call 1, marcus GO S2b.1 m67588).
  let client: PoolClient | undefined;
  try {
    client = await pool.connect();
    await client.query("begin");
    await client.query("select pg_advisory_xact_lock($1)", [SIGNAL_INGEST_LOCK_KEY]);
    const counts: SignalIngestCounts = { inserted: 0, scored: 0, filled: 0, unchanged: 0 };
    for (let i = 0; i < parsed.calls.length; i++) {
      const r = await applyCall(client, source, parsed.calls[i]);
      if (typeof r !== "string") {
        await client.query("rollback");
        return { status: r.status, body: { error: r.error, index: i } };
      }
      counts[r]++;
    }
    await client.query("commit");
    return { status: 200, body: counts };
  } catch (err) {
    await client?.query("rollback").catch(() => {});
    console.error("signal-ingest: failed", source, (err as Error)?.name, (err as Error)?.message);
    return { status: 500, body: { error: "internal error; nothing was written" } };
  } finally {
    client?.release();
  }
}

function tooLarge(): SignalIngestResult {
  return { status: 400, body: { error: `body over ${MAX_BODY_BYTES} bytes` } };
}

const sameTime = (a: Date, b: unknown) => a.getTime() === new Date(b as string).getTime();

/** One call, inside the batch's transaction. A field the post omits is not a change. The 409s are the
 * trigger's three families (plan section 3); prices compare as scaled integers (fable A1 m67483). */
async function applyCall(
  q: Db,
  source: string,
  c: SignalCallInput
): Promise<keyof SignalIngestCounts | { status: number; error: string }> {
  const found = await q.query(
    `select id, direction, (entry_px * 1000000)::bigint::text as entry_i, entry_bar_ts,
            (exit_px * 1000000)::bigint::text as exit_i, exit_bar_ts, outcome,
            meta is null as meta_null, meta is not distinct from $4::jsonb as meta_same
     from signal_calls where source = $1 and symbol = $2 and entry_ts = $3`,
    [source, c.symbol, c.entryTs.toISOString(), c.meta === undefined ? null : JSON.stringify(c.meta)]
  );
  const row = found.rows[0];

  if (!row) {
    if (c.exitI !== undefined && c.entryI === undefined) return { status: 400, error: "exitPx needs an entryPx, sent or stored" };
    const s = c.exitI !== undefined ? scoreMove(c.symbol, c.direction as "up" | "down", c.entryI!, c.exitI) : null;
    await q.query(
      `insert into signal_calls (source, symbol, session_date, direction, entry_ts, exit_ts,
                                 entry_px, entry_bar_ts, entry_px_at, exit_px, exit_bar_ts, move, outcome, scored_at, meta)
       values ($1, $2, $3, $4, $5, $6, $7::numeric, $8::timestamptz, case when $9 then now() end,
               $10::numeric, $11::timestamptz, $12::numeric, $13::text, case when $14 then now() end, $15::jsonb)`,
      [
        source,
        c.symbol,
        c.sessionDate,
        c.direction,
        c.entryTs.toISOString(),
        c.exitTs.toISOString(),
        c.entryI === undefined ? null : scaledDecimal(c.entryI, PX_SCALE),
        c.entryBarTs?.toISOString() ?? null,
        c.entryI !== undefined,
        s ? scaledDecimal(c.exitI!, PX_SCALE) : null,
        s ? c.exitBarTs!.toISOString() : null,
        s?.move ?? null,
        s?.outcome ?? null,
        s !== null,
        c.meta === undefined ? null : JSON.stringify(c.meta),
      ]
    );
    return "inserted";
  }

  // NEVER: direction (symbol and sessionDate are the key, the window is derived, source is the path).
  if (row.direction !== c.direction) return { status: 409, error: "direction differs from the stored call" };
  // FILL-ONLY: entry_px with entry_bar_ts, and meta.
  const storedEntryI = row.entry_i === null ? null : Number(row.entry_i);
  if (c.entryI !== undefined && storedEntryI !== null && c.entryI !== storedEntryI) {
    return { status: 409, error: "entryPx differs from the stored entry_px" };
  }
  if (c.entryBarTs && row.entry_bar_ts !== null && !sameTime(c.entryBarTs, row.entry_bar_ts)) {
    return { status: 409, error: "entryBarTs differs from the stored entry_bar_ts" };
  }
  if (c.meta !== undefined && !row.meta_null && !row.meta_same) return { status: 409, error: "meta differs from the stored meta" };
  // FROZEN-ONCE-SCORED: a rescoring is a correction, and corrections go to marcus as SQL.
  const scored = row.outcome !== null;
  if (scored && c.exitI !== undefined && c.exitI !== Number(row.exit_i)) return { status: 409, error: "exitPx differs from the stored exit_px" };
  if (scored && c.exitBarTs && !sameTime(c.exitBarTs, row.exit_bar_ts)) return { status: 409, error: "exitBarTs differs from the stored exit_bar_ts" };
  // N6 (m67474): no exit without an entry, sent or stored.
  if (!scored && c.exitI !== undefined && c.entryI === undefined && storedEntryI === null) {
    return { status: 400, error: "exitPx needs an entryPx, sent or stored" };
  }

  const fillEntry = c.entryI !== undefined && storedEntryI === null;
  const fillMeta = c.meta !== undefined && row.meta_null === true;
  const score = !scored && c.exitI !== undefined;
  if (!fillEntry && !fillMeta && !score) return "unchanged";

  // One statement, each column null -> value, so the 0110 trigger passes it by construction.
  const params: unknown[] = [row.id];
  const sets: string[] = [];
  const set = (col: string, v: unknown, cast: string) => {
    params.push(v);
    sets.push(`${col} = $${params.length}::${cast}`);
  };
  if (fillEntry) {
    set("entry_px", scaledDecimal(c.entryI!, PX_SCALE), "numeric");
    set("entry_bar_ts", c.entryBarTs!.toISOString(), "timestamptz");
    sets.push("entry_px_at = now()");
  }
  if (fillMeta) set("meta", JSON.stringify(c.meta), "jsonb");
  if (score) {
    const s = scoreMove(c.symbol, c.direction as "up" | "down", c.entryI ?? storedEntryI!, c.exitI!);
    set("exit_px", scaledDecimal(c.exitI!, PX_SCALE), "numeric");
    set("exit_bar_ts", c.exitBarTs!.toISOString(), "timestamptz");
    set("move", s.move, "numeric");
    set("outcome", s.outcome, "text");
    sets.push("scored_at = now()");
  }
  sets.push("updated_at = now()");
  await q.query(`update signal_calls set ${sets.join(", ")} where id = $1`, params);
  return score ? "scored" : "filled";
}
