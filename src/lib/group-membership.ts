import { createChatInviteLink, banChatMember, unbanChatMember } from "./telegram-bot";
import { notifyUser } from "./notify";

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

  const link = await createChatInviteLink(paidGroupChatId(), `paid-${target.userId}`);
  if (!link) return { sent: false, reason: "invite_link_failed" };

  await notifyUser(
    { telegramUserId: target.telegramUserId },
    "Your Horizon HFT Paid Users Group invite",
    `Join the Paid Users Group: ${link}\n\nThis link is single-use — it expires once you join.`
  );
  return { sent: true };
}

/** Ban immediately followed by unban: removes the member but preserves rejoin via a fresh invite link on renewal. */
export async function removeFromPaidGroup(telegramUserId: string | number): Promise<void> {
  const chatId = paidGroupChatId();
  await banChatMember(chatId, telegramUserId);
  await unbanChatMember(chatId, telegramUserId);
}
