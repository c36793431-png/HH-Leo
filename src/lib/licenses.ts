import { pool } from "./db";

interface ClaimArgs {
  userId: string;
  email?: string;
  telegramUserId?: number;
}

/**
 * Atomically claims any pre-provisioned license matching this user's verified
 * email or Telegram ID. WHERE user_id IS NULL makes concurrent claims lose
 * harmlessly (spec: Pre-provision + claim).
 */
/** Canonical paid-state check — licenses table is the single source of truth, computed at read time. */
export async function isPaidUser(userId: string): Promise<boolean> {
  const result = await pool.query(
    `select 1 from licenses
     where user_id = $1 and status = 'active' and expires_at > now()
     limit 1`,
    [userId]
  );
  return (result.rowCount ?? 0) > 0;
}

export async function claimPendingLicense({ userId, email, telegramUserId }: ClaimArgs) {
  if (email) {
    await pool.query(
      `update licenses set user_id = $1, claim_email = null
       where user_id is null and claim_email = $2`,
      [userId, email]
    );
  }
  if (telegramUserId !== undefined) {
    await pool.query(
      `update licenses set user_id = $1, claim_telegram_user_id = null
       where user_id is null and claim_telegram_user_id = $2`,
      [userId, telegramUserId]
    );
  }
}
