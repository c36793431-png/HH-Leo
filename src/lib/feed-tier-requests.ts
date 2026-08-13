import { pool } from "./db";
import { notifyFeedTierRequestSubmitted } from "./telemetry-sink";
import { sendHftAlertMessage } from "./telegram-hft-alert-bot";
import { feedTierMeta, isFeedRegion, type FeedRegion } from "./feed-tier-catalogue";

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
  status: FeedTierRequestStatus;
  reason: string | null;
  createdAt: Date;
  actionedAt: Date | null;
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
  status: string;
  reason: string | null;
  created_at: Date;
  actioned_at: Date | null;
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
    serverIp: row.declared_ip,
    status: row.status as FeedTierRequestStatus,
    reason: row.reason,
    createdAt: row.created_at,
    actionedAt: row.actioned_at,
  };
}

const SELECT_BASE = `
  select ftr.id, ftr.user_id, u.display_name as user_name, u.email as user_email, u.telegram_user_id,
         ftr.license_id, l.license_key, ftr.region, ftr.tier_key, ftr.status, ftr.reason,
         ftr.created_at, ftr.actioned_at,
         sr.server_name, sr.declared_ip
  from feed_tier_requests ftr
  join users u on u.id = ftr.user_id
  join licenses l on l.id = ftr.license_id
  left join server_registrations sr on sr.license_id = ftr.license_id
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
    email: row.userEmail,
    tierName: row.tierName,
    licenseKey: row.licenseKeyTail ? `****${row.licenseKeyTail}` : "unknown",
    serverIp: row.serverIp,
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

export async function approveFeedTierRequest(id: string, actionedBy: string): Promise<FeedTierRequestRow> {
  const row = await actionRequest(id, "approved", actionedBy, null);
  await notifyClient(row, `<b>✅ Feed access approved</b>\n${row.tierName} is approved on your account.`);
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
