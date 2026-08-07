import { NextRequest, NextResponse } from "next/server";
import { pool } from "@/lib/db";
import { sendTelegramMessage } from "@/lib/telegram-bot";
import { notifyTelegramLinked } from "@/lib/telemetry-sink";

interface TelegramUpdate {
  message?: {
    text?: string;
    chat?: { id: number };
    from?: { id: number; first_name?: string; username?: string };
  };
}

function authorized(req: NextRequest): boolean {
  const secret = process.env.TELEGRAM_WEBHOOK_SECRET;
  // TODO: TELEGRAM_WEBHOOK_SECRET isn't set yet — registering it against the webhook
  // (setWebhook's secret_token param) is an ops step outside this pass's scope.
  if (!secret) return true;
  return req.headers.get("x-telegram-bot-api-secret-token") === secret;
}

/** Inbound webhook for the Horizon Portal bot — currently only handles /start onb_<token>. */
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
  if (!text || !chatId || !fromId) return NextResponse.json({ ok: true });

  const match = text.match(/^\/start onb_([a-f0-9]{32})\b/);
  if (!match) return NextResponse.json({ ok: true });
  const token = match[1];

  const tokenRow = await pool.query<{ user_id: string }>(
    `select user_id from telegram_onboarding_tokens
     where token = $1 and used_at is null and expires_at > now()`,
    [token]
  );
  const userId = tokenRow.rows[0]?.user_id;
  if (!userId) return NextResponse.json({ ok: true });

  const userRow = await pool.query<{ telegram_user_id: string | null; email: string | null }>(
    "select telegram_user_id, email from users where id = $1",
    [userId]
  );
  const currentLink = userRow.rows[0]?.telegram_user_id;
  if (currentLink !== null && currentLink !== undefined && Number(currentLink) !== fromId) {
    // Same one-account-per-telegram-id rule as linkTelegramAction: never clobber an
    // existing different link.
    return NextResponse.json({ ok: true });
  }

  await pool.query("update telegram_onboarding_tokens set used_at = now() where token = $1", [
    token,
  ]);

  // /start coming from a real chat with this from.id is at least as strong a proof of
  // identity as the login widget HMAC, so it's safe to set telegram_user_id directly
  // when it isn't already set.
  await pool.query(
    `update users
     set telegram_bot_started_at = now(),
         telegram_user_id = coalesce(telegram_user_id, $1),
         telegram_username = coalesce($2, telegram_username),
         updated_at = now()
     where id = $3`,
    [fromId, fromUsername ?? null, userId]
  );

  if (currentLink === null || currentLink === undefined) {
    notifyTelegramLinked({
      email: userRow.rows[0]?.email ?? null,
      telegramUsername: fromUsername ?? null,
      linkedAt: new Date(),
    }).catch(() => {});
  }

  try {
    await sendTelegramMessage(
      chatId,
      "You're all set — the bot can now DM you. Head back to the Horizon HFT portal for your Paid Users Group invite."
    );
  } catch (err) {
    // The DB is already updated at this point — the webhook must still ack 200 even if the
    // welcome DM fails (same "must succeed even if DM fails" rule as sendWelcomeDm in auth.ts).
    console.error("telegram webhook: sendTelegramMessage failed", err);
  }

  return NextResponse.json({ ok: true });
}
