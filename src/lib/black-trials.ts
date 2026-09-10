import { pool } from "./db";
import { notifyBlackTrialRequested, notifyBlackTrialConvertRequested } from "./telemetry-sink";
import { sendTelegramMessage } from "./telegram-bot";

export const BLACK_TRIAL_STATUSES = ["requested", "active", "declined", "converted"] as const;
export type BlackTrialStatus = (typeof BLACK_TRIAL_STATUSES)[number];

/** coxwell's ruling (2026-09-10): one 3-day trial, length fixed, not an admin-chosen value. */
export const BLACK_TRIAL_DAYS = 3;

/** One *started* trial per client, ever — thrown by requestBlackTrial so callers can show a
 * clean refusal instead of a raw constraint-violation 500. marcus's 2026-09-10 correction: this
 * fires for a trial that actually began (approved or converted), never for a merely-declined
 * or still-pending request -- see getStartedBlackTrialForUser. */
export class BlackTrialAlreadyUsedError extends Error {
  constructor() {
    super("You have already used your Black trial.");
    this.name = "BlackTrialAlreadyUsedError";
  }
}

/** A `requested` row for this user is still awaiting action -- a concurrency guard (don't let
 * someone queue five requests), not a permanent burn. Distinct from AlreadyUsedError so the
 * client copy can say "pending" instead of "used". */
export class BlackTrialAlreadyPendingError extends Error {
  constructor() {
    super("Your Black trial request is already pending review.");
    this.name = "BlackTrialAlreadyPendingError";
  }
}

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

/** Most recent trial row for this user, of any status -- across every license they hold. This
 * is a display query for the account/servers card (see blackTrialCardProps), not the
 * eligibility check: a `declined` row here does NOT mean the user is blocked from requesting
 * again (see requestBlackTrial / getStartedBlackTrialForUser). */
export async function getBlackTrialForUser(userId: string): Promise<BlackTrialRow | null> {
  const result = await pool.query<Row>(
    `${SELECT_BASE} where bt.user_id = $1 order by bt.requested_at desc limit 1`,
    [userId]
  );
  return result.rowCount ? mapRow(result.rows[0]) : null;
}

/** Statuses where a trial actually started. coxwell's "one trial" ruling (2026-09-10) reaches
 * only trials that happened -- a `declined` request never began one, so it's deliberately
 * excluded here (marcus's same-day correction to the original row-existence gate). Mirrors the
 * partial unique index in migration 0084 (minus 'requested', which only guards concurrency). */
async function getStartedBlackTrialForUser(userId: string): Promise<BlackTrialRow | null> {
  const result = await pool.query<Row>(
    `${SELECT_BASE} where bt.user_id = $1 and bt.status in ('active', 'converted')
     order by bt.requested_at desc limit 1`,
    [userId]
  );
  return result.rowCount ? mapRow(result.rows[0]) : null;
}

/** A `requested` row blocks a second *concurrent* request -- not a permanent burn, just stops
 * someone queuing five at once. */
async function getPendingBlackTrialForUser(userId: string): Promise<BlackTrialRow | null> {
  const result = await pool.query<Row>(
    `${SELECT_BASE} where bt.user_id = $1 and bt.status = 'requested' order by bt.requested_at desc limit 1`,
    [userId]
  );
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

function isUniqueViolation(err: unknown): boolean {
  return typeof err === "object" && err !== null && (err as { code?: string }).code === "23505";
}

/** Gate (paid-only, one-*started*-trial-per-client) is enforced by the caller checking for a
 * registered server before calling this, by the two pre-checks below, and by the partial
 * unique index on black_trials as a race backstop (migration 0084, not yet applied -- scoped
 * to status in ('requested','active','converted') so a `declined` row never occupies the
 * slot). marcus's 2026-09-10 correction: a trial burns on approval, not on request -- declined
 * must never block a future request, and a still-`requested` row only blocks a *second
 * concurrent* request, not permanently. Deliberately does not name the constraint in the
 * insert (no ON CONFLICT target), catching Postgres unique-violation (23505) generically
 * instead, so this keeps working whether the DB still enforces the old unique(license_id) or
 * 0084 has landed. */
export async function requestBlackTrial(args: RequestArgs): Promise<BlackTrialRow> {
  const started = await getStartedBlackTrialForUser(args.userId);
  if (started) throw new BlackTrialAlreadyUsedError();

  const pending = await getPendingBlackTrialForUser(args.userId);
  if (pending) throw new BlackTrialAlreadyPendingError();

  try {
    const result = await pool.query<{ id: string }>(
      `insert into black_trials (user_id, license_id) values ($1, $2) returning id`,
      [args.userId, args.licenseId]
    );
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
  } catch (err) {
    if (isUniqueViolation(err)) {
      // Race between the pre-checks above and this insert -- re-resolve which case it is
      // instead of guessing, since the two errors mean different things to the client.
      const raced = await getStartedBlackTrialForUser(args.userId);
      throw raced ? new BlackTrialAlreadyUsedError() : new BlackTrialAlreadyPendingError();
    }
    throw err;
  }
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
}

/** Trial length is fixed at BLACK_TRIAL_DAYS, not an admin-supplied value — coxwell's "one 3
 * day trial" ruling (2026-09-10) reads as the length being fixed, not a default suggestion.
 * This is also where the one-trial-per-client slot actually burns (status flips to 'active',
 * which getStartedBlackTrialForUser checks for) -- not requestBlackTrial's insert. */
export async function approveBlackTrial(args: ApproveArgs): Promise<BlackTrialRow> {
  await pool.query(
    `update black_trials
     set status = 'active', approved_at = now(),
         expires_at = now() + ($2 || ' days')::interval,
         endpoint = $3, credentials = $4, actioned_by = $5
     where id = $1`,
    [args.id, BLACK_TRIAL_DAYS, args.endpoint, args.credentials, args.actionedBy]
  );
  const row = await getBlackTrial(args.id);
  if (!row) throw new Error("Black trial not found after approval");

  await notifyClient(
    row,
    `<b>⚫️ Your Black trial is live</b>\nConnection details are on your portal at Account → Servers. ` +
      `Trial runs ${BLACK_TRIAL_DAYS} days.`
  );
  return row;
}

/** Does not burn the client's trial slot -- getStartedBlackTrialForUser only matches
 * 'active'/'converted', so requestBlackTrial lets this same user request again afterwards
 * (marcus's 2026-09-10 correction). */
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
