import { createHash, timingSafeEqual } from "crypto";
import { pool } from "./db";
import { ActiveLicenseExistsError, FEED_TYPES, licenseNumberSql, settleLicenseBackgroundTasks, type FeedType } from "./licenses";
import {
  DuplicateTierGrantError,
  FeedTierNotAssignedError,
  LicenseHasNoExpiryError,
  MultipleActiveLicensesForFeedGrantError,
  NoActiveLicenseForFeedGrantError,
  NoServerForFeedGrantError,
} from "./feed-subscriptions";
import { AGENT_ACTOR_EMAIL, executeTrial, planTrial, RefusedError, resolveUser, type TrialPlan } from "./assign-trial";
import { executeFeed, planFeed, type FeedPlan } from "./assign-feed";
import { LICENSE_KEY_DELIVERY_ACTION } from "./issue-new-license";
import { notifyAgentGrant } from "./telemetry-sink";

/** The agent API behind POST /api/agent/trial and /api/agent/feed (scope m60807, fable m60833
 * C1-C7, marcus m60835). Marcus's agent on claw1 grants a client a trial licence or one feed tier
 * through the SAME planTrial/executeTrial and planFeed/executeFeed as the CLI, and so through the
 * same issueNewLicenseForUser / assignFeedTierForUser as the admin panel. Every refusal is the
 * panel's, enforced here on the server. Neither override (--allow-internal, --allow-repeat-trial)
 * is reachable: those stay in the panel. Operator notes, WAF rules and the smoke test:
 * docs/agent-api.md.
 *
 * Layers, outermost first: the Vercel WAF allowlist (claw1's IP only; not in git), then
 * gateAgentRequest (production only, the same IP again, the bearer token's sha256 compared in
 * constant time), then a strict body, then per-request idempotency (agent_grants, 0095) and one
 * advisory lock across the daily cap, the plan, the grant and the outcome. */

export type AgentAction = "trial" | "feed";

/** Executes that may be granted per action per UTC day. Constants, not env (fable m60833 (d)):
 * raising one is a reviewed commit, not a dashboard click. Pending and granted rows count. */
export const AGENT_DAILY_CAP: Record<AgentAction, number> = { trial: 5, feed: 5 };

/** Both route files export `maxDuration = 60`. Next reads that statically, so it is a literal there;
 * agent-api.test.ts holds the two equal. */
export const AGENT_MAX_DURATION_S = 60;
/** A pending row older than this is in doubt, not in flight: twice the function's ceiling, so a
 * request still running can never be reconciled under it. */
export const AGENT_STALE_PENDING_S = 2 * AGENT_MAX_DURATION_S;
/** How long the route waits for issueLicense's background tasks (the ops pings) before it answers:
 * once the response is sent, Vercel may freeze the function under them. Well under maxDuration. */
export const SETTLE_CAP_MS = 15_000;
/** One pg_advisory_xact_lock key for both actions ("HHAG"): count + plan + grant + outcome run one
 * request at a time (fable C2). issueLicense is check-then-insert with no transaction and licenses
 * has no unique index on a live row, so without this two keys for one client could issue two trials. */
export const AGENT_LOCK_KEY = 0x48484147;
export const MAX_BODY_BYTES = 4096;
/** The token is >= 32 random bytes (docs/agent-api.md); anything shorter is not ours. */
const MIN_TOKEN_CHARS = 32;

const KEY_RE = /^[A-Za-z0-9_-]{16,64}$/;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const EMAIL_RE = /^[^\s@]{1,64}@[^\s@]{1,189}$/;
const TIER_KEY_RE = /^[a-z0-9][a-z0-9-]{0,63}$/;
const MAX_TRIAL_DAYS = 90;

export interface TrialRequest {
  action: "trial";
  mode: "plan" | "execute";
  idempotencyKey?: string;
  user: string;
  days: number;
  feeds: FeedType[];
}

export interface FeedRequest {
  action: "feed";
  mode: "plan" | "execute";
  idempotencyKey?: string;
  user: string;
  tierKey: string;
}

export type AgentRequest = TrialRequest | FeedRequest;

/** Everything the routes ever answer (fable C5): never a licence key or the key message, never a
 * Telegram id, server IP or provider email. Plan and execute alike. */
export interface AgentResponse {
  action: AgentAction;
  mode?: "plan" | "execute";
  status: "would_grant" | "would_refuse" | "granted" | "refused" | "not_granted" | "in_flight" | "in_doubt" | "error";
  idempotencyKey?: string;
  userId?: string;
  refusals?: string[];
  trial?: Record<string, unknown>;
  feed?: Record<string, unknown>;
  capRemainingToday?: number;
  note?: string;
  error?: string;
  replayed?: boolean;
}

export interface AgentResult {
  status: number;
  body: AgentResponse;
}

type Env = Record<string, string | undefined>;

/** Before the body is read. null = let it through. Order: production only (a preview shares the
 * prod DB, so it must not answer however its env is scoped), then configured, then claw1's IP,
 * then the token. */
export function gateAgentRequest(headers: Headers, env: Env = process.env): { status: number; error: string } | null {
  if (env.VERCEL_ENV !== "production") return { status: 404, error: "not found" };

  const expectedHex = env.AGENT_API_TOKEN_SHA256?.trim().toLowerCase();
  const allowedIp = env.AGENT_API_ALLOWED_IP?.trim();
  if (!expectedHex || !/^[0-9a-f]{64}$/.test(expectedHex) || !allowedIp) {
    return { status: 401, error: "agent api not configured" };
  }

  // Vercel overwrites x-forwarded-for, so its first hop is the caller (the verify-license convention).
  const ip = headers.get("x-forwarded-for")?.split(",")[0]?.trim();
  if (ip !== allowedIp) return { status: 403, error: "forbidden" };

  const m = /^Bearer (\S+)$/.exec(headers.get("authorization") ?? "");
  if (!m || m[1].length < MIN_TOKEN_CHARS) return { status: 401, error: "unauthorized" };
  const presented = createHash("sha256").update(m[1], "utf8").digest();
  if (!timingSafeEqual(presented, Buffer.from(expectedHex, "hex"))) return { status: 401, error: "unauthorized" };
  return null;
}

const FIELDS: Record<AgentAction, string[]> = {
  trial: ["mode", "idempotencyKey", "user", "days", "feeds"],
  feed: ["mode", "idempotencyKey", "user", "tierKey"],
};

/** Strict: a JSON object with only this route's fields, each checked. Unknown fields are refused. */
export function parseAgentBody(action: AgentAction, raw: string): { ok: true; request: AgentRequest } | { ok: false; error: string } {
  let body: unknown;
  try {
    body = JSON.parse(raw);
  } catch {
    return { ok: false, error: "body is not JSON" };
  }
  if (!body || typeof body !== "object" || Array.isArray(body)) return { ok: false, error: "body must be a JSON object" };
  const b = body as Record<string, unknown>;

  const unknown = Object.keys(b).filter((k) => !FIELDS[action].includes(k));
  if (unknown.length) return { ok: false, error: `unknown field(s): ${unknown.join(", ")}` };

  if (b.mode !== "plan" && b.mode !== "execute") return { ok: false, error: 'mode must be "plan" or "execute"' };
  if (b.idempotencyKey !== undefined && (typeof b.idempotencyKey !== "string" || !KEY_RE.test(b.idempotencyKey))) {
    return { ok: false, error: "idempotencyKey must match [A-Za-z0-9_-]{16,64}" };
  }
  if (b.mode === "execute" && b.idempotencyKey === undefined) return { ok: false, error: "execute needs an idempotencyKey" };
  if (typeof b.user !== "string") return { ok: false, error: "user is required (a uuid or an email)" };
  const user = b.user.trim();
  if (!UUID_RE.test(user) && !(user.length <= 254 && EMAIL_RE.test(user))) return { ok: false, error: "user must be a uuid or an email" };

  const common = { mode: b.mode as "plan" | "execute", idempotencyKey: b.idempotencyKey as string | undefined, user };
  if (action === "trial") {
    if (typeof b.days !== "number" || !Number.isInteger(b.days) || b.days < 1 || b.days > MAX_TRIAL_DAYS) {
      return { ok: false, error: `days must be a whole number from 1 to ${MAX_TRIAL_DAYS}` };
    }
    if (!Array.isArray(b.feeds) || b.feeds.length === 0) return { ok: false, error: "feeds must be a non-empty array" };
    const bad = b.feeds.filter((f) => typeof f !== "string" || !(FEED_TYPES as string[]).includes(f));
    if (bad.length) return { ok: false, error: `unknown feed(s); known: ${FEED_TYPES.join(", ")}` };
    if (new Set(b.feeds).size !== b.feeds.length) return { ok: false, error: "feeds has duplicates" };
    return { ok: true, request: { action, ...common, days: b.days, feeds: b.feeds as FeedType[] } };
  }
  if (typeof b.tierKey !== "string" || !TIER_KEY_RE.test(b.tierKey)) return { ok: false, error: "tierKey must be a tier_key" };
  return { ok: true, request: { action, ...common, tierKey: b.tierKey } };
}

/** The normalised payload a key is bound to, and its sha256. Same key + different payload = 409. */
export function requestFingerprint(r: AgentRequest): { json: Record<string, unknown>; hash: string } {
  const user = r.user.toLowerCase();
  const json: Record<string, unknown> =
    r.action === "trial" ? { action: r.action, user, days: r.days, feeds: [...r.feeds].sort() } : { action: r.action, user, tierKey: r.tierKey };
  return { json, hash: createHash("sha256").update(JSON.stringify(json)).digest("hex") };
}

/** The full route, minus NextResponse: the gate, the body, then plan or execute. */
export async function handleAgentRequest(action: AgentAction, req: Request, env: Env = process.env): Promise<AgentResult> {
  const denied = gateAgentRequest(req.headers, env);
  if (denied) return { status: denied.status, body: { action, status: "error", error: denied.error } };

  if (!(req.headers.get("content-type") ?? "").toLowerCase().startsWith("application/json")) {
    return { status: 415, body: { action, status: "error", error: "content-type must be application/json" } };
  }
  if (Number(req.headers.get("content-length") ?? 0) > MAX_BODY_BYTES) return tooLarge(action);
  const raw = await req.text();
  if (Buffer.byteLength(raw, "utf8") > MAX_BODY_BYTES) return tooLarge(action);

  const parsed = parseAgentBody(action, raw);
  if (!parsed.ok) return { status: 400, body: { action, status: "error", error: parsed.error } };

  try {
    return parsed.request.mode === "plan" ? await planOnly(parsed.request, env) : await executeOnce(parsed.request, env);
  } catch (err) {
    // Only reachable before a ledger row exists, or before the grant started: executeOnce settles
    // everything after that itself.
    console.error("agent-api: unexpected error", action, (err as Error)?.name, (err as Error)?.message);
    return { status: 500, body: { action, status: "error", error: "internal error" } };
  }
}

function tooLarge(action: AgentAction): AgentResult {
  return { status: 413, body: { action, status: "error", error: `body over ${MAX_BODY_BYTES} bytes` } };
}

interface Queryable {
  query: (text: string, params?: unknown[]) => Promise<{ rows: Record<string, unknown>[] }>;
}

/** Today's (UTC) pending + granted executes for this action, other than `exceptId`. */
async function capUsed(q: Queryable, action: AgentAction, exceptId: string | null): Promise<number> {
  const r = await q.query(
    `select count(*)::int as n from agent_grants
     where action = $1 and status in ('pending', 'granted') and id is distinct from $2::uuid
       and created_at >= date_trunc('day', now() at time zone 'utc') at time zone 'utc'`,
    [action, exceptId]
  );
  return Number(r.rows[0].n);
}

const capRefusal = (action: AgentAction) =>
  `Daily cap reached: ${AGENT_DAILY_CAP[action]} ${action} grants per UTC day through the agent API. Use the admin panel, or wait for 00:00 UTC`;

/** The panel's override flags are not reachable here; say so instead of naming a CLI flag. */
export function endpointRefusals(refusals: string[]): string[] {
  return refusals.map((r) =>
    r.replace(/\.?\s*Pass --allow-(internal|repeat-trial) to .*$/, ": the agent API cannot override this (the admin panel can)")
  );
}

function trialArgs(r: TrialRequest) {
  return { user: r.user, days: r.days, feeds: r.feeds, execute: r.mode === "execute", allowRepeatTrial: false, allowInternal: false };
}

function feedArgs(r: FeedRequest) {
  return { user: r.user, tierKey: r.tierKey, execute: r.mode === "execute", allowInternal: false };
}

function trialPlanSummary(plan: TrialPlan) {
  return {
    expiresAt: plan.expiresAt.toISOString(),
    feeds: plan.feedTypes,
    delivery: plan.delivery,
    licences: plan.licences.map((l) => ({
      number: l.licenseNumber,
      tier: l.tier,
      status: l.status,
      live: l.live,
      expiresAt: new Date(l.expiresAt).toISOString(),
    })),
  };
}

function feedPlanSummary(plan: FeedPlan) {
  return {
    tierKey: plan.tier.tierKey,
    tierName: plan.tier.name,
    regionKey: plan.tier.regionKey,
    licence: plan.boundLicence ? { number: plan.boundLicence.licenseNumber, expiresAt: new Date(plan.boundLicence.expiresAt).toISOString() } : null,
    serverRegistered: plan.server !== null,
    wouldBe: plan.outcome,
    existingRowStatus: plan.existingRow?.status ?? null,
  };
}

async function planFor(r: AgentRequest, env: Env): Promise<{ plan: TrialPlan | FeedPlan; summary: Record<string, unknown> }> {
  if (r.action === "trial") {
    const plan = await planTrial(trialArgs(r), env);
    return { plan, summary: trialPlanSummary(plan) };
  }
  const plan = await planFeed(feedArgs(r), env);
  return { plan, summary: feedPlanSummary(plan) };
}

/** mode "plan": reads only, no ledger row, no lock. */
async function planOnly(r: AgentRequest, env: Env): Promise<AgentResult> {
  let planned: Awaited<ReturnType<typeof planFor>>;
  try {
    planned = await planFor(r, env);
  } catch (err) {
    // No such user, several, or an unknown tier: the plan's own refusals, thrown.
    if (err instanceof RefusedError) return { status: 200, body: { action: r.action, mode: "plan", status: "would_refuse", refusals: [err.message] } };
    throw err;
  }
  const used = await capUsed(pool, r.action, null);
  const refusals = endpointRefusals(planned.plan.refusals);
  if (used >= AGENT_DAILY_CAP[r.action]) refusals.push(capRefusal(r.action));
  return {
    status: 200,
    body: {
      action: r.action,
      mode: "plan",
      status: refusals.length ? "would_refuse" : "would_grant",
      userId: planned.plan.user.id,
      refusals,
      [r.action]: planned.summary,
      capRemainingToday: Math.max(0, AGENT_DAILY_CAP[r.action] - used),
    },
  };
}

/** Errors the grants throw for a refusal of their own, before writing. Their messages are safe to
 * return; any other error is answered by name only. */
const GRANT_REFUSAL_ERRORS = [
  ActiveLicenseExistsError,
  DuplicateTierGrantError,
  FeedTierNotAssignedError,
  LicenseHasNoExpiryError,
  MultipleActiveLicensesForFeedGrantError,
  NoActiveLicenseForFeedGrantError,
  NoServerForFeedGrantError,
  RefusedError,
];

function describeError(err: unknown): string {
  const e = err as Error;
  return GRANT_REFUSAL_ERRORS.some((C) => err instanceof C) ? `${e.name}: ${e.message}` : (e?.name ?? "Error");
}

interface Target {
  id: string;
  email: string | null;
}

interface Settled {
  status: "granted" | "refused" | "failed";
  body: AgentResponse;
  /** Ping coxwell (C6): every write, and every outcome reconcile decided. */
  ping: string | null;
}

function what(r: AgentRequest): string {
  return r.action === "trial" ? `trial ${r.days}d, feeds ${r.feeds.join(",")}` : `feed tier ${r.tierKey}`;
}

/** mode "execute": at most once per idempotency key. */
async function executeOnce(r: AgentRequest, env: Env): Promise<AgentResult> {
  const key = r.idempotencyKey!;
  const { json, hash } = requestFingerprint(r);

  // The target first (reads only). No user, or several: refused, and no ledger row, since nothing
  // could have been written.
  let target: Target;
  try {
    const u = await resolveUser(r.user);
    target = { id: u.id, email: u.email };
  } catch (err) {
    if (err instanceof RefusedError) {
      return { status: 200, body: { action: r.action, mode: "execute", status: "refused", idempotencyKey: key, refusals: [err.message] } };
    }
    throw err;
  }

  // Committed on its own, BEFORE the lock transaction opens (C2): a crash from here on leaves a
  // pending row that a same-key retry can see and reconcile.
  const ins = await pool.query(
    `insert into agent_grants (idempotency_key, action, request_hash, request_json, target_user_id)
     values ($1, $2, $3, $4, $5)
     on conflict (idempotency_key) do nothing
     returning id, created_at`,
    [key, r.action, hash, JSON.stringify(json), target.id]
  );
  if (!ins.rows.length) return sameKeyAgain(r, key, hash);
  const row = { id: ins.rows[0].id as string, createdAt: new Date(ins.rows[0].created_at as string) };

  const client = await pool.connect();
  let settled: Settled;
  let grantStarted = false;
  try {
    await client.query("begin");
    await client.query("select pg_advisory_xact_lock($1)", [AGENT_LOCK_KEY]);
    const used = await capUsed(client, r.action, row.id);
    const capRemaining = AGENT_DAILY_CAP[r.action] - used;
    const base = { action: r.action, mode: "execute" as const, idempotencyKey: key, userId: target.id };

    if (capRemaining <= 0) {
      settled = { status: "refused", body: { ...base, status: "refused", refusals: [capRefusal(r.action)], capRemainingToday: 0 }, ping: null };
    } else {
      const { plan, summary } = await planFor(r, env);
      const refusals = endpointRefusals(plan.refusals);
      if (refusals.length) {
        settled = { status: "refused", body: { ...base, status: "refused", refusals, [r.action]: summary, capRemainingToday: capRemaining }, ping: null };
      } else {
        grantStarted = true;
        const audit = { via: "agent-api" as const, idempotencyKey: key };
        try {
          if (r.action === "trial") {
            const { license, delivery } = await executeTrial(plan as TrialPlan, audit);
            const trial = { licenseNumber: license.licenseNumber, expiresAt: new Date(license.expiresAt).toISOString(), tier: "trial", feeds: r.feeds, delivery };
            settled = { status: "granted", body: { ...base, status: "granted", trial, capRemainingToday: capRemaining - 1 }, ping: "granted" };
          } else {
            const result = await executeFeed(plan as FeedPlan, audit);
            const feed = { tierKey: r.tierKey, outcome: result.outcome, licenseNumber: result.licenseNumber, subscriptionStatus: "active" };
            settled = { status: "granted", body: { ...base, status: "granted", feed, capRemainingToday: capRemaining - 1 }, ping: "granted" };
          }
        } catch (err) {
          // The grant threw. Whether it wrote is a database fact: read it under the same lock.
          console.error("agent-api: grant threw", r.action, key.slice(0, 8), (err as Error)?.name, (err as Error)?.message);
          settled = await reconcile(client, r, key, target, row.createdAt, describeError(err));
        }
      }
    }

    await client.query(`update agent_grants set status = $2, response_json = $3, updated_at = now() where id = $1`, [
      row.id,
      settled.status,
      JSON.stringify(settled.body),
    ]);
    await client.query("commit");
  } catch (err) {
    await client.query("rollback").catch(() => {});
    console.error("agent-api: execute failed", r.action, key.slice(0, 8), grantStarted, (err as Error)?.name, (err as Error)?.message);
    if (!grantStarted) {
      // Nothing was attempted. The pending row reconciles to "not granted" on a same-key retry.
      return { status: 500, body: { action: r.action, mode: "execute", status: "error", idempotencyKey: key, error: "internal error before the grant; nothing was written" } };
    }
    const note = `The grant may or may not have landed. Check /admin/users/${target.id}. The same key, sent again after ${AGENT_STALE_PENDING_S} s, reconciles it from the database.`;
    await settleBackgroundCapped();
    await ping(r, key, target, "IN DOUBT", new Date());
    return { status: 500, body: { action: r.action, mode: "execute", status: "in_doubt", idempotencyKey: key, userId: target.id, note } };
  } finally {
    client.release();
  }

  await finish(r, key, target, settled);
  return { status: 200, body: settled.body };
}

/** After the lock is released: let the grant's background tasks land, then ping or log (C6). */
async function finish(r: AgentRequest, key: string, target: Target, settled: Settled): Promise<void> {
  await settleBackgroundCapped();
  if (settled.ping) await ping(r, key, target, settled.ping, new Date());
  else console.log(`agent-api: ${settled.status}`, r.action, key.slice(0, 8), target.id, (settled.body.refusals ?? [settled.body.note]).join(" | "));
}

async function settleBackgroundCapped(): Promise<void> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  await Promise.race([settleLicenseBackgroundTasks(), new Promise<void>((resolve) => (timer = setTimeout(resolve, SETTLE_CAP_MS)))]);
  clearTimeout(timer);
}

async function ping(r: AgentRequest, key: string, target: Target, outcome: string, at: Date): Promise<void> {
  await notifyAgentGrant({
    actorEmail: AGENT_ACTOR_EMAIL,
    action: r.action,
    what: what(r),
    targetEmail: target.email,
    targetUserId: target.id,
    outcome,
    idempotencyKey: key,
    at,
  });
}

/** A key that already has a row: replay it, refuse it, or reconcile it (fable C4). */
async function sameKeyAgain(r: AgentRequest, key: string, hash: string): Promise<AgentResult> {
  const found = await pool.query(
    `select id, request_hash, status, response_json, target_user_id, created_at,
            (now() - created_at) > make_interval(secs => $2) as stale
     from agent_grants where idempotency_key = $1`,
    [key, AGENT_STALE_PENDING_S]
  );
  const row = found.rows[0];
  const base = { action: r.action, mode: "execute" as const, idempotencyKey: key };
  if (!row) return { status: 500, body: { ...base, status: "error", error: "internal error" } };
  if (row.request_hash !== hash) {
    return { status: 409, body: { ...base, status: "error", error: "this idempotencyKey was already used for a different request" } };
  }
  if (row.status !== "pending") return { status: 200, body: { ...(row.response_json as AgentResponse), replayed: true } };
  if (!row.stale) {
    return {
      status: 409,
      body: { ...base, status: "in_flight", note: `A request with this key is still running. Retry the same key after ${AGENT_STALE_PENDING_S} s.` },
    };
  }
  return reconcileStale(r, key, row.id as string, row.target_user_id as string | null, new Date(row.created_at as string));
}

/** A pending row older than 2 x maxDuration: its request died somewhere. Decide from the database,
 * under the lock, whether its grant landed, and settle the row. */
async function reconcileStale(r: AgentRequest, key: string, id: string, targetUserId: string | null, createdAt: Date): Promise<AgentResult> {
  const base = { action: r.action, mode: "execute" as const, idempotencyKey: key };
  if (!targetUserId) {
    return { status: 409, body: { ...base, status: "in_doubt", note: "The target user no longer exists. Nothing to reconcile; use a new key." } };
  }
  const u = await resolveUser(targetUserId);
  const target = { id: u.id, email: u.email };

  const client = await pool.connect();
  let settled: Settled;
  try {
    await client.query("begin");
    await client.query("select pg_advisory_xact_lock($1)", [AGENT_LOCK_KEY]);
    // Another retry may have settled it while this one waited for the lock.
    const again = await client.query(`select status, response_json from agent_grants where id = $1 for update`, [id]);
    if (again.rows[0].status !== "pending") {
      await client.query("commit");
      return { status: 200, body: { ...(again.rows[0].response_json as AgentResponse), replayed: true } };
    }
    settled = await reconcile(client, r, key, target, createdAt, null);
    await client.query(`update agent_grants set status = $2, response_json = $3, updated_at = now() where id = $1`, [
      id,
      settled.status,
      JSON.stringify(settled.body),
    ]);
    await client.query("commit");
  } catch (err) {
    await client.query("rollback").catch(() => {});
    throw err;
  } finally {
    client.release();
  }
  await finish(r, key, target, settled);
  return { status: 200, body: settled.body };
}

/** Did a grant for this key land? The admin_actions row carries the key (C7), so it is the first
 * proof. Without it (the grant committed, then the audit write died), the domain row written since
 * the ledger row is the second. Neither: nothing landed. A landed trial also reports its key send
 * from the license_key_delivery row: delivered, failed, or no-record. Reads only. */
async function reconcile(
  q: Queryable,
  r: AgentRequest,
  key: string,
  target: Target,
  since: Date,
  thrown: string | null
): Promise<Settled> {
  const base = { action: r.action, mode: "execute" as const, idempotencyKey: key, userId: target.id };
  const actionType = r.action === "trial" ? "admin_users_issue_license" : "admin_users_assign_feed_subscription";
  const audit = await q.query(
    `select target_license_id from admin_actions
     where action_type = $1 and target_user_id = $2 and details_json->>'idempotencyKey' = $3
     limit 1`,
    [actionType, target.id, key]
  );
  const audited = audit.rows.length > 0;
  const why = thrown ? `The grant threw ${thrown}. ` : "The request that held this key did not finish. ";

  if (r.action === "trial") {
    const lic = await q.query(
      `select l.id, ${licenseNumberSql("l")} as license_number, l.expires_at, l.feed_types
       from licenses l
       where l.user_id = $1 and l.tier = 'trial' and (l.id = $2::uuid or ($2::uuid is null and l.issued_at >= $3))
       order by l.issued_at desc limit 1`,
      [target.id, audited ? audit.rows[0].target_license_id : null, since]
    );
    if (lic.rows.length) {
      const l = lic.rows[0];
      // The key goes out AFTER the insert; its license_key_delivery row (marcus m60934) says how
      // the send answered. No row: the request died before the send, or the record write failed.
      const sent = await q.query(
        `select details_json from admin_actions
         where action_type = $1 and target_license_id = $2
         order by created_at desc limit 1`,
        [LICENSE_KEY_DELIVERY_ACTION, l.id]
      );
      const d = sent.rows[0]?.details_json as { channel?: string; ok?: boolean } | undefined;
      const keyDelivery = !d ? "no-record" : d.ok === true ? "delivered" : "failed";
      const trial = {
        licenseNumber: Number(l.license_number),
        expiresAt: new Date(l.expires_at as string).toISOString(),
        tier: "trial",
        feeds: l.feed_types,
        ...(d ? { delivery: d.channel } : {}),
        keyDelivery,
      };
      const issued = `${why}The trial licence WAS issued${audited ? "" : " (no admin_actions row for it)"}. `;
      const note =
        keyDelivery === "delivered"
          ? `${issued}The key ${d!.channel === "email" ? "email" : "DM"} was delivered.`
          : keyDelivery === "failed"
            ? `${issued}The key send FAILED (${d!.channel}): check /admin/users/${target.id} and resend from the panel.`
            : `${issued}No key delivery is recorded: check /admin/users/${target.id} and resend from the panel if needed.`;
      const pingText = { delivered: "LANDED, key delivered", failed: "LANDED, key send FAILED", "no-record": "LANDED, key delivery not recorded" }[keyDelivery];
      return { status: "granted", body: { ...base, status: "granted", trial, note }, ping: pingText };
    }
  } else {
    const sub = await q.query(
      `select s.status, s.license_id from feed_subscriptions s join feed_tiers ft on ft.id = s.feed_tier_id
       where s.subscriber_user_id = $1 and ft.tier_key = $2 and s.status in ('trial', 'active')
         and ($3 or greatest(s.created_at, s.updated_at) >= $4)
       order by s.updated_at desc limit 1`,
      [target.id, (r as FeedRequest).tierKey, audited, since]
    );
    if (sub.rows.length) {
      const feed = { tierKey: (r as FeedRequest).tierKey, subscriptionStatus: sub.rows[0].status };
      const note = `${why}The feed grant WAS written${audited ? "" : " (no admin_actions row for it)"}. Check /admin/users/${target.id}.`;
      return { status: "granted", body: { ...base, status: "granted", feed, note }, ping: "LANDED after an error" };
    }
  }

  const note = `${why}Nothing was written. Send it again with a NEW idempotencyKey.`;
  return { status: "failed", body: { ...base, status: "not_granted", note }, ping: thrown ? null : "NOT LANDED (reconciled)" };
}
