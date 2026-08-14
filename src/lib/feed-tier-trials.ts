import { pool } from "./db";
import { notifyFeedTierTrialStarted, notifyFeedTierTrialConverted } from "./telemetry-sink";
import { sendHftAlertMessage } from "./telegram-hft-alert-bot";
import { feedTierMeta, isFeedRegion, isTrialEligibleTier, type FeedRegion } from "./feed-tier-catalogue";

export const TRIAL_DURATION_DAYS = 7;
export const TRIAL_STATUSES = ["active", "expired", "converted", "cancelled"] as const;
export type TrialStatus = (typeof TRIAL_STATUSES)[number];

export interface FeedTierTrialRow {
  id: string;
  userId: string;
  userName: string | null;
  userEmail: string | null;
  telegramUserId: string | null;
  licenseId: string;
  licenseKeyTail: string | null;
  region: FeedRegion;
  tierKey: string;
  tierName: string;
  trialStatus: TrialStatus;
  trialStartedAt: Date;
  trialEndsAt: Date;
  convertedAt: Date | null;
  cancelledAt: Date | null;
}

interface TrialRow {
  id: string;
  user_id: string;
  user_name: string | null;
  user_email: string | null;
  telegram_user_id: string | null;
  license_id: string;
  license_key: string | null;
  region: string;
  tier_key: string;
  trial_status: string;
  trial_started_at: Date;
  trial_ends_at: Date;
  converted_at: Date | null;
  cancelled_at: Date | null;
}

function mapRow(row: TrialRow): FeedTierTrialRow {
  const meta = feedTierMeta(row.tier_key);
  return {
    id: row.id,
    userId: row.user_id,
    userName: row.user_name,
    userEmail: row.user_email,
    telegramUserId: row.telegram_user_id,
    licenseId: row.license_id,
    licenseKeyTail: row.license_key ? row.license_key.slice(-4) : null,
    region: isFeedRegion(row.region) ? row.region : "london",
    tierKey: row.tier_key,
    tierName: meta?.name ?? row.tier_key,
    trialStatus: row.trial_status as TrialStatus,
    trialStartedAt: row.trial_started_at,
    trialEndsAt: row.trial_ends_at,
    convertedAt: row.converted_at,
    cancelledAt: row.cancelled_at,
  };
}

const SELECT_BASE = `
  select ftt.id, ftt.user_id, u.display_name as user_name, u.email as user_email, u.telegram_user_id,
         ftt.license_id, l.license_key, ftt.region, ftt.tier_key, ftt.trial_status,
         ftt.trial_started_at, ftt.trial_ends_at, ftt.converted_at, ftt.cancelled_at
  from feed_tier_trials ftt
  join users u on u.id = ftt.user_id
  join licenses l on l.id = ftt.license_id
`;

export class TrialAlreadyClaimedError extends Error {
  constructor() {
    super("You've already trialed this tier.");
  }
}

export class TrialNotEligibleError extends Error {
  constructor() {
    super("This tier isn't eligible for a trial.");
  }
}

interface StartTrialArgs {
  userId: string;
  licenseId: string;
  region: FeedRegion;
  tierKey: string;
  adminUrl: string;
}

/** Rule #2 (marcus, trial feature add-on): any existing row for this (user, tier) blocks a
 * new trial regardless of its status -- enforced here for a clean error message, and again at
 * the DB level via feed_tier_trials_user_tier_uidx (0036) so a race can't double-book. */
export async function startFeedTierTrial(args: StartTrialArgs): Promise<FeedTierTrialRow> {
  if (!isTrialEligibleTier(args.tierKey)) throw new TrialNotEligibleError();

  const existing = await pool.query(
    `select id from feed_tier_trials where user_id = $1 and tier_key = $2`,
    [args.userId, args.tierKey]
  );
  if ((existing.rowCount ?? 0) > 0) throw new TrialAlreadyClaimedError();

  let insertedId: string;
  try {
    const result = await pool.query<{ id: string }>(
      `insert into feed_tier_trials (user_id, license_id, region, tier_key, trial_ends_at)
       values ($1, $2, $3, $4, now() + make_interval(days => $5))
       returning id`,
      [args.userId, args.licenseId, args.region, args.tierKey, TRIAL_DURATION_DAYS]
    );
    insertedId = result.rows[0].id;
  } catch (err) {
    if (err instanceof Error && /feed_tier_trials_user_tier_uidx/.test(err.message)) {
      throw new TrialAlreadyClaimedError();
    }
    throw err;
  }

  const row = await getFeedTierTrial(insertedId);
  if (!row) throw new Error("failed to load created feed tier trial");

  await notifyFeedTierTrialStarted({
    email: row.userEmail,
    tierName: row.tierName,
    licenseKey: row.licenseKeyTail ? `****${row.licenseKeyTail}` : "unknown",
    trialEndsAt: row.trialEndsAt,
    adminUrl: args.adminUrl,
  }).catch(() => {});

  if (row.telegramUserId) {
    await sendHftAlertMessage(
      row.telegramUserId,
      `<b>🎁 Your ${TRIAL_DURATION_DAYS}-day trial of ${row.tierName} is live!</b>\nEnds ${row.trialEndsAt.toISOString().slice(0, 10)}.`
    ).catch(() => {});
  }

  return row;
}

export async function getFeedTierTrial(id: string): Promise<FeedTierTrialRow | null> {
  const result = await pool.query<TrialRow>(`${SELECT_BASE} where ftt.id = $1`, [id]);
  return result.rowCount ? mapRow(result.rows[0]) : null;
}

export interface ListFeedTierTrialsOptions {
  trialStatus?: TrialStatus;
  userId?: string;
}

export async function listFeedTierTrials(options: ListFeedTierTrialsOptions = {}): Promise<FeedTierTrialRow[]> {
  const conditions: string[] = [];
  const params: unknown[] = [];
  if (options.trialStatus) {
    params.push(options.trialStatus);
    conditions.push(`ftt.trial_status = $${params.length}`);
  }
  if (options.userId) {
    params.push(options.userId);
    conditions.push(`ftt.user_id = $${params.length}`);
  }
  const where = conditions.length ? `where ${conditions.join(" and ")}` : "";
  const result = await pool.query<TrialRow>(`${SELECT_BASE} ${where} order by ftt.trial_started_at desc`, params);
  return result.rows.map(mapRow);
}

export async function cancelFeedTierTrial(id: string): Promise<FeedTierTrialRow> {
  await pool.query(
    `update feed_tier_trials set trial_status = 'cancelled', cancelled_at = now()
     where id = $1 and trial_status = 'active'`,
    [id]
  );
  const row = await getFeedTierTrial(id);
  if (!row) throw new Error("feed tier trial not found after cancel");
  return row;
}

/** No auto-convert (rule #5) -- this only marks the row so the tier card can stop showing
 * the trial state; it's called from wherever a paid grant for the same tier lands, not from
 * any trial-internal flow. */
export async function markFeedTierTrialConverted(userId: string, tierKey: string): Promise<void> {
  const result = await pool.query<TrialRow>(
    `update feed_tier_trials set trial_status = 'converted', converted_at = now()
     where user_id = $1 and tier_key = $2 and trial_status = 'active'
     returning *`,
    [userId, tierKey]
  );
  if (!result.rowCount) return;
  const row = mapRow(result.rows[0]);
  await notifyFeedTierTrialConverted({
    email: row.userEmail,
    tierName: row.tierName,
    licenseKey: row.licenseKeyTail ? `****${row.licenseKeyTail}` : "unknown",
  }).catch(() => {});
}
