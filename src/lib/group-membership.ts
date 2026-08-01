import { createChatInviteLink, banChatMember, unbanChatMember } from "./telegram-bot";
import { notifyUser } from "./notify";
import { pool } from "./db";

function paidGroupChatId(): string {
  const chatId = process.env.TELEGRAM_PAID_GROUP_CHAT_ID;
  if (!chatId) throw new Error("TELEGRAM_PAID_GROUP_CHAT_ID not configured");
  return chatId;
}

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
export async function sendPaidGroupInvite(target: InviteTarget): Promise<InviteResult> {
  if (!target.telegramUserId) {
    await notifyUser(
      { email: target.email },
      "Link your Telegram to receive your Horizon HFT group invite",
      "Your Horizon HFT license is active, but we need your Telegram account linked " +
        "to send your Paid Users Group invite. Log in at horizonhft.com and use " +
        "\"Link Telegram\" on your dashboard, then contact us for your invite."
    );
    return { sent: false, reason: "telegram_not_linked" };
  }

  const chatId = paidGroupChatId();
  const link = await createChatInviteLink(chatId, `paid-${target.userId}`);
  if (!link) return { sent: false, reason: "invite_link_failed" };

  await pool.query(
    `insert into group_memberships (user_id, telegram_id, chat_id, invite_link, invited_at, status)
     values ($1, $2, $3, $4, now(), 'invited')`,
    [target.userId, target.telegramUserId, chatId, link]
  );

  await notifyUser(
    { telegramUserId: target.telegramUserId },
    "Your Horizon HFT Paid Users Group access is active",
    `🎉 Welcome to Horizon HFT paid! Your Paid Users Group access is active — join here: ${link}. ` +
      `See you inside.\n\nThis link is single-use — it expires once you join.`
  );
  return { sent: true };
}

/** Ban immediately followed by unban: removes the member but preserves rejoin via a fresh invite link on renewal. */
export async function removeFromPaidGroup(userId: string, telegramUserId: string | number): Promise<void> {
  const chatId = paidGroupChatId();
  await banChatMember(chatId, telegramUserId);
  await unbanChatMember(chatId, telegramUserId);

  await pool.query(
    `update group_memberships set status = 'removed_on_lapse', removed_at = now()
     where user_id = $1 and status not in ('removed_on_lapse', 'left')`,
    [userId]
  );
}
