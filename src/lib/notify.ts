import { sendTelegramMessage } from "./telegram-bot";
import { sendEmail } from "./email";

interface Recipient {
  telegramUserId?: string | number | null;
  email?: string | null;
}

/** What one notifyUser call did: the channel it picked and what that channel answered. */
export type NotifyOutcome =
  | { channel: "telegram"; ok: true; telegramMessageId: number | null }
  | { channel: "email"; ok: true; resendEmailId: string | null }
  | { channel: "telegram" | "email"; ok: false; error: string }
  | { channel: "none"; ok: false; error: string };

/** Telegram DM when we have a linked telegram_user_id, else email fallback — per spec's account-convergence rule. */
export async function notifyUser(recipient: Recipient, subject: string, message: string): Promise<NotifyOutcome> {
  if (recipient.telegramUserId) {
    const r = await sendTelegramMessage(recipient.telegramUserId, message);
    return r.ok ? { channel: "telegram", ok: true, telegramMessageId: r.messageId } : { channel: "telegram", ok: false, error: r.error };
  }
  if (recipient.email) {
    const r = await sendEmail(recipient.email, subject, message);
    return r.ok ? { channel: "email", ok: true, resendEmailId: r.emailId } : { channel: "email", ok: false, error: r.error };
  }
  return { channel: "none", ok: false, error: "no telegram_user_id and no email" };
}
