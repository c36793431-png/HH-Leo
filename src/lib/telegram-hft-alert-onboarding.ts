import crypto from "crypto";
import { pool } from "./db";
import { getHftAlertBotUsername } from "./telegram-hft-alert-bot";

const TOKEN_TTL_HOURS = 24;

/** Fits Telegram's 64-char /start payload cap (32 hex chars, no prefix needed — this
 * bot's webhook only ever expects an alert-onboarding token, unlike the shared portal
 * bot which also handles bare /start). */
function randomToken(): string {
  return crypto.randomBytes(16).toString("hex");
}

/**
 * Returns a deep link with a still-valid unused token, reusing one if the user already has
 * one (so reloading the Community page doesn't spam the table with a fresh row every time).
 */
export async function createHftAlertOnboardingToken(
  userId: string
): Promise<{ token: string; link: string } | null> {
  const botUsername = await getHftAlertBotUsername();
  if (!botUsername) return null;

  const existing = await pool.query<{ token: string }>(
    `select token from hft_alert_onboarding_tokens
     where user_id = $1 and used_at is null and expires_at > now()
     order by created_at desc limit 1`,
    [userId]
  );
  const token =
    existing.rows[0]?.token ??
    (await (async () => {
      const t = randomToken();
      await pool.query(
        `insert into hft_alert_onboarding_tokens (token, user_id, expires_at)
         values ($1, $2, now() + interval '${TOKEN_TTL_HOURS} hours')`,
        [t, userId]
      );
      return t;
    })());

  return { token, link: `https://t.me/${botUsername}?start=${token}` };
}
