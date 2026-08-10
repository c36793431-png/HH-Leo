import { NextRequest, NextResponse } from "next/server";
import { pool } from "@/lib/db";
import { sendTelegramMessage } from "@/lib/telegram-bot";
import { notifyTelegramLinked } from "@/lib/telemetry-sink";
import { getLicenseForUser, computeLicenseDisplayStatus, getGroupTarget, isPaidTier } from "@/lib/licenses";
import { sendPaidGroupInvite } from "@/lib/group-membership";

const INVITE_RATE_LIMIT_MS = 60_000;

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

/** Inbound webhook for the Horizon Portal bot — handles both /start onb_<token> (deep link
 * from the dashboard) and a bare /start (user opened the bot directly). Every /start gets a
 * reply; paid-eligible users get their group invite fired automatically instead of requiring
 * the separate "Request Invite" dashboard click. */
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

  const match = text.match(/^\/start(?:\s+onb_([a-f0-9]{32}))?\b/);
  if (!match) return NextResponse.json({ ok: true });
  const token = match[1] ?? null;

  let userId: string | undefined;
  if (token) {
    const tokenRow = await pool.query<{ user_id: string }>(
      `select user_id from telegram_onboarding_tokens
       where token = $1 and used_at is null and expires_at > now()`,
      [token]
    );
    userId = tokenRow.rows[0]?.user_id;
    if (userId) {
      await pool.query("update telegram_onboarding_tokens set used_at = now() where token = $1", [
        token,
      ]);
    }
  }

  // Bare /start, or a stale/expired onb_ token — fall back to whatever account this
  // Telegram id is already linked to, if any.
  if (!userId) {
    const linked = await pool.query<{ id: string }>(
      "select id from users where telegram_user_id = $1",
      [fromId]
    );
    userId = linked.rows[0]?.id;
  }

  if (!userId) {
    try {
      await sendTelegramMessage(
        chatId,
        "Welcome to the Horizon HFT bot! I don't see a Horizon HFT account linked to this Telegram " +
          "yet — log in at horizonhft.com and use \"Link Telegram\" on your dashboard, then send /start again."
      );
    } catch (err) {
      console.error("telegram webhook: sendTelegramMessage failed", err);
    }
    return NextResponse.json({ ok: true });
  }

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

  const license = await getLicenseForUser(userId).catch(() => null);
  const displayStatus = computeLicenseDisplayStatus(license);
  const eligible =
    license !== null &&
    isPaidTier(license.tier) &&
    (displayStatus === "active" || displayStatus === "expiring");

  try {
    if (!eligible) {
      await sendTelegramMessage(
        chatId,
        "Welcome to Horizon HFT! You're linked, but you need an active paid, team, or deal tier " +
          "license to join ⚡️HH-TRADERS. Upgrade at horizonhft.com, then send /start again."
      );
    } else {
      const membership = await pool.query<{ status: string; invited_at: Date | null }>(
        `select status, invited_at from group_memberships where user_id = $1
         order by coalesce(joined_at, invited_at) desc limit 1`,
        [userId]
      );
      const latest = membership.rows[0];
      const alreadyHandled =
        latest?.status === "joined" ||
        (!!latest?.invited_at && Date.now() - latest.invited_at.getTime() < INVITE_RATE_LIMIT_MS);

      if (alreadyHandled) {
        await sendTelegramMessage(
          chatId,
          "Welcome back to Horizon HFT! ⚡ You're already set up for ⚡️HH-TRADERS."
        );
      } else {
        await sendTelegramMessage(
          chatId,
          "Welcome to Horizon HFT! ⚡ Your bot access is confirmed — sending your " +
            "⚡️HH-TRADERS Paid Users Group invite now."
        );
        const target = await getGroupTarget(userId);
        if (target) await sendPaidGroupInvite(target);
      }
    }
  } catch (err) {
    // The DB is already updated at this point — the webhook must still ack 200 even if the
    // welcome DM fails (same "must succeed even if DM fails" rule as sendWelcomeDm in auth.ts).
    console.error("telegram webhook: sendTelegramMessage failed", err);
  }

  return NextResponse.json({ ok: true });
}
