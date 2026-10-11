/** Feed auto-provision, portal side (coxwell GO via marcus m62546; Fable's design m62433, scope marcus m62718).
 * A provider box PULLS the effective-active client IP set for its tiers and writes back what it applied. The portal
 * holds no box credential and pushes nothing. Everything the box gets is signed (Ed25519, response-signing.ts) over
 * canonical JSON with issued_at and a serial that rises on every response, so a replayed or stale body is refusable.
 * The token authenticates one box; the signature protects the body in transit. Neither protects against a
 * compromised portal: that residual is the box's delta caps and protected set (Fable m62433 items 1 and 3). */
import { createHash, randomBytes, timingSafeEqual } from "crypto";
import { pool } from "./db";

type Queryable = { query: (text: string, params?: unknown[]) => Promise<{ rows: unknown[] }> };
import { EFFECTIVE_STATUS_SQL } from "./feed-subscriptions";
import { signResponse, type SignedEnvelope } from "./response-signing";
import { followUpIfUnreached } from "./client-reach";
import { SUPPORT_HANDLE } from "./support-contact";
import { resolveAdminUserId } from "./admin";

/** Bearer tokens are 32 random bytes, base64url (43 chars). Anything shorter is refused before the lookup. */
const TOKEN_CHARS = 43;
export const BOX_NAME = /^[a-z0-9][a-z0-9-]{1,39}$/;
export const APPLY_RESULTS = ["applied", "pending_bridge_reload", "rejected", "removed"] as const;
export type ApplyResult = (typeof APPLY_RESULTS)[number];
/** The box's clock is trusted only this far: applied_at more than 5 min ahead or 7 days behind is refused. */
const APPLIED_AT_FUTURE_MS = 5 * 60 * 1000;
const APPLIED_AT_PAST_MS = 7 * 24 * 60 * 60 * 1000;
export const EXPIRY_GRACE_DAYS = 3;

export const sha256Hex = (s: string) => createHash("sha256").update(s, "utf8").digest("hex");

/** An allowlist record `ar` is live when its (server, tier) has a subscription the portal itself counts as live:
 * EFFECTIVE_STATUS_SQL from feed-subscriptions.ts, the predicate the subscriber lists use (Fable m62433 item 3e, one
 * predicate). Self-contained (its own feed_tiers join, which the predicate reads as `ft`), so it works in an UPDATE
 * as well as a SELECT. */
const LIVE_SQL = `exists (
    select 1 from feed_subscriptions s
      left join feed_tiers ft on ft.id = s.feed_tier_id
     where s.server_registration_id = ar.server_registration_id
       and s.feed_tier_id = ar.feed_tier_id
       and (${EFFECTIVE_STATUS_SQL}) <> 'lapsed')`;

// ---------- IP validation (Fable m62433 item 3b: both sides validate, neither trusts the other) ----------

const ipv4 = (s: string): number[] | null => {
  const m = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(s);
  if (!m) return null;
  const o = m.slice(1).map(Number);
  if (o.some((n, i) => n > 255 || (m[i + 1].length > 1 && m[i + 1].startsWith("0")))) return null;
  return o;
};

/** null = a public IPv4 host address the box may allow; otherwise why not. The documentation ranges (TEST-NET-1/2/3)
 * are allowed on purpose: they route nowhere, and the proof run adds a test IP through the portal (Fable item 6.2,
 * the G4 TEST-NET 192.0.2.1). Everything else non-public is refused. */
export function hostIpProblem(raw: string): string | null {
  const s = raw.trim();
  if (s.includes("/")) return "CIDR range, not a single host";
  if (s.includes(":")) return "not IPv4";
  const o = ipv4(s);
  if (!o) return "not an IPv4 address";
  const [a, b, c] = o;
  if (a === 0) return "0.0.0.0/8 (this network)";
  if (a === 10 || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168)) return "private address";
  if (a === 127) return "loopback";
  if (a === 169 && b === 254) return "link-local";
  if (a === 100 && b >= 64 && b <= 127) return "carrier-grade NAT (100.64/10)";
  if (a === 192 && b === 0 && c === 0) return "IETF protocol assignments (192.0.0/24)";
  if (a === 198 && (b === 18 || b === 19)) return "benchmarking range (198.18/15)";
  if (a >= 224 && a <= 239) return "multicast";
  if (a >= 240) return "reserved / broadcast";
  return null;
}

// ---------- boxes and tokens (admin only; the token is shown once and never stored or logged) ----------

export interface FeedBox {
  id: string;
  name: string;
  hasToken: boolean;
  serial: number;
  rotatedAt: Date | null;
  lastSeenAt: Date | null;
  /** The tiers it APPLIES client IPs for (feed_box_tiers): its allowlist. Set at creation only (Fable m64547 S1). */
  tiers: { id: string; tierKey: string; name: string }[];
  /** The tiers it may REPORT feed status for (feed_box_status_tiers, 0101). Never feeds the allowlist. */
  statusTiers: { id: string; tierKey: string; name: string }[];
  statusReportedAt: Date | null;
}

const tierList = (v: unknown) => (typeof v === "string" ? JSON.parse(v) : v) as FeedBox["tiers"];

export async function listFeedBoxes(): Promise<FeedBox[]> {
  const r = await pool.query(
    `select b.id, b.name, b.token_sha256 is not null as has_token, b.serial, b.rotated_at, b.last_seen_at, b.status_reported_at,
            coalesce((select json_agg(json_build_object('id', ft.id, 'tierKey', ft.tier_key, 'name', ft.name) order by ft.tier_key)
                        from feed_box_tiers bt join feed_tiers ft on ft.id = bt.feed_tier_id where bt.box_id = b.id), '[]') as tiers,
            coalesce((select json_agg(json_build_object('id', ft.id, 'tierKey', ft.tier_key, 'name', ft.name) order by ft.tier_key)
                        from feed_box_status_tiers st join feed_tiers ft on ft.id = st.feed_tier_id where st.box_id = b.id), '[]') as status_tiers
       from feed_boxes b
      order by b.name`
  );
  return r.rows.map((b: Record<string, unknown>) => ({
    id: b.id as string,
    name: b.name as string,
    hasToken: Boolean(b.has_token),
    serial: Number(b.serial),
    rotatedAt: (b.rotated_at as Date | null) ?? null,
    lastSeenAt: (b.last_seen_at as Date | null) ?? null,
    tiers: tierList(b.tiers),
    statusTiers: tierList(b.status_tiers),
    statusReportedAt: (b.status_reported_at as Date | null) ?? null,
  }));
}

/** Two sets (Fable m64547 S1): applyTierIds -> feed_box_tiers (the box's allowlist), statusTierIds ->
 * feed_box_status_tiers (what it may report status for). Either may be empty, not both: a status-only box (tommy4)
 * gets an empty signed allowlist, never a London client IP. */
export async function createFeedBox(name: string, applyTierIds: string[], statusTierIds: string[] = []): Promise<string> {
  if (!BOX_NAME.test(name)) throw new Error("Box name: 2-40 chars, lowercase letters, digits and '-'");
  if (applyTierIds.length === 0 && statusTierIds.length === 0) {
    throw new Error("Pick at least one tier (one it applies client IPs for, or one it reports feed status for)");
  }
  const client = await pool.connect();
  try {
    await client.query("begin");
    const b = await client.query(`insert into feed_boxes (name) values ($1) returning id`, [name]);
    const id = b.rows[0].id as string;
    for (const t of applyTierIds) await client.query(`insert into feed_box_tiers (box_id, feed_tier_id) values ($1, $2)`, [id, t]);
    for (const t of statusTierIds) await client.query(`insert into feed_box_status_tiers (box_id, feed_tier_id) values ($1, $2)`, [id, t]);
    await client.query("commit");
    return id;
  } catch (err) {
    await client.query("rollback").catch(() => {});
    throw err;
  } finally {
    client.release();
  }
}

/** Issue or rotate: a fresh 32-byte token replaces any previous one at once (the old one stops working). Returns
 * the token for the admin to copy ONCE; the caller must not log it or store it. */
export async function issueBoxToken(boxId: string): Promise<{ name: string; token: string }> {
  const token = randomBytes(32).toString("base64url");
  const r = await pool.query(
    `update feed_boxes set token_sha256 = $2, rotated_at = now() where id = $1 returning name`,
    [boxId, sha256Hex(token)]
  );
  if (!r.rows[0]) throw new Error("Box not found");
  return { name: r.rows[0].name as string, token };
}

/** Replace a box's STATUS set (Fable m64547 S1: the only set editable after creation). Never touches feed_box_tiers.
 * A tier taken out drops its feed_status_latest rows (0101's FK cascades). */
export async function setBoxStatusTiers(boxId: string, feedTierIds: string[]): Promise<{ name: string }> {
  const client = await pool.connect();
  try {
    await client.query("begin");
    const b = await client.query(`select name from feed_boxes where id = $1 for update`, [boxId]);
    if (!b.rows[0]) throw new Error("Box not found");
    await client.query(`delete from feed_box_status_tiers where box_id = $1 and not (feed_tier_id = any($2::uuid[]))`, [boxId, feedTierIds]);
    for (const t of feedTierIds) {
      await client.query(`insert into feed_box_status_tiers (box_id, feed_tier_id) values ($1, $2) on conflict do nothing`, [boxId, t]);
    }
    await client.query("commit");
    return { name: b.rows[0].name as string };
  } catch (err) {
    await client.query("rollback").catch(() => {});
    throw err;
  } finally {
    client.release();
  }
}

/** Revoke a box's token (marcus m64519 Q4; FOC13's removal step): token_sha256 = null, so authenticateBox's lookup
 * finds nothing and both endpoints 401. rotated_at and serial are untouched. The audit row 'feed_box_token_revoked'
 * {box} is written in the same transaction. Issue token makes a new one. */
export async function revokeBoxToken(args: { boxId: string; adminUserId: string }): Promise<{ name: string }> {
  const adminUserId = await resolveAdminUserId(args.adminUserId);
  const client = await pool.connect();
  try {
    await client.query("begin");
    const b = await client.query(`select name, token_sha256 from feed_boxes where id = $1 for update`, [args.boxId]);
    const row = b.rows[0] as { name: string; token_sha256: string | null } | undefined;
    if (!row) throw new Error("Box not found");
    if (!row.token_sha256) throw new Error("That box has no token to revoke");
    await client.query(`update feed_boxes set token_sha256 = null where id = $1`, [args.boxId]);
    await client.query(`insert into admin_actions (admin_user_id, action_type, details_json) values ($1, 'feed_box_token_revoked', $2)`, [
      adminUserId,
      JSON.stringify({ box: row.name }),
    ]);
    await client.query("commit");
    return { name: row.name };
  } catch (err) {
    await client.query("rollback").catch(() => {});
    throw err;
  } finally {
    client.release();
  }
}

// ---------- the box's requests ----------

export interface AuthedBox {
  id: string;
  name: string;
}

/** Production only, as the agent API (a preview shares the prod DB, so it must never answer the box), then the
 * bearer token. The lookup is by sha256, then re-checked with timingSafeEqual. */
export async function authenticateBox(headers: Headers, env: Record<string, string | undefined> = process.env): Promise<
  { box: AuthedBox } | { status: number; error: string }
> {
  if (env.VERCEL_ENV !== "production") return { status: 404, error: "not found" };
  const m = /^Bearer ([A-Za-z0-9_-]+)$/.exec(headers.get("authorization") ?? "");
  if (!m || m[1].length !== TOKEN_CHARS) return { status: 401, error: "unauthorized" };
  const hex = sha256Hex(m[1]);
  const r = await pool.query(`select id, name, token_sha256 from feed_boxes where token_sha256 = $1`, [hex]);
  const row = r.rows[0];
  if (!row || !timingSafeEqual(Buffer.from(row.token_sha256 as string, "hex"), Buffer.from(hex, "hex"))) {
    return { status: 401, error: "unauthorized" };
  }
  return { box: { id: row.id as string, name: row.name as string } };
}

export interface AllowlistEntry {
  record_id: string;
  ip: string;
  tier_key: string;
  /** The expiry job's first sighting of a lapse (in grace), else null. Informational: the box's day-one report can
   * show "in grace" rows; it changes nothing the box does (Fable m62985 S1). */
  lapsed_since: string | null;
}
export interface AllowlistBody {
  /** Domain separation: the same Ed25519 key also signs /v1/validate (Fable m62985 Q1). The box must require it. */
  purpose: "feed-box-allowlist";
  box: string;
  issued_at: string;
  serial: number;
  records: AllowlistEntry[];
  /** Open, live records the portal will not hand out, with why (CIDR, private, malformed). */
  skipped: { record_id: string; tier_key: string; reason: string }[];
}

/** The served set is the OPEN set (Fable m62985 S1, clarifying her item 3e): every allowlist record on this box's
 * tiers with revoked_at null. Liveness is NOT tested here: a GET never cuts anyone. Only the expiry job turns a lapse
 * into a cut, with a stamp, a message to the client and a 3-day grace, then an explicit revoked_at. One entry per
 * record; the same IP on two records appears twice (the box de-duplicates). Provider and admin grants look the same. */
export async function listEffectiveAllowlist(
  boxId: string,
  q: Queryable = pool
): Promise<{ records: AllowlistEntry[]; skipped: AllowlistBody["skipped"] }> {
  const r = await q.query(
    `select ar.id as record_id, ar.ip, ft.tier_key, ar.lapse_seen_at
       from feed_allowlist_records ar
       join feed_box_tiers bt on bt.feed_tier_id = ar.feed_tier_id and bt.box_id = $1
       join feed_tiers ft on ft.id = ar.feed_tier_id
      where ar.revoked_at is null
      order by ar.told_at, ar.id`,
    [boxId]
  );
  const records: AllowlistEntry[] = [];
  const skipped: AllowlistBody["skipped"] = [];
  for (const row of r.rows as { record_id: string; ip: string; tier_key: string; lapse_seen_at: Date | null }[]) {
    const problem = hostIpProblem(row.ip);
    if (problem) skipped.push({ record_id: row.record_id, tier_key: row.tier_key, reason: problem });
    else
      records.push({
        record_id: row.record_id,
        ip: row.ip.trim(),
        tier_key: row.tier_key,
        lapsed_since: row.lapse_seen_at ? new Date(row.lapse_seen_at).toISOString() : null,
      });
  }
  return { records, skipped };
}

/** One signed response. The box row is locked, the serial bumped and the list read in ONE transaction (Fable m62985
 * S2), so a higher serial always carries data at least as new: two overlapping polls queue on the lock instead of
 * interleaving (A bumps, B bumps, B lists, A lists). issued_at is the database clock of that transaction. null when no
 * signing key is configured: the route answers 503 and never serves an unsigned list. */
export async function buildSignedAllowlist(box: AuthedBox): Promise<SignedEnvelope<AllowlistBody> | null> {
  const client = await pool.connect();
  let body: AllowlistBody;
  try {
    await client.query("begin");
    await client.query(`select serial from feed_boxes where id = $1 for update`, [box.id]);
    const s = await client.query(
      `update feed_boxes set serial = serial + 1, last_seen_at = now() where id = $1 returning serial, now() as issued_at`,
      [box.id]
    );
    const { records, skipped } = await listEffectiveAllowlist(box.id, client);
    await client.query("commit");
    const row = s.rows[0] as { serial: string | number; issued_at: Date };
    body = { purpose: "feed-box-allowlist", box: box.name, issued_at: new Date(row.issued_at).toISOString(), serial: Number(row.serial), records, skipped };
  } catch (err) {
    await client.query("rollback").catch(() => {});
    throw err;
  } finally {
    client.release();
  }
  return signResponse<AllowlistBody>(body);
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

/** Strict: exactly {record_id, applied_at, result, reason?}, each checked; anything else is refused. */
export function parseAppliedBody(body: unknown, now: Date = new Date()):
  | { ok: true; recordId: string; appliedAt: Date; result: ApplyResult; reason: string | null }
  | { ok: false; error: string } {
  if (!body || typeof body !== "object" || Array.isArray(body)) return { ok: false, error: "body must be one JSON object" };
  const b = body as Record<string, unknown>;
  const extra = Object.keys(b).filter((k) => !["record_id", "applied_at", "result", "reason"].includes(k));
  if (extra.length) return { ok: false, error: `unknown field(s): ${extra.join(", ")}` };
  if (typeof b.record_id !== "string" || !UUID.test(b.record_id)) return { ok: false, error: "record_id must be a uuid" };
  if (typeof b.applied_at !== "string" || Number.isNaN(Date.parse(b.applied_at))) return { ok: false, error: "applied_at must be an ISO timestamp" };
  const appliedAt = new Date(b.applied_at);
  if (appliedAt.getTime() > now.getTime() + APPLIED_AT_FUTURE_MS) return { ok: false, error: "applied_at is in the future" };
  if (appliedAt.getTime() < now.getTime() - APPLIED_AT_PAST_MS) return { ok: false, error: "applied_at is more than 7 days old" };
  if (typeof b.result !== "string" || !(APPLY_RESULTS as readonly string[]).includes(b.result)) {
    return { ok: false, error: `result must be one of ${APPLY_RESULTS.join(", ")}` };
  }
  const result = b.result as ApplyResult;
  if (b.reason !== undefined && b.reason !== null && typeof b.reason !== "string") return { ok: false, error: "reason must be a string" };
  const reason = typeof b.reason === "string" && b.reason.trim() ? b.reason.trim() : null;
  if (reason && reason.length > 300) return { ok: false, error: "reason is longer than 300 chars" };
  if (result === "rejected" && !reason) return { ok: false, error: "a rejected result needs a reason" };
  return { ok: true, recordId: b.record_id, appliedAt, result, reason };
}

/** The write-back. Only records on this box's tiers; 'applied' / 'pending_bridge_reload' only on an open record.
 * applied_by is always 'box:<name>'; told_at (the human tick) is never touched. */
export async function recordApplied(
  box: AuthedBox,
  w: { recordId: string; appliedAt: Date; result: ApplyResult; reason: string | null }
): Promise<{ status: number; error?: string }> {
  const rec = await pool.query(
    `select ar.revoked_at from feed_allowlist_records ar
       join feed_box_tiers bt on bt.feed_tier_id = ar.feed_tier_id and bt.box_id = $1
      where ar.id = $2`,
    [box.id, w.recordId]
  );
  if (!rec.rows[0]) return { status: 404, error: "no such record on this box's tiers" };
  if (rec.rows[0].revoked_at && (w.result === "applied" || w.result === "pending_bridge_reload")) {
    return { status: 409, error: "record is revoked; only 'removed' or 'rejected' can be written back" };
  }
  await pool.query(
    `update feed_allowlist_records
        set applied_at = $2, applied_by = $3, apply_result = $4, apply_reason = $5
      where id = $1`,
    [w.recordId, w.appliedAt, `box:${box.name}`, w.result, w.reason]
  );
  return { status: 200 };
}

// ---------- admin "Revoke now" (Fable F1 m62978; GO marcus m63784) ----------

export const REVOKE_REASON_MAX = 300;

/** Takes one open record off a box now: revoked_at = now(), revoked_by = 'admin:<user id>', and in the SAME
 * transaction an admin_actions row 'feed_allowlist_revoked' with the reason (feed_allowlist_records has no reason
 * column; /admin/history shows the row). Covers G2: an old declared_ip's record is revoked like any other. The
 * subscription is untouched: this ends the IP on the box, not the grant. The box drops it on its next poll and writes
 * back 'removed'. Refuses a record not on this box's tiers, and an already-revoked one (the first revoker stays). */
export async function revokeAllowlistRecord(args: {
  boxId: string;
  recordId: string;
  adminUserId: string;
  reason: string;
}): Promise<{ recordId: string; ip: string; tierKey: string }> {
  const reason = args.reason.trim();
  if (!reason) throw new Error("Give a reason for the revoke");
  if (reason.length > REVOKE_REASON_MAX) throw new Error(`Reason is longer than ${REVOKE_REASON_MAX} chars`);
  const adminUserId = await resolveAdminUserId(args.adminUserId);
  const client = await pool.connect();
  try {
    await client.query("begin");
    const rec = await client.query(
      `select ar.ip, ar.revoked_at, ft.tier_key, b.name as box
         from feed_allowlist_records ar
         join feed_box_tiers bt on bt.feed_tier_id = ar.feed_tier_id and bt.box_id = $1
         join feed_boxes b on b.id = bt.box_id
         join feed_tiers ft on ft.id = ar.feed_tier_id
        where ar.id = $2
          for update of ar`,
      [args.boxId, args.recordId]
    );
    const row = rec.rows[0] as { ip: string; revoked_at: Date | null; tier_key: string; box: string } | undefined;
    if (!row) throw new Error("That record is not on this box's tiers");
    if (row.revoked_at) throw new Error("That record is already revoked");
    await client.query(`update feed_allowlist_records set revoked_at = now(), revoked_by = $2 where id = $1`, [
      args.recordId,
      `admin:${adminUserId}`,
    ]);
    await client.query(`insert into admin_actions (admin_user_id, action_type, details_json) values ($1, 'feed_allowlist_revoked', $2)`, [
      adminUserId,
      JSON.stringify({ box: row.box, record_id: args.recordId, ip: row.ip, tier: row.tier_key, reason }),
    ]);
    await client.query("commit");
    return { recordId: args.recordId, ip: row.ip, tierKey: row.tier_key };
  } catch (err) {
    await client.query("rollback").catch(() => {});
    throw err;
  } finally {
    client.release();
  }
}

// ---------- admin view: what state each record is in ----------

export type RecordState =
  | { kind: "active"; label: string }
  | { kind: "pending"; label: string }
  | { kind: "rejected"; label: string }
  | { kind: "ending"; label: string }
  | { kind: "removed"; label: string };

const ymd = (d: Date) => new Date(d).toISOString().slice(0, 16).replace("T", " ") + " UTC";

/** Fable m62433 item 2: never "active" until the box says the bridge has it too. */
export function recordState(r: {
  live: boolean;
  revokedAt: Date | null;
  lapseSeenAt?: Date | null;
  appliedAt: Date | null;
  applyResult: ApplyResult | null;
  applyReason: string | null;
  ipProblem: string | null;
  /** An admin's "Revoke now": who (email, if known) and why, from its audit row. */
  adminRevoke?: { by: string | null; reason: string } | null;
}): RecordState {
  if (r.revokedAt || !r.live) {
    if (r.applyResult === "removed" && r.appliedAt) return { kind: "removed", label: `removed from the box ${ymd(r.appliedAt)}` };
    if (r.revokedAt && r.adminRevoke) {
      const { by, reason } = r.adminRevoke;
      return { kind: "ending", label: `revoked by ${by ?? "an admin"} ${ymd(r.revokedAt)}: ${reason}; waiting for the box to remove it` };
    }
    if (r.revokedAt) return { kind: "ending", label: "revoked; waiting for the box to remove it" };
    // Fable m62985 S1: a lapse never drops anything by itself; only the expiry job revokes, after its grace.
    const told = r.lapseSeenAt ? ` (client told ${ymd(r.lapseSeenAt)})` : "";
    return { kind: "ending", label: `subscription lapsed; the expiry job revokes it 3 days after it first sees it${told}` };
  }
  if (r.ipProblem) return { kind: "rejected", label: `rejected by the portal: ${r.ipProblem}` };
  if (r.applyResult === "rejected") return { kind: "rejected", label: `rejected by the box: ${r.applyReason ?? "no reason"}` };
  if (r.applyResult === "pending_bridge_reload") return { kind: "pending", label: "pending bridge reload (firewall only)" };
  if (r.applyResult === "applied" && r.appliedAt) return { kind: "active", label: `active, applied ${ymd(r.appliedAt)}` };
  return { kind: "pending", label: "pending: the box has not applied it yet" };
}

export interface BoxRecordRow {
  recordId: string;
  ip: string;
  tierKey: string;
  serverName: string | null;
  clientEmail: string | null;
  toldAt: Date;
  revoked: boolean;
  state: RecordState;
}

/** Every allowlist record on a box's tiers, open or recently revoked (30 days), with its state. Admin only. */
export async function listBoxRecords(boxId: string): Promise<BoxRecordRow[]> {
  const r = await pool.query(
    `select ar.id, ar.ip, ft.tier_key, sr.server_name, u.email, ar.told_at, ar.revoked_at, ar.lapse_seen_at,
            ar.applied_at, ar.apply_result, ar.apply_reason, rv.reason as revoke_reason, rv.email as revoked_by_email,
            ${LIVE_SQL} as live
       from feed_allowlist_records ar
       join feed_box_tiers bt on bt.feed_tier_id = ar.feed_tier_id and bt.box_id = $1
       join feed_tiers ft on ft.id = ar.feed_tier_id
       left join server_registrations sr on sr.id = ar.server_registration_id
       left join users u on u.id = sr.user_id
       left join lateral (
             select a.details_json->>'reason' as reason, au.email
               from admin_actions a
               left join users au on au.id = a.admin_user_id
              where ar.revoked_by like 'admin:%'
                and a.action_type = 'feed_allowlist_revoked'
                and a.details_json->>'record_id' = ar.id::text
              order by a.created_at desc
              limit 1) rv on true
      where ar.revoked_at is null or ar.revoked_at > now() - interval '30 days'
      order by ar.revoked_at nulls first, ar.told_at desc`,
    [boxId]
  );
  return r.rows.map((x: Record<string, unknown>) => ({
    recordId: x.id as string,
    ip: x.ip as string,
    tierKey: x.tier_key as string,
    serverName: (x.server_name as string | null) ?? null,
    clientEmail: (x.email as string | null) ?? null,
    toldAt: x.told_at as Date,
    revoked: x.revoked_at != null,
    state: recordState({
      live: Boolean(x.live),
      revokedAt: (x.revoked_at as Date | null) ?? null,
      lapseSeenAt: (x.lapse_seen_at as Date | null) ?? null,
      appliedAt: (x.applied_at as Date | null) ?? null,
      applyResult: (x.apply_result as ApplyResult | null) ?? null,
      applyReason: (x.apply_reason as string | null) ?? null,
      ipProblem: hostIpProblem(x.ip as string),
      adminRevoke: x.revoke_reason
        ? { by: (x.revoked_by_email as string | null) ?? null, reason: x.revoke_reason as string }
        : null,
    }),
  }));
}

// ---------- expiry job (Fable m62433 item 3d): explicit revoked_at after a grace window, OFF until coxwell ----------

export interface ExpiryReport {
  enabled: boolean;
  /** Open records whose subscription is no longer live. */
  lapsed: { recordId: string; ip: string; tierKey: string; lapseSeenAt: Date | null }[];
  /** enabled only: first sightings stamped this run (the client was told). */
  stamped: string[];
  /** enabled only: revoked this run (lapse_seen_at older than the grace). */
  revoked: string[];
  /** enabled only: records live again whose lapse_seen_at was cleared. */
  cleared: string[];
}

/** Off unless AUTOPROVISION_EXPIRY_ENABLED is exactly "true": then it reports what it WOULD do and writes nothing.
 * On: (1) clears lapse_seen_at on records live again; (2) stamps lapse_seen_at on a first sighting and tells the
 * client their access on that tier ends in EXPIRY_GRACE_DAYS days; (3) revokes (revoked_at, revoked_by =
 * 'expiry-job') records whose lapse_seen_at is older than the grace. The grace starts at the first sighting, so
 * turning the job on revokes nothing for EXPIRY_GRACE_DAYS days and never clears a backlog in one run. */
export async function runAllowlistExpiry(env: Record<string, string | undefined> = process.env): Promise<ExpiryReport> {
  const enabled = env.AUTOPROVISION_EXPIRY_ENABLED === "true";
  const liveSql = LIVE_SQL;
  const lapsedRows = await pool.query(
    `select ar.id, ar.ip, ft.tier_key, ft.name as tier_name, ar.lapse_seen_at, sr.user_id
       from feed_allowlist_records ar
       join feed_box_tiers bt on bt.feed_tier_id = ar.feed_tier_id
       join feed_tiers ft on ft.id = ar.feed_tier_id
       left join server_registrations sr on sr.id = ar.server_registration_id
      where ar.revoked_at is null and not ${liveSql}
      group by ar.id, ar.ip, ft.tier_key, ft.name, ar.lapse_seen_at, sr.user_id`
  );
  const report: ExpiryReport = {
    enabled,
    lapsed: lapsedRows.rows.map((x: Record<string, unknown>) => ({
      recordId: x.id as string,
      ip: x.ip as string,
      tierKey: x.tier_key as string,
      lapseSeenAt: (x.lapse_seen_at as Date | null) ?? null,
    })),
    stamped: [],
    revoked: [],
    cleared: [],
  };
  if (!enabled) return report;

  const cleared = await pool.query(
    `update feed_allowlist_records ar set lapse_seen_at = null
      where ar.revoked_at is null and ar.lapse_seen_at is not null and ${liveSql}
      returning ar.id`
  );
  report.cleared = cleared.rows.map((x: { id: string }) => x.id);

  for (const x of lapsedRows.rows as { id: string; tier_name: string; lapse_seen_at: Date | null; user_id: string | null }[]) {
    if (x.lapse_seen_at) continue;
    const stamped = await pool.query(
      `update feed_allowlist_records set lapse_seen_at = now() where id = $1 and lapse_seen_at is null and revoked_at is null returning id`,
      [x.id]
    );
    if (!stamped.rows[0]) continue;
    report.stamped.push(x.id);
    if (!x.user_id) continue;
    // Client reach (9d6dd53): portal bot then email, recorded on the client; reaching nobody alerts the admins, so a
    // client never loses a feed without being told or the admin knowing they couldn't be. Never throws.
    const what = `${x.tier_name} feed access ends in ${EXPIRY_GRACE_DAYS} days (subscription lapsed)`;
    await followUpIfUnreached(x.user_id, what, false, {
      subject: `Your ${x.tier_name} feed access ends in ${EXPIRY_GRACE_DAYS} days`,
      message:
        `Your ${x.tier_name} subscription is no longer active, so your server's access to this feed will be removed in ` +
        `${EXPIRY_GRACE_DAYS} days. To keep it, message us on Telegram to renew: ${SUPPORT_HANDLE}.`,
    });
  }

  const revoked = await pool.query(
    `update feed_allowlist_records ar set revoked_at = now(), revoked_by = 'expiry-job'
      where ar.revoked_at is null
        and ar.lapse_seen_at < now() - make_interval(days => $1)
        and not ${liveSql}
      returning ar.id`,
    [EXPIRY_GRACE_DAYS]
  );
  report.revoked = revoked.rows.map((x: { id: string }) => x.id);
  return report;
}
