import { NextRequest, NextResponse } from "next/server";
import { pool } from "@/lib/db";
import { sendTelegramMessage, answerCallbackQuery, editMessageText } from "@/lib/telegram-bot";
import { notifyTelegramLinked } from "@/lib/telemetry-sink";
import { getLicenseForUser, computeLicenseDisplayStatus, getGroupTarget, isPaidTier } from "@/lib/licenses";
import { sendPaidGroupInvite } from "@/lib/group-membership";
import { resolveAdminUserId } from "@/lib/admin-telegram-map";
import { approveFeedTierRequest, rejectFeedTierRequest, getFeedTierRequest } from "@/lib/feed-tier-requests";

const INVITE_RATE_LIMIT_MS = 60_000;
const FEEDREQ_ADMIN_URL = "https://portal.horizonhft.com/admin/feed-tier-requests";

interface TelegramUpdate {
  message?: {
    text?: string;
    chat?: { id: number };
    from?: { id: number; first_name?: string; username?: string };
  };
  callback_query?: {
    id: string;
    data?: string;
    from: { id: number };
    message?: { chat: { id: number }; message_id: number; text?: string };
  };
}

/** Reusable inline approve/decline dispatch (leo-admin-inline-actions-reusable-pattern-
 * 2026-08-21). Keyed by the callback_data surface prefix (`${surface}:${action}:${id}`).
 * Each entry's mutation reuses the same portal-UI action functions -- no signature
 * changes needed since `actionedBy` already resolves to a real portal user id via
 * ADMIN_TELEGRAM_MAP. */
const ADMIN_ACTION_DISPATCH: Record<
  string,
  {
    label: string;
    getStatus: (id: string) => Promise<string | null>;
    approve: (id: string, actionedBy: string) => Promise<void>;
    reject: (id: string, actionedBy: string) => Promise<void>;
  }
> = {
  feedreq: {
    label: "feed request",
    getStatus: async (id) => (await getFeedTierRequest(id))?.status ?? null,
    approve: async (id, actionedBy) => {
      await approveFeedTierRequest(id, actionedBy, FEEDREQ_ADMIN_URL);
    },
    reject: async (id, actionedBy) => {
      await rejectFeedTierRequest(id, actionedBy, "declined via Telegram");
    },
  },
};

async function handleCallbackQuery(cq: NonNullable<TelegramUpdate["callback_query"]>): Promise<void> {
  const chatId = cq.message?.chat?.id;
  const messageId = cq.message?.message_id;
  const originalText = cq.message?.text ?? "";

  const adminUserId = resolveAdminUserId(cq.from.id);
  if (!adminUserId) {
    console.warn(`telegram webhook: unauthorized callback_query attempt from ${cq.from.id}: ${cq.data}`);
    await answerCallbackQuery(cq.id, { text: "Not authorized", showAlert: true });
    return;
  }

  const [surface, action, recordId] = (cq.data ?? "").split(":");
  const entry = ADMIN_ACTION_DISPATCH[surface];
  if (!entry || !recordId || (action !== "approve" && action !== "reject")) {
    await answerCallbackQuery(cq.id, { text: "Unrecognized action", showAlert: true });
    return;
  }

  const status = await entry.getStatus(recordId);
  if (status === null) {
    await answerCallbackQuery(cq.id, { text: "Not found", showAlert: true });
    return;
  }
  if (status !== "pending") {
    await answerCallbackQuery(cq.id, { text: `Already actioned (${status})` });
    return;
  }

  const adminRow = await pool.query<{ display_name: string | null; email: string | null }>(
    "select display_name, email from users where id = $1",
    [adminUserId]
  );
  const adminName = adminRow.rows[0]?.display_name || adminRow.rows[0]?.email || "admin";

  if (action === "approve") {
    await entry.approve(recordId, adminUserId);
  } else {
    await entry.reject(recordId, adminUserId);
  }

  await answerCallbackQuery(cq.id, { text: action === "approve" ? "Approved" : "Declined" });

  if (chatId && messageId) {
    const badge = action === "approve" ? "✅ APPROVED" : "❌ DECLINED";
    await editMessageText(
      chatId,
      messageId,
      `${badge} by ${adminName} · ${new Date().toISOString()}\n${originalText}`
    );
  }
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

  if (update.callback_query) {
    try {
      await handleCallbackQuery(update.callback_query);
    } catch (err) {
      console.error("telegram webhook: handleCallbackQuery failed", err);
      await answerCallbackQuery(update.callback_query.id, { text: "Action failed", showAlert: true }).catch(() => {});
    }
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
        `select status, invited_at from group_memberships where user_id = $1 and tier = 'paid'
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
