import { sendTelegramMessage } from "./telegram-bot";
import { sendEmail } from "./email";

interface Recipient {
  telegramUserId?: string | number | null;
  email?: string | null;
}

/** Telegram DM when we have a linked telegram_user_id, else email fallback — per spec's account-convergence rule. */
export async function notifyUser(recipient: Recipient, subject: string, message: string): Promise<void> {
  if (recipient.telegramUserId) {
    await sendTelegramMessage(recipient.telegramUserId, message);
    return;
  }
  if (recipient.email) {
    await sendEmail(recipient.email, subject, message);
  }
}
