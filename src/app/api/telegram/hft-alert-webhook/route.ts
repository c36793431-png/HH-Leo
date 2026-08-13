import { NextRequest, NextResponse } from "next/server";
import { pool } from "@/lib/db";
import { sendHftAlertMessage } from "@/lib/telegram-hft-alert-bot";

interface TelegramUpdate {
  message?: {
    text?: string;
    chat?: { id: number };
    from?: { id: number };
  };
}

function authorized(req: NextRequest): boolean {
  const secret = process.env.TELEGRAM_HFT_ALERT_WEBHOOK_SECRET;
  if (!secret) return true; // Not registered yet — set alongside setWebhook's secret_token.
  return req.headers.get("x-telegram-bot-api-secret-token") === secret;
}

/**
 * Inbound webhook for the alert-only bot (TELEGRAM_HFT_ALERT_BOT_TOKEN). Its only job is
 * handling /start so Telegram registers the chat and future /v1/hft-alert sendMessage
 * calls succeed — it does NOT do any account linking itself. Account linking (setting
 * users.telegram_user_id) already happens via the portal's Telegram login or the
 * existing @hfthorizonbot /start flow (src/app/api/telegram/webhook/route.ts); this bot
 * just looks that column up read-only.
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
  if (!text || !chatId || !fromId || !text.startsWith("/start")) {
    return NextResponse.json({ ok: true });
  }

  const linked = await pool.query<{ id: string }>("select id from users where telegram_user_id = $1", [fromId]);

  try {
    if (linked.rows[0]) {
      await sendHftAlertMessage(
        chatId,
        "You're linked! HFT trade alerts from your Horizon client will be DM'd here from now on."
      );
    } else {
      await sendHftAlertMessage(
        chatId,
        "Almost there — I don't see a Horizon HFT account linked to this Telegram yet. " +
          "Log in at horizonhft.com with Telegram (or send /start to @hfthorizonbot first), " +
          "then send /start here again."
      );
    }
  } catch (err) {
    console.error("hft-alert webhook: sendHftAlertMessage failed", err);
  }

  return NextResponse.json({ ok: true });
}
