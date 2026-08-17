import { pool } from "./db";
import { notifyBlackTrialRequested, notifyBlackTrialConvertRequested } from "./telemetry-sink";
import { sendTelegramMessage } from "./telegram-bot";

export const BLACK_TRIAL_STATUSES = ["requested", "active", "declined", "converted"] as const;
export type BlackTrialStatus = (typeof BLACK_TRIAL_STATUSES)[number];

export interface BlackTrialRow {
  id: string;
  userId: string;
  userName: string | null;
  userEmail: string | null;
  telegramUserId: string | null;
  licenseId: string;
  licenseKeyTail: string | null;
  serverName: string | null;
  serverIp: string | null;
  status: BlackTrialStatus;
  requestedAt: Date;
  approvedAt: Date | null;
  expiresAt: Date | null;
  endpoint: string | null;
  credentials: string | null;
  reason: string | null;
}

interface Row {
  id: string;
  user_id: string;
  user_name: string | null;
  user_email: string | null;
  telegram_user_id: string | null;
  license_id: string;
  license_key: string | null;
  server_name: string | null;
  declared_ip: string | null;
  status: string;
  requested_at: Date;
  approved_at: Date | null;
  expires_at: Date | null;
  endpoint: string | null;
  credentials: string | null;
  reason: string | null;
}

function mapRow(row: Row): BlackTrialRow {
  return {
    id: row.id,
    userId: row.user_id,
    userName: row.user_name,
    userEmail: row.user_email,
    telegramUserId: row.telegram_user_id,
    licenseId: row.license_id,
    licenseKeyTail: row.license_key ? row.license_key.slice(-4) : null,
    serverName: row.server_name,
    serverIp: row.declared_ip,
    status: row.status as BlackTrialStatus,
    requestedAt: row.requested_at,
    approvedAt: row.approved_at,
    expiresAt: row.expires_at,
    endpoint: row.endpoint,
    credentials: row.credentials,
    reason: row.reason,
  };
}

const SELECT_BASE = `
  select bt.id, bt.user_id, u.display_name as user_name, u.email as user_email, u.telegram_user_id,
         bt.license_id, l.license_key, sr.server_name, sr.declared_ip,
         bt.status, bt.requested_at, bt.approved_at, bt.expires_at, bt.endpoint, bt.credentials, bt.reason
  from black_trials bt
  join users u on u.id = bt.user_id
  join licenses l on l.id = bt.license_id
  left join server_registrations sr on sr.license_id = bt.license_id
`;

export async function getBlackTrialForLicense(licenseId: string): Promise<BlackTrialRow | null> {
  const result = await pool.query<Row>(`${SELECT_BASE} where bt.license_id = $1`, [licenseId]);
  return result.rowCount ? mapRow(result.rows[0]) : null;
}

export async function getBlackTrial(id: string): Promise<BlackTrialRow | null> {
  const result = await pool.query<Row>(`${SELECT_BASE} where bt.id = $1`, [id]);
  return result.rowCount ? mapRow(result.rows[0]) : null;
}

export async function listBlackTrials(status?: BlackTrialStatus): Promise<BlackTrialRow[]> {
  const where = status ? `where bt.status = $1` : "";
  const params = status ? [status] : [];
  const result = await pool.query<Row>(`${SELECT_BASE} ${where} order by bt.requested_at desc`, params);
  return result.rows.map(mapRow);
}

interface RequestArgs {
  userId: string;
  licenseId: string;
  adminUrl: string;
}

/** Gate (paid-only, one-per-desk) is enforced by the caller checking for an existing row plus
 * a registered server before calling this, and by the unique(license_id) constraint as a
 * backstop against a race between two concurrent requests. */
export async function requestBlackTrial(args: RequestArgs): Promise<BlackTrialRow> {
  const result = await pool.query<{ id: string }>(
    `insert into black_trials (user_id, license_id) values ($1, $2)
     on conflict (license_id) do nothing
     returning id`,
    [args.userId, args.licenseId]
  );
  if (result.rowCount === 0) {
    const existing = await getBlackTrialForLicense(args.licenseId);
    if (existing) return existing;
    throw new Error("Black trial already requested for this license");
  }
  const row = await getBlackTrial(result.rows[0].id);
  if (!row) throw new Error("failed to load created Black trial request");

  await notifyBlackTrialRequested({
    email: row.userEmail,
    licenseKey: row.licenseKeyTail ? `****${row.licenseKeyTail}` : "unknown",
    serverName: row.serverName,
    serverIp: row.serverIp,
    adminUrl: args.adminUrl,
  }).catch(() => {});

  return row;
}

async function notifyClient(row: BlackTrialRow, text: string): Promise<void> {
  if (!row.telegramUserId) return;
  await sendTelegramMessage(row.telegramUserId, text).catch(() => {});
}

export interface ApproveArgs {
  id: string;
  actionedBy: string;
  endpoint: string;
  credentials: string;
  trialDays: number;
}

export async function approveBlackTrial(args: ApproveArgs): Promise<BlackTrialRow> {
  await pool.query(
    `update black_trials
     set status = 'active', approved_at = now(),
         expires_at = now() + ($2 || ' days')::interval,
         endpoint = $3, credentials = $4, actioned_by = $5
     where id = $1`,
    [args.id, args.trialDays, args.endpoint, args.credentials, args.actionedBy]
  );
  const row = await getBlackTrial(args.id);
  if (!row) throw new Error("Black trial not found after approval");

  await notifyClient(
    row,
    `<b>⚫️ Your Black trial is live</b>\nConnection details are on your portal at Account → Servers. ` +
      `Trial runs ${args.trialDays} days.`
  );
  return row;
}

export async function declineBlackTrial(id: string, actionedBy: string, reason: string | null): Promise<BlackTrialRow> {
  await pool.query(
    `update black_trials set status = 'declined', reason = $2, actioned_by = $3 where id = $1`,
    [id, reason, actionedBy]
  );
  const row = await getBlackTrial(id);
  if (!row) throw new Error("Black trial not found after decline");

  await notifyClient(
    row,
    `<b>Black trial request declined</b>` + (reason ? `\nReason: ${reason}` : "")
  );
  return row;
}

/** "Upgrade to keep" click on the in-portal countdown. There's no existing table shaped for
 * a generic cross-catalogue conversion request (feed_tier_requests' region check rejects
 * anything outside london/ny/cme/tokyo, and Black isn't in feed-tier-catalogue.ts) — so this
 * just flags status + alerts coxwell directly rather than forcing a schema mismatch. */
export async function requestBlackTrialConversion(licenseId: string): Promise<BlackTrialRow> {
  const row = await getBlackTrialForLicense(licenseId);
  if (!row) throw new Error("No Black trial on this license");
  if (row.status !== "active") throw new Error("Trial isn't active");

  await notifyBlackTrialConvertRequested({
    email: row.userEmail,
    licenseKey: row.licenseKeyTail ? `****${row.licenseKeyTail}` : "unknown",
    expiresAt: row.expiresAt,
  }).catch(() => {});

  return row;
}

export async function markBlackTrialConverted(id: string, actionedBy: string): Promise<BlackTrialRow> {
  await pool.query(`update black_trials set status = 'converted', actioned_by = $2 where id = $1`, [id, actionedBy]);
  const row = await getBlackTrial(id);
  if (!row) throw new Error("Black trial not found after conversion");
  return row;
}
