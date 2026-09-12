import { notifyFeedTierRequestSubmitted, notifyFeedTierTrialActivated } from "./telemetry-sink";
import { sendHftAlertMessage } from "./telegram-hft-alert-bot";
import { expandTierKey, feedTierMeta, isFeedRegion, isTrialEligibleTier, type FeedRegion } from "./feed-tier-catalogue";
import {
  insertFeedTierTrial,
  notifyTrialClientActivated,
  startFeedTierTrial,
  TrialAlreadyClaimedError,
  TrialNotEligibleError,
} from "./feed-tier-trials";
import { getFeedTierForAssignment } from "./feed-subscriptions";
import {
  approveAccessRequest,
  createAccessRequestBatch,
  findAccessRequestsByIdOrLegacyId,
  getServerRegistrationForLicense,
  listAccessRequests,
  NoServerForLicenseError,
  PackageNeedsQueueError,
  PaidApprovalNeedsQueueError,
  rejectAccessRequest,
  startSelfServeTrial,
  type AccessDecision,
  type AccessRequestRow,
} from "./access-requests";

/** 0086 phase 2 (step ii): this module is now a compatibility FACADE over lib/access-requests.ts
 * (docs/specs/0086-phase2-code.md section 5 "Facade" and 4(f)). It writes NOTHING to
 * feed_tier_requests (Source A) and reads nothing from it; every caller keeps its function
 * names and the FeedTierRequestRow shape, backed by the access_requests envelope + detail read.
 * Shape deltas: `id` is the envelope id; a legacy package request shows as N rows (one per
 * member tier, as 0086 section 3 copied it); `status` loses 'provisioned'; new optional fields
 * decision / endsAt / invoiceRef / batchId / decidedBy. */

export const FEED_TIER_REQUEST_STATUSES = ["pending", "approved", "rejected"] as const;
/** 'provisioned' is a TYPE-ONLY legacy member: no row carries it after 0086 (Source G(d)) and
 * the array above does not list it, so no filter, style or stat is built for it. It stays in
 * the union only until src/app/feeds/[region]/tiers/page.tsx:177 (undeclared, marcus to rule)
 * drops its comparison against it; then this line loses the `| "provisioned"`. */
export type FeedTierRequestStatus = (typeof FEED_TIER_REQUEST_STATUSES)[number] | "provisioned";

export interface FeedTierRequestRow {
  id: string;
  userId: string;
  userName: string | null;
  userEmail: string | null;
  /** The server row's licence; nullable since 0086 (server_registrations.license_id drop not null). */
  licenseId: string | null;
  licenseKeyTail: string | null;
  telegramUserId: string | null;
  region: FeedRegion;
  tierKey: string;
  tierName: string;
  serverName: string | null;
  serverIp: string | null;
  serverRegistered: boolean;
  status: FeedTierRequestStatus;
  reason: string | null;
  createdAt: Date;
  actionedAt: Date | null;
  batchId: string;
  /** NULL on envelopes 0086 copied from the old table (Source I). */
  decision: AccessDecision | null;
  endsAt: Date | null;
  invoiceRef: string | null;
  /** NULL with decision = 'trial' means self-serve (spec section 7; rendered "self-serve"). */
  decidedBy: string | null;
}

function mapRow(a: AccessRequestRow): FeedTierRequestRow {
  const tierKey = a.tierKey ?? "";
  const meta = feedTierMeta(tierKey);
  return {
    id: a.id,
    userId: a.userId,
    userName: a.userName,
    userEmail: a.userEmail,
    licenseId: a.licenseId,
    licenseKeyTail: a.licenseKey ? a.licenseKey.slice(-4) : null,
    telegramUserId: a.telegramUserId,
    region: a.regionKey && isFeedRegion(a.regionKey) ? a.regionKey : "london",
    tierKey,
    tierName: meta?.name ?? a.tierName ?? tierKey,
    serverName: a.serverName,
    serverIp: a.declaredIp,
    serverRegistered: a.declaredIp != null,
    status: a.status,
    reason: a.reason,
    createdAt: a.createdAt,
    actionedAt: a.decidedAt,
    batchId: a.batchId,
    decision: a.decision,
    endsAt: a.endsAt,
    invoiceRef: a.invoiceRef,
    decidedBy: a.decidedBy,
  };
}

interface CreateArgs {
  userId: string;
  licenseId: string;
  region: FeedRegion;
  tierKey: string;
  adminUrl: string;
}

/** Request Access (spec section 2). The modal still posts one (region, tierKey, licenseId);
 * the licence resolves to its server row, a package key expands to N items in ONE batch
 * (Source F), a single tier is a batch of one. Returns the N envelope rows. */
export async function createFeedTierRequest(args: CreateArgs): Promise<FeedTierRequestRow[]> {
  const server = await getServerRegistrationForLicense(args.licenseId);
  if (!server) throw new NoServerForLicenseError();
  const members = await Promise.all(expandTierKey(args.tierKey).map((k) => getFeedTierForAssignment(k)));
  const { requestIds } = await createAccessRequestBatch({
    userId: args.userId,
    items: members.map((m) => ({ kind: "feed_tier", serverRegistrationId: server.id, feedTierId: m.feedTierId })),
  });
  const rows = (await listAccessRequests({ ids: requestIds })).map(mapRow);
  if (rows.length === 0) throw new Error("failed to load created access requests");

  // After commit, best-effort, once per batch (spec section 2), naming the key the client
  // clicked (package name for a package) rather than N member pings.
  const first = rows[0];
  await notifyFeedTierRequestSubmitted({
    id: first.id,
    email: first.userEmail,
    tierName: feedTierMeta(args.tierKey)?.name ?? args.tierKey,
    licenseKey: first.licenseKeyTail ? `****${first.licenseKeyTail}` : "unknown",
    serverName: first.serverName,
    serverIp: first.serverIp,
    serverRegistered: first.serverRegistered,
    adminUrl: args.adminUrl,
  }).catch(() => {});

  return rows;
}

/** By envelope id, or by a legacy feed_tier_requests id a pre-deploy Telegram card carries
 * (spec 4(c)). A legacy package id maps to N envelopes; this returns the first for status
 * display, and the decide paths below refuse to act on more than one. */
export async function getFeedTierRequest(id: string): Promise<FeedTierRequestRow | null> {
  const rows = await findAccessRequestsByIdOrLegacyId(id);
  return rows.length ? mapRow(rows[0]) : null;
}

export interface ListFeedTierRequestsOptions {
  status?: FeedTierRequestStatus;
  userId?: string;
}

export async function listFeedTierRequests(options: ListFeedTierRequestsOptions = {}): Promise<FeedTierRequestRow[]> {
  const status = options.status === "provisioned" ? undefined : options.status;
  const rows = await listAccessRequests({ status, userId: options.userId, productKind: "feed_tier" });
  return rows.map(mapRow);
}

async function resolveSingleEnvelope(id: string): Promise<AccessRequestRow> {
  const rows = await findAccessRequestsByIdOrLegacyId(id);
  if (rows.length === 0) throw new Error("feed tier request not found");
  if (rows.length > 1) throw new PackageNeedsQueueError(rows.length);
  return rows[0];
}

/** Best-effort DM via the Trading Alerts bot -- same "not started this bot" 403 handling
 * as /v1/hft-alert; a failed send must never fail the approve/reject action itself. */
async function notifyClient(row: FeedTierRequestRow, text: string): Promise<void> {
  if (!row.telegramUserId) return;
  await sendHftAlertMessage(row.telegramUserId, text).catch(() => {});
}

/** feed_tier_trials is NOT retired in this slice (Source H; feed-tier-trials.ts untouched):
 * EFFECTIVE_STATUS_SQL branch (4), the expire-trials cron and the provider Trials tab still
 * read it, so a trial decision on a trial-eligible tier still writes the row, best-effort,
 * after the envelope commit. Its own 7-day clock matches the envelope's derived ends_at to
 * within the after-commit gap (S4). A failure here (already claimed, race, etc.) must never
 * fail the approve action itself. */
async function activateTrialIfEligible(row: FeedTierRequestRow, adminUrl: string): Promise<void> {
  if (!isTrialEligibleTier(row.tierKey) || !row.licenseId) return;
  try {
    const trial = await insertFeedTierTrial({
      userId: row.userId,
      licenseId: row.licenseId,
      region: row.region,
      tierKey: row.tierKey,
    });
    await notifyFeedTierTrialActivated({
      email: trial.userEmail,
      tierName: trial.tierName,
      licenseKey: trial.licenseKeyTail ? `****${trial.licenseKeyTail}` : "unknown",
      activatedAt: trial.trialStartedAt,
      trialEndsAt: trial.trialEndsAt,
      serverName: trial.serverName,
      serverIp: trial.serverIp,
      serverRegistered: trial.serverRegistered,
      adminUrl,
    }).catch(() => {});
    await notifyTrialClientActivated(trial);
  } catch (err) {
    if (err instanceof TrialAlreadyClaimedError || err instanceof TrialNotEligibleError) return;
    console.error("approveFeedTierRequest: failed to activate trial", err);
  }
}

export interface ApproveDecisionInput {
  decision: AccessDecision;
  endsAt: Date | null;
  invoiceRef: string | null;
}

/** Approve ONE line (spec section 3). With a decision (the admin queue, section 4(d)) it is
 * passed through. Without one -- the Telegram card and, until coxwell's C2 is relayed, the
 * provider panel (spec 4(c), files 8 and 9 held) -- the trial-only rule applies: a
 * trial-eligible tier is approved as a 7-day trial, anything else is refused to the admin
 * queue, because neither surface can supply an end date or an invoice ref. */
export async function approveFeedTierRequest(
  id: string,
  actionedBy: string,
  adminUrl: string,
  decision?: ApproveDecisionInput
): Promise<FeedTierRequestRow> {
  const pending = mapRow(await resolveSingleEnvelope(id));
  let input: ApproveDecisionInput;
  if (decision) {
    input = decision;
  } else {
    if (!isTrialEligibleTier(pending.tierKey)) throw new PaidApprovalNeedsQueueError(pending.tierName);
    input = { decision: "trial", endsAt: null, invoiceRef: null };
  }

  await approveAccessRequest({ requestId: pending.id, decidedBy: actionedBy, ...input });

  const row = await getFeedTierRequest(pending.id);
  if (!row) throw new Error("feed tier request not found after approval");
  // After commit, best-effort. A trial on a trial-eligible tier gets the richer
  // notifyTrialClientActivated() DM from activateTrialIfEligible instead of the plain one --
  // sending both would double-DM the client (coxwell green-light,
  // leo-feed-activation-notification-2026-08-17 / m22397).
  if (input.decision === "trial") await activateTrialIfEligible(row, adminUrl);
  if (!(input.decision === "trial" && isTrialEligibleTier(row.tierKey))) {
    await notifyClient(row, `<b>✅ Feed access approved</b>\n${row.tierName} is approved on your account.`);
  }
  return row;
}

export async function rejectFeedTierRequest(id: string, actionedBy: string, reason: string | null): Promise<FeedTierRequestRow> {
  const pending = await resolveSingleEnvelope(id);
  await rejectAccessRequest({ requestId: pending.id, decidedBy: actionedBy, reason });
  const row = await getFeedTierRequest(pending.id);
  if (!row) throw new Error("feed tier request not found after update");
  await notifyClient(
    row,
    `<b>❌ Feed access declined</b>\n${row.tierName} request was declined.` + (reason ? `\nReason: ${reason}` : "")
  );
  return row;
}

interface SelfServeTrialArgs {
  userId: string;
  licenseId: string;
  region: FeedRegion;
  tierKey: string;
  adminUrl: string;
}

export interface SelfServeTrialResult {
  requestId: string;
  /** The feed_tier_trials row id (for the cancel button); null if the best-effort trial-row
   * write failed after the envelope committed. */
  trialId: string | null;
  endsAt: Date;
}

/** Self-serve trial button (spec section 7, answer A: the button survives, coxwell notice C7).
 * Writes Source H's pre-approved envelope + subscription row + allowlist record in one
 * transaction (startSelfServeTrial), then, after commit and best-effort, the same
 * feed_tier_trials row + client/admin notifications the button wrote before (startFeedTierTrial,
 * feed-tier-trials.ts, unchanged). */
export async function startSelfServeFeedTierTrial(args: SelfServeTrialArgs): Promise<SelfServeTrialResult> {
  if (!isTrialEligibleTier(args.tierKey)) throw new TrialNotEligibleError();
  const server = await getServerRegistrationForLicense(args.licenseId);
  if (!server) throw new NoServerForLicenseError();
  const tier = await getFeedTierForAssignment(args.tierKey);

  const approved = await startSelfServeTrial({
    userId: args.userId,
    serverRegistrationId: server.id,
    feedTierId: tier.feedTierId,
    tierKey: args.tierKey,
  });

  try {
    const trial = await startFeedTierTrial({
      userId: args.userId,
      licenseId: args.licenseId,
      region: args.region,
      tierKey: args.tierKey,
      adminUrl: args.adminUrl,
    });
    return { requestId: approved.requestId, trialId: trial.id, endsAt: trial.trialEndsAt };
  } catch (err) {
    console.error("startSelfServeFeedTierTrial: envelope committed but the feed_tier_trials row failed", err);
    return { requestId: approved.requestId, trialId: null, endsAt: approved.endsAt };
  }
}
