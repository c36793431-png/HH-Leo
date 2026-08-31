import { createChatInviteLink, banChatMember, unbanChatMember } from "./telegram-bot";
import { notifyUser } from "./notify";
import { pool } from "./db";

export type GroupTier = "free" | "paid";

function paidGroupChatId(): string {
  const chatId = process.env.TELEGRAM_PAID_GROUP_CHAT_ID;
  if (!chatId) throw new Error("TELEGRAM_PAID_GROUP_CHAT_ID not configured");
  return chatId;
}

/** Not yet configured — the free (Horizon Testers) group is currently a static join link
 * (portal_config.community_group_url), not a chat the bot administers. Flipping it to the
 * same bot-issued single-use invite flow as paid needs coxwell to add the bot as admin and
 * hand back the numeric chat_id (same as TELEGRAM_PAID_GROUP_CHAT_ID originally) — the
 * group's `+…` private invite link can't be resolved to a chat_id via the Bot API. */
function freeGroupChatId(): string {
  const chatId = process.env.TELEGRAM_FREE_GROUP_CHAT_ID;
  if (!chatId) throw new Error("TELEGRAM_FREE_GROUP_CHAT_ID not configured");
  return chatId;
}

function chatIdForTier(tier: GroupTier): string {
  return tier === "paid" ? paidGroupChatId() : freeGroupChatId();
}

const GROUP_LABEL: Record<GroupTier, string> = {
  paid: "Horizon Traders",
  free: "Horizon Testers",
};

export interface InviteTarget {
  userId: string;
  telegramUserId: string | null;
  email: string | null;
}

export type InviteResult =
  | { sent: true }
  | { sent: false; reason: "telegram_not_linked" | "invite_link_failed" };

/**
 * Precondition (spec F14): telegram_user_id must be linked before a group invite is
 * generated — an email-only join would leave the client unreachable by the expiry
 * sweep's banChatMember call. Falls back to a "link your Telegram" email prompt.
 */
export async function sendGroupInvite(target: InviteTarget, tier: GroupTier): Promise<InviteResult> {
  const groupLabel = GROUP_LABEL[tier];
  if (!target.telegramUserId) {
    await notifyUser(
      { email: target.email },
      `Link your Telegram to receive your ${groupLabel} invite`,
      `Your Horizon HFT account is ready, but we need your Telegram account linked ` +
        `to send your ${groupLabel} invite. Log in at horizonhft.com and use ` +
        "\"Link Telegram\" on your dashboard, then contact us for your invite."
    );
    return { sent: false, reason: "telegram_not_linked" };
  }

  const chatId = chatIdForTier(tier);
  const link = await createChatInviteLink(chatId, `${tier}-${target.userId}`);
  if (!link) return { sent: false, reason: "invite_link_failed" };

  // Idempotent on (user_id, chat_id) among active-membership rows (see migration 0073):
  // a resend or a renewal landing while a row is already invited/joined updates that row's
  // link instead of inserting a duplicate. Status is left untouched — a resend must not
  // demote an already-'joined' member back to 'invited'. The DM below still fires every
  // call; that's caller-controlled (resendGroupInviteAction's whole job), not tied to
  // whether the row was inserted or updated.
  await pool.query(
    `insert into group_memberships (user_id, telegram_id, chat_id, tier, invite_link, invited_at, status)
     values ($1, $2, $3, $4, $5, now(), 'invited')
     on conflict (user_id, chat_id) where status not in ('removed_on_lapse', 'left')
     do update set telegram_id = excluded.telegram_id, invite_link = excluded.invite_link, invited_at = now()`,
    [target.userId, target.telegramUserId, chatId, tier, link]
  );

  await notifyUser(
    { telegramUserId: target.telegramUserId },
    `Your Horizon HFT ${groupLabel} access is active`,
    `🎉 Welcome! Your ${groupLabel} access is active — join here: ${link}. ` +
      `See you inside.\n\nThis link is single-use — it expires once you join.`
  );
  return { sent: true };
}

/** Back-compat wrapper — every existing paid-group call site keeps calling this unchanged. */
export async function sendPaidGroupInvite(target: InviteTarget): Promise<InviteResult> {
  return sendGroupInvite(target, "paid");
}

/** Ban immediately followed by unban: removes the member but preserves rejoin via a fresh invite link on renewal. */
export async function removeFromGroup(userId: string, telegramUserId: string | number, tier: GroupTier): Promise<void> {
  const chatId = chatIdForTier(tier);
  await banChatMember(chatId, telegramUserId);
  await unbanChatMember(chatId, telegramUserId);

  await pool.query(
    `update group_memberships set status = 'removed_on_lapse', removed_at = now()
     where user_id = $1 and tier = $2 and status not in ('removed_on_lapse', 'left')`,
    [userId, tier]
  );
}

/** Back-compat wrapper — every existing paid-group call site keeps calling this unchanged. */
export async function removeFromPaidGroup(userId: string, telegramUserId: string | number): Promise<void> {
  return removeFromGroup(userId, telegramUserId, "paid");
}
