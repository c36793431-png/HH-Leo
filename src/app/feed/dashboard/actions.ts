"use server";

import { revalidatePath } from "next/cache";
import { auth } from "@/lib/auth";
import { isFeedProviderUser } from "@/lib/admin-users-panel";
import { runAction, type ActionResult } from "@/lib/action-result";
import { getBotLink, unlinkBot } from "@/lib/telegram-bot-links";
import { sendFeedsBotMessage, FEEDS_BOT_KEY } from "@/lib/telegram-feeds-bot";
import { setNotificationPref, type NotificationEventKey } from "@/lib/notification-prefs";

async function requireProviderId(): Promise<string> {
  const session = await auth();
  if (!session?.user?.id || !isFeedProviderUser(session.user)) {
    throw new Error("You must be signed in as a feed provider");
  }
  return session.user.id;
}

export async function unlinkTelegramFeedsAction(): Promise<ActionResult> {
  return runAction("Failed to unlink Telegram", async () => {
    const userId = await requireProviderId();
    await unlinkBot(userId, FEEDS_BOT_KEY);
    revalidatePath("/feed/dashboard/notifications");
    revalidatePath("/feed/dashboard");
  });
}

export async function sendTelegramFeedsTestAction(): Promise<ActionResult> {
  return runAction("Failed to send test message", async () => {
    const userId = await requireProviderId();
    const link = await getBotLink(userId, FEEDS_BOT_KEY);
    if (!link) throw new Error("Telegram isn't linked yet");
    const sent = await sendFeedsBotMessage(
      link.telegramUserId,
      "🔔 Test notification from your Horizon Feeds provider panel — delivery is working."
    );
    if (!sent) throw new Error("Telegram rejected the message — try unlinking and linking again");
  });
}

export async function setNotificationPrefAction(eventKey: NotificationEventKey, enabled: boolean): Promise<ActionResult> {
  return runAction("Failed to update notification preference", async () => {
    const userId = await requireProviderId();
    await setNotificationPref(userId, eventKey, enabled);
    revalidatePath("/feed/dashboard/notifications");
  });
}
