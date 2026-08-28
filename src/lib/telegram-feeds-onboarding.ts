import crypto from "crypto";
import { pool } from "./db";
import { getFeedsBotUsername, FEEDS_BOT_KEY } from "./telegram-feeds-bot";

const TOKEN_TTL_HOURS = 24;

/** Fits Telegram's 64-char /start payload cap (32 hex chars, no prefix needed -- this
 * bot's webhook only ever expects a link-onboarding token). */
function randomToken(): string {
  return crypto.randomBytes(16).toString("hex");
}

/**
 * Returns a deep link with a still-valid unused token, reusing one if the provider
 * already has one (so reloading the Notifications page doesn't spam the table with a
 * fresh row every time). Same shape as telegram-hft-alert-onboarding.ts, scoped by
 * bot_key instead of being its own single-bot table (see 0069's migration comment).
 */
export async function createFeedsOnboardingToken(
  userId: string
): Promise<{ token: string; link: string } | null> {
  const botUsername = await getFeedsBotUsername();
  if (!botUsername) return null;

  const existing = await pool.query<{ token: string }>(
    `select token from telegram_bot_link_tokens
     where user_id = $1 and bot_key = $2 and used_at is null and expires_at > now()
     order by created_at desc limit 1`,
    [userId, FEEDS_BOT_KEY]
  );
  const token =
    existing.rows[0]?.token ??
    (await (async () => {
      const t = randomToken();
      await pool.query(
        `insert into telegram_bot_link_tokens (token, user_id, bot_key, expires_at)
         values ($1, $2, $3, now() + interval '${TOKEN_TTL_HOURS} hours')`,
        [t, userId, FEEDS_BOT_KEY]
      );
      return t;
    })());

  return { token, link: `https://t.me/${botUsername}?start=${token}` };
}
