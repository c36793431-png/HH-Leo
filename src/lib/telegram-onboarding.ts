import crypto from "crypto";
import { pool } from "./db";
import { getBotUsername } from "./telegram-bot";

const TOKEN_TTL_HOURS = 24;

/** Fits Telegram's 64-char /start payload cap (`onb_` + 32 hex chars = 36). */
function randomToken(): string {
  return crypto.randomBytes(16).toString("hex");
}

/**
 * Returns a deep link with a still-valid unused token, reusing one if the user already has
 * one (so reloading the dashboard doesn't spam the table with a fresh row every time).
 */
export async function createOnboardingToken(
  userId: string
): Promise<{ token: string; link: string } | null> {
  const botUsername = await getBotUsername();
  if (!botUsername) return null;

  const existing = await pool.query<{ token: string }>(
    `select token from telegram_onboarding_tokens
     where user_id = $1 and used_at is null and expires_at > now()
     order by created_at desc limit 1`,
    [userId]
  );
  const token =
    existing.rows[0]?.token ??
    (await (async () => {
      const t = randomToken();
      await pool.query(
        `insert into telegram_onboarding_tokens (token, user_id, expires_at)
         values ($1, $2, now() + interval '${TOKEN_TTL_HOURS} hours')`,
        [t, userId]
      );
      return t;
    })());

  return { token, link: `https://t.me/${botUsername}?start=onb_${token}` };
}
