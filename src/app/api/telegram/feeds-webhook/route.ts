import { NextRequest, NextResponse } from "next/server";
import { pool } from "@/lib/db";
import { sendFeedsBotMessage, FEEDS_BOT_KEY } from "@/lib/telegram-feeds-bot";

interface TelegramUpdate {
  message?: {
    text?: string;
    chat?: { id: number };
    from?: { id: number; username?: string };
  };
}

function authorized(req: NextRequest): boolean {
  const secret = process.env.TELEGRAM_FEEDS_BOT_WEBHOOK_SECRET;
  if (!secret) return true; // Not registered yet -- set alongside setWebhook's secret_token.
  return req.headers.get("x-telegram-bot-api-secret-token") === secret;
}

/**
 * Inbound webhook for the shared provider bot (TELEGRAM_FEEDS_BOT_TOKEN, @horizonfbot).
 * Handles the Notifications page's `?start=<token>` deep link -- the panel-generated,
 * one-time-use token (see telegram-feeds-onboarding.ts) proves which provider account
 * clicked Start, so this webhook binds telegram_bot_links (0068), never
 * users.telegram_user_id -- that column stays alerts73_bot's and the portal bot's shared
 * slot. A bare /start (no token, e.g. re-opening the bot) falls back to whatever provider
 * account is already linked to this Telegram id under this bot_key, same pattern as the
 * other two bots' webhooks.
 */
export async function POST(req: NextRequest) {
  if (!authorized(req)) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  let update: TelegramUpdate;
  try {
    update = await req.json();
  } catch {
    return NextResponse.json({ ok: true });
  }

  const text = update.message?.text;
  const chatId = update.message?.chat?.id;
  const fromId = update.message?.from?.id;
  const fromUsername = update.message?.from?.username;
  if (!text || !chatId || !fromId || !text.startsWith("/start")) {
    return NextResponse.json({ ok: true });
  }

  const match = text.match(/^\/start(?:\s+([a-f0-9]{32}))?\b/);
  const token = match?.[1] ?? null;

  let userId: string | undefined;
  if (token) {
    const tokenRow = await pool.query<{ user_id: string }>(
      `select user_id from telegram_bot_link_tokens
       where token = $1 and bot_key = $2 and used_at is null and expires_at > now()`,
      [token, FEEDS_BOT_KEY]
    );
    userId = tokenRow.rows[0]?.user_id;
    if (userId) {
      await pool.query("update telegram_bot_link_tokens set used_at = now() where token = $1", [token]);
    }
  }

  const linkedByTelegramId = await pool.query<{ user_id: string }>(
    "select user_id from telegram_bot_links where bot_key = $1 and telegram_user_id = $2",
    [FEEDS_BOT_KEY, fromId]
  );

  if (!userId) {
    userId = linkedByTelegramId.rows[0]?.user_id;
  }

  if (!userId) {
    try {
      await sendFeedsBotMessage(
        chatId,
        "Almost there — I don't see a Horizon feed-provider account linked to this Telegram yet. " +
          "Open the Notifications page in your provider panel and tap \"Link Telegram\" again."
      );
    } catch (err) {
      console.error("feeds webhook: sendFeedsBotMessage failed", err);
    }
    return NextResponse.json({ ok: true });
  }

  if (linkedByTelegramId.rows[0] && linkedByTelegramId.rows[0].user_id !== userId) {
    // Same one-account-per-telegram-id rule as the other bots' webhooks -- never clobber
    // an existing different link.
    try {
      await sendFeedsBotMessage(chatId, "This Telegram account is already linked to a different Horizon provider account.");
    } catch (err) {
      console.error("feeds webhook: sendFeedsBotMessage failed", err);
    }
    return NextResponse.json({ ok: true });
  }

  const alreadyLinkedSameAccount = linkedByTelegramId.rows[0]?.user_id === userId;

  await pool.query(
    `insert into telegram_bot_links (user_id, bot_key, telegram_user_id, telegram_username)
     values ($1, $2, $3, $4)
     on conflict (user_id, bot_key)
     do update set telegram_user_id = excluded.telegram_user_id,
                   telegram_username = excluded.telegram_username,
                   updated_at = now()`,
    [userId, FEEDS_BOT_KEY, fromId, fromUsername ?? null]
  );

  try {
    await sendFeedsBotMessage(
      chatId,
      alreadyLinkedSameAccount
        ? "You're already linked — no changes needed. Notification events from your Horizon Feeds provider panel are still DM'd here."
        : "You're linked! Notification events from your Horizon Feeds provider panel will be DM'd here from now on."
    );
  } catch (err) {
    console.error("feeds webhook: sendFeedsBotMessage failed", err);
  }

  return NextResponse.json({ ok: true });
}
