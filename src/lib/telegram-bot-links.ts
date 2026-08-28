import { pool } from "./db";

/** Read/write access to telegram_bot_links (0068) -- the per-bot-scoped Telegram
 * identity table, distinct from users.telegram_user_id (the portal bot's and
 * alerts73_bot's shared slot). Generic over bot_key so it works for any bot, not just
 * the feed provider one. */

export interface TelegramBotLink {
  telegramUserId: string;
  telegramUsername: string | null;
  linkedAt: Date;
}

export async function getBotLink(userId: string, botKey: string): Promise<TelegramBotLink | null> {
  const result = await pool.query<{ telegram_user_id: string; telegram_username: string | null; linked_at: Date }>(
    `select telegram_user_id, telegram_username, linked_at
     from telegram_bot_links where user_id = $1 and bot_key = $2`,
    [userId, botKey]
  );
  if (!result.rowCount) return null;
  const row = result.rows[0];
  return { telegramUserId: row.telegram_user_id, telegramUsername: row.telegram_username, linkedAt: row.linked_at };
}

export async function unlinkBot(userId: string, botKey: string): Promise<void> {
  await pool.query(`delete from telegram_bot_links where user_id = $1 and bot_key = $2`, [userId, botKey]);
}
