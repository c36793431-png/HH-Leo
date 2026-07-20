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
