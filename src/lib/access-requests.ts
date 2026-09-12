import type { PoolClient } from "@neondatabase/serverless";
import { pool } from "./db";
import { TRIAL_DURATION_DAYS, TrialAlreadyClaimedError, TrialNotEligibleError } from "./feed-tier-trials";
import { isTrialEligibleTier } from "./feed-tier-catalogue";
import {
  assertNoLiveGrant,
  assignPseudonymSeq,
  DuplicateTierGrantError,
  FeedTierNotAssignedError,
  insertAllowlistRecord,
  isUniqueViolation,
  lockServerRegistration,
  type LockedServerRegistration,
} from "./feed-subscriptions";

/** 0086 phase 2 (step ii): the access_requests envelope + feed_tier_request_details library.
 * Contract: docs/specs/0086-phase2-code.md (fable PASS-WITH-STRIKES, bus m48856..m48859, ledger
 * v1.57); binding rulings quoted in docs/specs/0086-phase2-ledger-extract.md as Sources A..N.
 *
 * Owns "the primitive" (Source D): one transaction that takes the server_registrations row FOR
 * UPDATE, runs the pending check and the live-grant check, then inserts; any failure rolls the
 * whole thing back (Source F "fails loudly and writes nothing", Source L "no partial success").
 * Nothing here writes feed_tier_requests (Source A: code rule from phase 2 on), writes
 * legacy_feed_tier_request_id, or touches the read side (EFFECTIVE_STATUS_SQL, section 8). */

export const ACCESS_REQUEST_STATUSES = ["pending", "approved", "rejected"] as const;
export type AccessRequestStatus = (typeof ACCESS_REQUEST_STATUSES)[number];
export type AccessDecision = "trial" | "paid";
export type AccessProductKind = "feed_tier" | "software";

export type AccessRequestItem =
  | { kind: "feed_tier"; serverRegistrationId: string; feedTierId: string }
  | { kind: "software"; productId: string };

/** Q22(c) default (fable P1 accept, coxwell C1 non-gating): a pending duplicate on
 * (server, tier) rejects the whole batch. Flip to allow = delete the check in createBatchOnClient. */
export class DuplicatePendingRequestError extends Error {
  constructor(tierName: string) {
    super(`${tierName} is already requested for this server`);
    this.name = "DuplicatePendingRequestError";
  }
}

/** Fable P3: re-approving (or re-rejecting) a decided envelope refuses instead of replaying.
 * The envelope FOR UPDATE plus this status check is the idempotency; a double-click produces one
 * readable failure and never inserts twice. */
export class RequestAlreadyDecidedError extends Error {
  constructor(status: string) {
    super(`This request is already ${status}`);
    this.name = "RequestAlreadyDecidedError";
  }
}

/** S3: product_kind = 'software' is refused by both entry points in this slice. The dispatch
 * skeleton stays so the software slice adds a handler, not a restructure. */
export class SoftwareRequestsNotShippedError extends Error {
  constructor() {
    super("software requests ship with the software UI");
    this.name = "SoftwareRequestsNotShippedError";
  }
}

/** Section 2 behaviour change (fable P9 accept, coxwell notice C3): a licence with no
 * server_registrations row cannot request, start a trial, or be direct-granted, because
 * feed_tier_request_details.server_registration_id is NOT NULL (0086:414). */
export class NoServerForLicenseError extends Error {
  constructor() {
    super("Register a server for this licence before requesting access");
    this.name = "NoServerForLicenseError";
  }
}

export class ServerNotOwnedError extends Error {
  constructor() {
    super("Invalid server selection");
    this.name = "ServerNotOwnedError";
  }
}

export class AccessRequestNotFoundError extends Error {
  constructor() {
    super("Access request not found");
    this.name = "AccessRequestNotFoundError";
  }
}

/** Section 4(c): a surface with no decision input (Telegram card; provider panel pending C2)
 * may only approve a trial-eligible tier as a 7-day trial. */
export class PaidApprovalNeedsQueueError extends Error {
  constructor(tierName: string) {
    super(`Paid approval needs an end date and invoice ref: use the admin queue (${tierName} has no trial)`);
    this.name = "PaidApprovalNeedsQueueError";
  }
}

/** Section 4(c): a legacy feed_tier_requests id that 0086 section 3 copied as N envelopes (a
 * package) cannot be decided by one button; each line is decided in the queue (Source F). */
export class PackageNeedsQueueError extends Error {
  constructor(count: number) {
    super(`This request maps to ${count} lines: open the queue and decide each one`);
    this.name = "PackageNeedsQueueError";
  }
}

export interface ServerRegistrationRef {
  id: string;
  licenseId: string | null;
  declaredIp: string;
  serverName: string;
}

/** licence -> its server row (0031 unique (license_id), so at most one). Own query because
 * Leo's server-registration.ts exposes no row id and is not touched (section 1). */
export async function getServerRegistrationForLicense(licenseId: string): Promise<ServerRegistrationRef | null> {
  const result = await pool.query<{ id: string; license_id: string | null; declared_ip: string; server_name: string }>(
    `select id, license_id, declared_ip, server_name from server_registrations where license_id = $1`,
    [licenseId]
  );
  if (!result.rowCount) return null;
  const row = result.rows[0];
  return { id: row.id, licenseId: row.license_id, declaredIp: row.declared_ip, serverName: row.server_name };
}

interface FeedTierRef {
  id: string;
  tierKey: string;
  name: string;
  regionKey: string;
  providerUserId: string | null;
}

async function feedTierById(client: PoolClient, feedTierId: string): Promise<FeedTierRef> {
  const result = await client.query<{ id: string; tier_key: string; name: string; region_key: string; provider_user_id: string | null }>(
    `select id, tier_key, name, region_key, provider_user_id from feed_tiers where id = $1`,
    [feedTierId]
  );
  if (!result.rowCount) throw new Error(`Unknown feed tier id: ${feedTierId}`);
  const row = result.rows[0];
  return { id: row.id, tierKey: row.tier_key, name: row.name, regionKey: row.region_key, providerUserId: row.provider_user_id };
}

// ---------------------------------------------------------------------------------------------
// Section 2: request creation (Sources D, E, F)
// ---------------------------------------------------------------------------------------------

export interface CreateAccessRequestBatchInput {
  userId: string;
  items: AccessRequestItem[];
}

export interface CreateAccessRequestBatchResult {
  batchId: string;
  requestIds: string[];
}

type FeedTierItem = Extract<AccessRequestItem, { kind: "feed_tier" }>;

/** The batch write on the caller's transaction client. Order (spec section 2): dedupe, lock
 * server rows in sorted id order (stable lock order, no deadlock between two concurrent batches
 * on the same two servers), ownership, pending check, live check, inserts. */
async function createBatchOnClient(client: PoolClient, input: CreateAccessRequestBatchInput): Promise<CreateAccessRequestBatchResult> {
  const feedItems: FeedTierItem[] = [];
  for (const item of input.items) {
    // Dispatch skeleton on item.kind (Source E); the software branch is S3's refusal for now.
    switch (item.kind) {
      case "feed_tier":
        feedItems.push(item);
        break;
      case "software":
        throw new SoftwareRequestsNotShippedError();
    }
  }
  if (feedItems.length === 0) throw new Error("Nothing to request");

  // 5. Inside-batch dedupe: package + member overlap collapses to one line (Source F).
  const seen = new Set<string>();
  const items = feedItems.filter((item) => {
    const key = `${item.serverRegistrationId}::${item.feedTierId}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });

  // 2. Lock + ownership. coalesce(sr.user_id, l.user_id) is the window rule (Source B).
  const serverIds = [...new Set(items.map((i) => i.serverRegistrationId))].sort();
  const servers = new Map<string, LockedServerRegistration>();
  for (const id of serverIds) {
    const sr = await lockServerRegistration(client, id);
    if (!sr || sr.ownerUserId !== input.userId) throw new ServerNotOwnedError();
    servers.set(id, sr);
  }

  // 3 + 4. Pending check (reads feed_tier_request_details only, so a legacy pending row 0086
  // skipped does not collide when that client registers and re-requests) and live check.
  for (const item of items) {
    const sr = servers.get(item.serverRegistrationId)!;
    const tier = await feedTierById(client, item.feedTierId);
    const pending = await client.query(
      `select 1 from feed_tier_request_details d
       join access_requests a on a.id = d.request_id
       where d.server_registration_id = $1 and d.feed_tier_id = $2 and a.status = 'pending'`,
      [sr.id, tier.id]
    );
    if (pending.rowCount) throw new DuplicatePendingRequestError(tier.name);
    await assertNoLiveGrant(client, { serverRegistrationId: sr.id, licenseId: sr.licenseId, feedTierId: tier.id, tierName: tier.name });
  }

  // 7. One batch_id per call (Source F); envelope status defaults to 'pending' (0086:391).
  const batchId = crypto.randomUUID();
  const requestIds: string[] = [];
  for (const item of items) {
    const envelope = await client.query<{ id: string }>(
      `insert into access_requests (user_id, product_kind, batch_id) values ($1, 'feed_tier', $2) returning id`,
      [input.userId, batchId]
    );
    const requestId = envelope.rows[0].id;
    await client.query(
      `insert into feed_tier_request_details (request_id, server_registration_id, feed_tier_id) values ($1, $2, $3)`,
      [requestId, item.serverRegistrationId, item.feedTierId]
    );
    requestIds.push(requestId);
  }
  return { batchId, requestIds };
}

export async function createAccessRequestBatch(input: CreateAccessRequestBatchInput): Promise<CreateAccessRequestBatchResult> {
  const client = await pool.connect();
  try {
    await client.query("begin");
    const result = await createBatchOnClient(client, input);
    await client.query("commit");
    return result;
  } catch (err) {
    await client.query("rollback");
    throw err;
  } finally {
    client.release();
  }
}

// ---------------------------------------------------------------------------------------------
// Section 3: approval (Sources C, D, J, K, L)
// ---------------------------------------------------------------------------------------------

export interface ApproveAccessRequestInput {
  /** ONE envelope; approval is per line, never per batch (Source F). */
  requestId: string;
  /** users.id of the decider; NULL only for the self-serve trial (section 7, fable P8). */
  decidedBy: string | null;
  decision: AccessDecision;
  /** paid: required and in the future. trial: ignored, derived server-side (S4). */
  endsAt: Date | null;
  /** paid: required non-empty. trial: must be empty (Source J/K). */
  invoiceRef: string | null;
}

export interface ApproveAccessRequestResult {
  requestId: string;
  feedSubscriptionId: string;
  endsAt: Date;
  decision: AccessDecision;
  tierKey: string;
}

/** S4: a trial's end is always now() + TRIAL_DURATION_DAYS at approval time; the free date
 * exists for paid only. Runs before any transaction opens. */
function resolveDecision(input: Pick<ApproveAccessRequestInput, "decision" | "endsAt" | "invoiceRef">): { endsAt: Date; invoiceRef: string | null } {
  const invoiceRef = (input.invoiceRef ?? "").trim();
  if (input.decision === "paid") {
    if (!input.endsAt || Number.isNaN(input.endsAt.getTime())) throw new Error("Paid approval needs an end date");
    if (input.endsAt.getTime() <= Date.now()) throw new Error("The end date must be in the future");
    if (!invoiceRef) throw new Error("Paid approval needs an invoice ref");
    return { endsAt: input.endsAt, invoiceRef };
  }
  if (invoiceRef) throw new Error("A trial has no invoice ref");
  return { endsAt: new Date(Date.now() + TRIAL_DURATION_DAYS * 24 * 60 * 60 * 1000), invoiceRef: null };
}

interface EnvelopeRow {
  id: string;
  user_id: string;
  product_kind: AccessProductKind;
  status: AccessRequestStatus;
}

async function lockPendingEnvelope(client: PoolClient, requestId: string): Promise<EnvelopeRow> {
  const result = await client.query<EnvelopeRow>(
    `select id, user_id, product_kind, status from access_requests where id = $1 for update`,
    [requestId]
  );
  if (!result.rowCount) throw new AccessRequestNotFoundError();
  const envelope = result.rows[0];
  if (envelope.status !== "pending") throw new RequestAlreadyDecidedError(envelope.status);
  return envelope;
}

/** The approval write on the caller's transaction client. Lock order: the envelope, then its
 * server row (creation locks server rows only, so there is no cycle between the two). */
async function approveOnClient(client: PoolClient, input: ApproveAccessRequestInput): Promise<ApproveAccessRequestResult> {
  const { endsAt, invoiceRef } = resolveDecision(input);
  const envelope = await lockPendingEnvelope(client, input.requestId);

  let feedSubscriptionId: string;
  let tierKey: string;
  switch (envelope.product_kind) {
    case "feed_tier": {
      const detail = await client.query<{ server_registration_id: string; feed_tier_id: string }>(
        `select server_registration_id, feed_tier_id from feed_tier_request_details where request_id = $1`,
        [envelope.id]
      );
      if (!detail.rowCount) throw new Error("feed tier request has no detail row");
      const sr = await lockServerRegistration(client, detail.rows[0].server_registration_id);
      if (!sr) throw new Error("server registration for this request no longer exists");
      const tier = await feedTierById(client, detail.rows[0].feed_tier_id);
      if (!tier.providerUserId) throw new FeedTierNotAssignedError(tier.name, tier.regionKey);
      tierKey = tier.tierKey;

      await assignPseudonymSeq(client, tier.providerUserId, envelope.user_id);
      try {
        // Plain insert, no on-conflict. license_id from the server row (window rule, Source B),
        // access_request_id = the envelope (Source C), ends_at from the decision (Source K),
        // status 'active' for both decisions (fable P4; trial-ness is decision + access_request_id).
        // A 23505 on feed_subscriptions_server_feed_tier_live_uidx, or on the 0081 licence index
        // while it exists, is a DuplicateTierGrantError and rolls the whole approval back (Source L).
        const inserted = await client.query<{ id: string }>(
          `insert into feed_subscriptions
             (provider_user_id, subscriber_user_id, license_id, server_registration_id, feed_tier_id,
              status, access_request_id, ends_at)
           values ($1, $2, $3, $4, $5, 'active', $6, $7)
           returning id`,
          [tier.providerUserId, envelope.user_id, sr.licenseId, sr.id, tier.id, envelope.id, endsAt]
        );
        feedSubscriptionId = inserted.rows[0].id;
      } catch (err) {
        if (isUniqueViolation(err)) throw new DuplicateTierGrantError(tier.name);
        throw err;
      }
      await insertAllowlistRecord(client, { serverRegistrationId: sr.id, feedTierId: tier.id, ip: sr.declaredIp });
      break;
    }
    case "software":
      // S3: next slice writes the licenses row here (spec section 3 "software handler" note).
      throw new SoftwareRequestsNotShippedError();
  }

  await client.query(
    `update access_requests
     set status = 'approved', decision = $2, ends_at = $3, invoice_ref = $4, decided_by = $5, decided_at = now(), reason = null
     where id = $1`,
    [envelope.id, input.decision, endsAt, invoiceRef, input.decidedBy]
  );
  return { requestId: envelope.id, feedSubscriptionId, endsAt, decision: input.decision, tierKey };
}

export async function approveAccessRequest(input: ApproveAccessRequestInput): Promise<ApproveAccessRequestResult> {
  resolveDecision(input);
  const client = await pool.connect();
  try {
    await client.query("begin");
    const result = await approveOnClient(client, input);
    await client.query("commit");
    return result;
  } catch (err) {
    await client.query("rollback");
    throw err;
  } finally {
    client.release();
  }
}

// ---------------------------------------------------------------------------------------------
// Section 6: rejection (Source G(b))
// ---------------------------------------------------------------------------------------------

export interface RejectAccessRequestInput {
  requestId: string;
  decidedBy: string;
  reason: string | null;
}

export async function rejectAccessRequest(input: RejectAccessRequestInput): Promise<void> {
  const client = await pool.connect();
  try {
    await client.query("begin");
    const envelope = await lockPendingEnvelope(client, input.requestId);
    await client.query(
      `update access_requests set status = 'rejected', reason = $2, decided_by = $3, decided_at = now() where id = $1`,
      [envelope.id, input.reason, input.decidedBy]
    );
    await client.query("commit");
  } catch (err) {
    await client.query("rollback");
    throw err;
  } finally {
    client.release();
  }
}

// ---------------------------------------------------------------------------------------------
// Section 7: self-serve trial (Source H, fable P8; coxwell notice C7)
// ---------------------------------------------------------------------------------------------

export interface StartSelfServeTrialInput {
  userId: string;
  serverRegistrationId: string;
  feedTierId: string;
  tierKey: string;
}

/** Source H's pre-approved envelope: create a batch of one and approve it as a trial in the
 * SAME transaction, decided_by NULL (there is no admin), decided_at = now(). The queue shows
 * it as decided with no decider ("self-serve"). Eligibility and one-trial-per-(user, tier)
 * (feed_tier_trials_user_tier_uidx, 0036) are checked before the transaction opens so the
 * existing errors surface unchanged; the feed_tier_trials row itself is the caller's
 * after-commit step (feed-tier-trials.ts is not edited in this slice). */
export async function startSelfServeTrial(input: StartSelfServeTrialInput): Promise<ApproveAccessRequestResult> {
  if (!isTrialEligibleTier(input.tierKey)) throw new TrialNotEligibleError();
  const claimed = await pool.query(`select 1 from feed_tier_trials where user_id = $1 and tier_key = $2`, [input.userId, input.tierKey]);
  if (claimed.rowCount) throw new TrialAlreadyClaimedError();

  const client = await pool.connect();
  try {
    await client.query("begin");
    const { requestIds } = await createBatchOnClient(client, {
      userId: input.userId,
      items: [{ kind: "feed_tier", serverRegistrationId: input.serverRegistrationId, feedTierId: input.feedTierId }],
    });
    const result = await approveOnClient(client, {
      requestId: requestIds[0],
      decidedBy: null,
      decision: "trial",
      endsAt: null,
      invoiceRef: null,
    });
    await client.query("commit");
    return result;
  } catch (err) {
    await client.query("rollback");
    throw err;
  } finally {
    client.release();
  }
}

// ---------------------------------------------------------------------------------------------
// Section 5: queue read (Sources E, I)
// ---------------------------------------------------------------------------------------------

export interface AccessRequestRow {
  id: string;
  userId: string;
  productKind: AccessProductKind;
  batchId: string;
  status: AccessRequestStatus;
  /** NULL on envelopes 0086 copied from feed_tier_requests (Source I) -- rendered "-". */
  decision: AccessDecision | null;
  endsAt: Date | null;
  invoiceRef: string | null;
  reason: string | null;
  /** NULL with decision = 'trial' is the self-serve trial (section 7) -- rendered "self-serve". */
  decidedBy: string | null;
  decidedAt: Date | null;
  legacyFeedTierRequestId: string | null;
  createdAt: Date;
  userName: string | null;
  userEmail: string | null;
  telegramUserId: string | null;
  serverRegistrationId: string | null;
  feedTierId: string | null;
  tierKey: string | null;
  tierName: string | null;
  regionKey: string | null;
  serverName: string | null;
  declaredIp: string | null;
  licenseId: string | null;
  licenseKey: string | null;
  productId: string | null;
}

interface ListRow {
  id: string;
  user_id: string;
  product_kind: AccessProductKind;
  batch_id: string;
  status: AccessRequestStatus;
  decision: AccessDecision | null;
  ends_at: Date | null;
  invoice_ref: string | null;
  reason: string | null;
  decided_by: string | null;
  decided_at: Date | null;
  legacy_feed_tier_request_id: string | null;
  created_at: Date;
  user_name: string | null;
  user_email: string | null;
  telegram_user_id: string | null;
  server_registration_id: string | null;
  feed_tier_id: string | null;
  tier_key: string | null;
  tier_name: string | null;
  region_key: string | null;
  server_name: string | null;
  declared_ip: string | null;
  license_id: string | null;
  license_key: string | null;
  product_id: string | null;
}

/** Status and decision come from the envelope alone (Source E); the detail tables are LEFT
 * JOINed for display columns only. No join to feed_tier_requests or feed_subscriptions. */
const LIST_SQL = `
  select a.id, a.user_id, a.product_kind, a.batch_id, a.status, a.decision, a.ends_at,
         a.invoice_ref, a.reason, a.decided_by, a.decided_at, a.legacy_feed_tier_request_id,
         a.created_at,
         u.display_name as user_name, u.email as user_email, u.telegram_user_id,
         d.server_registration_id, d.feed_tier_id, ft.tier_key, ft.name as tier_name, ft.region_key,
         sr.server_name, sr.declared_ip, sr.license_id, l.license_key,
         s.product_id
  from access_requests a
  join users u on u.id = a.user_id
  left join feed_tier_request_details d on d.request_id = a.id
  left join feed_tiers ft on ft.id = d.feed_tier_id
  left join server_registrations sr on sr.id = d.server_registration_id
  left join licenses l on l.id = sr.license_id
  left join software_request_details s on s.request_id = a.id
`;

function mapListRow(row: ListRow): AccessRequestRow {
  return {
    id: row.id,
    userId: row.user_id,
    productKind: row.product_kind,
    batchId: row.batch_id,
    status: row.status,
    decision: row.decision,
    endsAt: row.ends_at,
    invoiceRef: row.invoice_ref,
    reason: row.reason,
    decidedBy: row.decided_by,
    decidedAt: row.decided_at,
    legacyFeedTierRequestId: row.legacy_feed_tier_request_id,
    createdAt: row.created_at,
    userName: row.user_name,
    userEmail: row.user_email,
    telegramUserId: row.telegram_user_id,
    serverRegistrationId: row.server_registration_id,
    feedTierId: row.feed_tier_id,
    tierKey: row.tier_key,
    tierName: row.tier_name,
    regionKey: row.region_key,
    serverName: row.server_name,
    declaredIp: row.declared_ip,
    licenseId: row.license_id,
    licenseKey: row.license_key,
    productId: row.product_id,
  };
}

export interface ListAccessRequestsOptions {
  status?: AccessRequestStatus;
  userId?: string;
  productKind?: AccessProductKind;
  ids?: string[];
}

export async function listAccessRequests(options: ListAccessRequestsOptions = {}): Promise<AccessRequestRow[]> {
  const conditions: string[] = [];
  const params: unknown[] = [];
  if (options.status) {
    params.push(options.status);
    conditions.push(`a.status = $${params.length}`);
  }
  if (options.userId) {
    params.push(options.userId);
    conditions.push(`a.user_id = $${params.length}`);
  }
  if (options.productKind) {
    params.push(options.productKind);
    conditions.push(`a.product_kind = $${params.length}`);
  }
  if (options.ids) {
    params.push(options.ids);
    conditions.push(`a.id = any($${params.length}::uuid[])`);
  }
  const where = conditions.length ? `where ${conditions.join(" and ")}` : "";
  const result = await pool.query<ListRow>(
    `${LIST_SQL} ${where} order by a.created_at desc, a.batch_id, ft.tier_key`,
    params
  );
  return result.rows.map(mapListRow);
}

/** Section 4(c): a pending Telegram card sent before deploy carries a LEGACY
 * feed_tier_requests.id; 0086 section 3 copied it onto legacy_feed_tier_request_id, as N
 * envelopes when it was a package. Returns every envelope the id names; the caller refuses to
 * decide more than one from a single button (PackageNeedsQueueError). */
export async function findAccessRequestsByIdOrLegacyId(id: string): Promise<AccessRequestRow[]> {
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id)) return [];
  const result = await pool.query<ListRow>(
    `${LIST_SQL} where a.id = $1 or a.legacy_feed_tier_request_id = $1 order by a.created_at desc, a.batch_id, ft.tier_key`,
    [id]
  );
  return result.rows.map(mapListRow);
}
