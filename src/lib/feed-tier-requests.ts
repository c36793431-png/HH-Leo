import { pool } from "./db";
import { notifyFeedTierRequestSubmitted, notifyFeedTierTrialActivated } from "./telemetry-sink";
import { sendHftAlertMessage } from "./telegram-hft-alert-bot";
import { expandTierKey, feedTierMeta, isFeedRegion, isTrialEligibleTier, type FeedRegion } from "./feed-tier-catalogue";
import {
  insertFeedTierTrial,
  notifyTrialClientActivated,
  TrialAlreadyClaimedError,
  TrialNotEligibleError,
} from "./feed-tier-trials";
import {
  FeedTierNotAssignedError,
  getFeedTierForAssignment,
  upsertFeedSubscriptionForRequest,
  upsertFeedSubscriptionMemberForRequest,
} from "./feed-subscriptions";

export const FEED_TIER_REQUEST_STATUSES = ["pending", "approved", "rejected", "provisioned"] as const;
export type FeedTierRequestStatus = (typeof FEED_TIER_REQUEST_STATUSES)[number];

export interface FeedTierRequestRow {
  id: string;
  userId: string;
  userName: string | null;
  userEmail: string | null;
  licenseId: string;
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
  /** The feed_subscriptions row this request's approval wrote, or null if it's not
   * (yet) approved. Written back in the same transaction as the status flip to 'approved'
   * (migration 0078 / m35715) so "approved with no backing grant" becomes impossible to
   * represent, not just unlikely -- see approveFeedTierRequest below. */
  subscriptionId: string | null;
}

interface RequestRow {
  id: string;
  user_id: string;
  user_name: string | null;
  user_email: string | null;
  telegram_user_id: string | null;
  license_id: string;
  license_key: string | null;
  region: string;
  tier_key: string;
  server_name: string | null;
  declared_ip: string | null;
  captured_ip: string | null;
  status: string;
  reason: string | null;
  created_at: Date;
  actioned_at: Date | null;
  subscription_id: string | null;
}

function mapRow(row: RequestRow): FeedTierRequestRow {
  const meta = feedTierMeta(row.tier_key);
  return {
    id: row.id,
    userId: row.user_id,
    userName: row.user_name,
    userEmail: row.user_email,
    licenseId: row.license_id,
    licenseKeyTail: row.license_key ? row.license_key.slice(-4) : null,
    telegramUserId: row.telegram_user_id,
    region: isFeedRegion(row.region) ? row.region : "london",
    tierKey: row.tier_key,
    tierName: meta?.name ?? row.tier_key,
    serverName: row.server_name,
    serverIp: row.declared_ip ?? row.captured_ip,
    serverRegistered: row.declared_ip != null,
    status: row.status as FeedTierRequestStatus,
    reason: row.reason,
    createdAt: row.created_at,
    actionedAt: row.actioned_at,
    subscriptionId: row.subscription_id,
  };
}

const SELECT_BASE = `
  select ftr.id, ftr.user_id, u.display_name as user_name, u.email as user_email, u.telegram_user_id,
         ftr.license_id, l.license_key, ftr.region, ftr.tier_key, ftr.status, ftr.reason,
         ftr.created_at, ftr.actioned_at, ftr.subscription_id,
         sr.server_name, sr.declared_ip, ci.ip as captured_ip
  from feed_tier_requests ftr
  join users u on u.id = ftr.user_id
  join licenses l on l.id = ftr.license_id
  left join server_registrations sr on sr.license_id = ftr.license_id
  left join lateral (
    select ip from connection_ips
    where license_id = ftr.license_id
    order by captured_at desc
    limit 1
  ) ci on true
`;

interface CreateArgs {
  userId: string;
  licenseId: string;
  region: FeedRegion;
  tierKey: string;
  adminUrl: string;
}

export async function createFeedTierRequest(args: CreateArgs): Promise<FeedTierRequestRow> {
  const result = await pool.query<RequestRow>(
    `insert into feed_tier_requests (user_id, license_id, region, tier_key)
     values ($1, $2, $3, $4)
     returning id`,
    [args.userId, args.licenseId, args.region, args.tierKey]
  );
  const row = await getFeedTierRequest(result.rows[0].id);
  if (!row) throw new Error("failed to load created feed tier request");

  await notifyFeedTierRequestSubmitted({
    id: row.id,
    email: row.userEmail,
    tierName: row.tierName,
    licenseKey: row.licenseKeyTail ? `****${row.licenseKeyTail}` : "unknown",
    serverName: row.serverName,
    serverIp: row.serverIp,
    serverRegistered: row.serverRegistered,
    adminUrl: args.adminUrl,
  }).catch(() => {});

  return row;
}

export async function getFeedTierRequest(id: string): Promise<FeedTierRequestRow | null> {
  const result = await pool.query<RequestRow>(`${SELECT_BASE} where ftr.id = $1`, [id]);
  return result.rowCount ? mapRow(result.rows[0]) : null;
}

export interface ListFeedTierRequestsOptions {
  status?: FeedTierRequestStatus;
  userId?: string;
}

export async function listFeedTierRequests(options: ListFeedTierRequestsOptions = {}): Promise<FeedTierRequestRow[]> {
  const conditions: string[] = [];
  const params: unknown[] = [];
  if (options.status) {
    params.push(options.status);
    conditions.push(`ftr.status = $${params.length}`);
  }
  if (options.userId) {
    params.push(options.userId);
    conditions.push(`ftr.user_id = $${params.length}`);
  }
  const where = conditions.length ? `where ${conditions.join(" and ")}` : "";
  const result = await pool.query<RequestRow>(`${SELECT_BASE} ${where} order by ftr.created_at desc`, params);
  return result.rows.map(mapRow);
}

async function actionRequest(
  id: string,
  status: "approved" | "rejected",
  actionedBy: string,
  reason: string | null
): Promise<FeedTierRequestRow> {
  await pool.query(
    `update feed_tier_requests set status = $2, reason = $3, actioned_at = now(), actioned_by = $4 where id = $1`,
    [id, status, reason, actionedBy]
  );
  const row = await getFeedTierRequest(id);
  if (!row) throw new Error("feed tier request not found after update");
  return row;
}

/** Best-effort DM via the Trading Alerts bot -- same "not started this bot" 403 handling
 * as /v1/hft-alert; a failed send must never fail the approve/reject action itself. */
async function notifyClient(row: FeedTierRequestRow, text: string): Promise<void> {
  if (!row.telegramUserId) return;
  await sendHftAlertMessage(row.telegramUserId, text).catch(() => {});
}

/** Only trial-eligible tiers (ld-alpha-85, ld-ultra, ny-normal, ny-fast) get a real
 * feed_tier_trials row + "trial activated" ping on approve -- the paid-only middle tiers
 * (ld-beta-56 etc.) have no trial concept, so approving one of those stays a plain status
 * flip + client DM, same as before (leo-feed-activation-notification-2026-08-17). A failure
 * here (already claimed, race, etc.) must never fail the approve action itself. */
async function activateTrialIfEligible(row: FeedTierRequestRow, adminUrl: string): Promise<void> {
  if (!isTrialEligibleTier(row.tierKey)) return;
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

/** Approve = one transaction: the grant write and the status flip must land together or not
 * at all (Fable's ruling, thread leo-region-vs-tier-subscription-key-collision-2026-09-03,
 * m35715 -- "the request read approved while no grant existed" was exactly this pair of
 * writes being two separate, uncoordinated calls). The grant write upserts on THIS request's
 * id, not on the tier (upsertFeedSubscriptionForRequest, feed-subscriptions.ts) -- a
 * DuplicateTierGrantError (this tier already has a live grant from a DIFFERENT request) rolls
 * the whole transaction back, so the request stays 'pending' and the admin sees a real error
 * instead of a silent merge into someone else's row. subscription_id is written back onto the
 * request in the same statement as the 'approved' flip (migration 0078), so "approved with no
 * backing grant" stops being representable in the data at all.
 *
 * pending.tierKey may be a package pseudo-key (ld-retail-package, ny-retail-package -- see
 * PACKAGE_TIER_KEYS in feed-tier-catalogue.ts) with no feed_tiers row of its own, so it's
 * expanded via expandTierKey() -- the same expansion feed-providers.ts already uses to scope
 * package requests into a provider's queue -- before any tier lookup runs. A non-package key
 * expands to itself, so this is a no-op for the single-tier case. Every member is resolved and
 * provider-checked up front so a mid-grant failure never leaves a package half-assigned. Only
 * the first member can carry the request's own id (feed_subscriptions_request_uidx allows one
 * subscription row per request_id); the rest grant via upsertFeedSubscriptionMemberForRequest's
 * business-key upsert in the same transaction (leo-package-grant-fix-2026-09-04 -- previously
 * a package approval threw "Unknown feed tier" on this lookup before ever reaching a grant
 * write). */
export async function approveFeedTierRequest(id: string, actionedBy: string, adminUrl: string): Promise<FeedTierRequestRow> {
  const pending = await getFeedTierRequest(id);
  if (!pending) throw new Error("feed tier request not found");

  // Trial row (if eligible) goes in first -- best-effort, see activateTrialIfEligible -- so
  // EFFECTIVE_STATUS_SQL's trial carve-out already sees it before the subscription row it
  // backs becomes visible on the provider's Accounts page. Deliberately outside the
  // transaction below: a trial-insert failure must never roll back a successful approval.
  await activateTrialIfEligible(pending, adminUrl);

  const [primaryKey, ...memberKeys] = expandTierKey(pending.tierKey);
  const primary = await getFeedTierForAssignment(primaryKey);
  if (!primary.providerUserId) throw new FeedTierNotAssignedError(primary.tierName, primary.regionKey);
  const members = await Promise.all(memberKeys.map((k) => getFeedTierForAssignment(k)));
  const unassigned = members.find((m) => !m.providerUserId);
  if (unassigned) throw new FeedTierNotAssignedError(unassigned.tierName, unassigned.regionKey);

  const client = await pool.connect();
  let subscriptionId: string;
  try {
    await client.query("begin");
    subscriptionId = await upsertFeedSubscriptionForRequest(client, {
      requestId: pending.id,
      providerUserId: primary.providerUserId,
      subscriberUserId: pending.userId,
      feedTierId: primary.feedTierId,
      tierName: primary.tierName,
    });
    for (const member of members) {
      await upsertFeedSubscriptionMemberForRequest(client, {
        providerUserId: member.providerUserId!,
        subscriberUserId: pending.userId,
        feedTierId: member.feedTierId,
        tierName: member.tierName,
      });
    }
    await client.query(
      `update feed_tier_requests
       set status = 'approved', reason = null, actioned_at = now(), actioned_by = $2, subscription_id = $3
       where id = $1`,
      [id, actionedBy, subscriptionId]
    );
    await client.query("commit");
  } catch (err) {
    await client.query("rollback");
    throw err;
  } finally {
    client.release();
  }

  const row = await getFeedTierRequest(id);
  if (!row) throw new Error("feed tier request not found after approval");
  // Trial-eligible tiers get the richer notifyTrialClientActivated() DM instead (see
  // activateTrialIfEligible) -- sending both would double-DM the client
  // (coxwell green-light, leo-feed-activation-notification-2026-08-17 / m22397).
  if (!isTrialEligibleTier(row.tierKey)) {
    await notifyClient(row, `<b>✅ Feed access approved</b>\n${row.tierName} is approved on your account.`);
  }
  return row;
}

export async function rejectFeedTierRequest(id: string, actionedBy: string, reason: string | null): Promise<FeedTierRequestRow> {
  const row = await actionRequest(id, "rejected", actionedBy, reason);
  await notifyClient(
    row,
    `<b>❌ Feed access declined</b>\n${row.tierName} request was declined.` + (reason ? `\nReason: ${reason}` : "")
  );
  return row;
}
