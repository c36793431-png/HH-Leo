import { NextRequest, NextResponse } from "next/server";
import { pool } from "@/lib/db";
import { sendHftAlertMessage } from "@/lib/telegram-hft-alert-bot";

interface TelegramUpdate {
  message?: {
    text?: string;
    chat?: { id: number };
    from?: { id: number; username?: string };
  };
}

function authorized(req: NextRequest): boolean {
  const secret = process.env.TELEGRAM_HFT_ALERT_WEBHOOK_SECRET;
  if (!secret) return true; // Not registered yet — set alongside setWebhook's secret_token.
  return req.headers.get("x-telegram-bot-api-secret-token") === secret;
}

/**
 * Inbound webhook for the alert-only bot (TELEGRAM_HFT_ALERT_BOT_TOKEN). Handles the
 * Trading Alerts card's `?start=<token>` deep link — the portal-generated, one-time-use
 * token (see telegram-hft-alert-onboarding.ts) proves which portal account clicked
 * Start, so this webhook binds users.telegram_user_id directly, the same column every
 * other Telegram feature (login, group invites, /v1/hft-alert) reads. A bare /start
 * (no token, e.g. re-opening the bot) falls back to whatever account is already linked
 * to this Telegram id, same pattern as the shared portal bot's webhook.
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
      `select user_id from hft_alert_onboarding_tokens
       where token = $1 and used_at is null and expires_at > now()`,
      [token]
    );
    userId = tokenRow.rows[0]?.user_id;
    if (userId) {
      await pool.query("update hft_alert_onboarding_tokens set used_at = now() where token = $1", [token]);
    }
  }

  if (!userId) {
    const linked = await pool.query<{ id: string }>("select id from users where telegram_user_id = $1", [fromId]);
    userId = linked.rows[0]?.id;
  }

  if (!userId) {
    try {
      await sendHftAlertMessage(
        chatId,
        "Almost there — I don't see a Horizon HFT account linked to this Telegram yet. " +
          "Open the Trading Alerts card on the Community page and tap \"Start the bot\" again."
      );
    } catch (err) {
      console.error("hft-alert webhook: sendHftAlertMessage failed", err);
    }
    return NextResponse.json({ ok: true });
  }

  const userRow = await pool.query<{ telegram_user_id: string | null }>(
    "select telegram_user_id from users where id = $1",
    [userId]
  );
  const currentLink = userRow.rows[0]?.telegram_user_id;
  if (currentLink !== null && currentLink !== undefined && Number(currentLink) !== fromId) {
    // Same one-account-per-telegram-id rule as the shared bot's webhook — never clobber
    // an existing different link.
    return NextResponse.json({ ok: true });
  }

  await pool.query(
    `update users
     set telegram_user_id = coalesce(telegram_user_id, $1),
         telegram_username = coalesce($2, telegram_username),
         updated_at = now()
     where id = $3`,
    [fromId, fromUsername ?? null, userId]
  );

  try {
    await sendHftAlertMessage(
      chatId,
      "You're linked! HFT trade alerts from your Horizon client will be DM'd here from now on."
    );
  } catch (err) {
    console.error("hft-alert webhook: sendHftAlertMessage failed", err);
  }

  return NextResponse.json({ ok: true });
}
