/**
 * Bot for /v1/hft-alert DMs — deliberately separate token from telegram-bot.ts
 * (HORIZON_PORTAL_BOT_TOKEN, used for login/onboarding/group-invite) so a leak or
 * rotation of one never touches the other's blast radius. Users link by opening this
 * bot and sending /start; Telegram then permits this bot (and only this bot) to DM
 * them going forward. No new DB column — the webhook resolves the same
 * users.telegram_user_id every other Telegram feature already uses.
 */

const API_ROOT = "https://api.telegram.org";

function botToken(): string {
  const token = process.env.TELEGRAM_HFT_ALERT_BOT_TOKEN;
  if (!token) throw new Error("TELEGRAM_HFT_ALERT_BOT_TOKEN not configured");
  return token;
}

export function hftAlertBotConfigured(): boolean {
  return !!process.env.TELEGRAM_HFT_ALERT_BOT_TOKEN;
}

/** Returns false on any non-2xx (includes the common "bot was never /start'ed by this
 * user" 403, which the caller treats as an unlinked target rather than a hard error). */
export async function sendHftAlertMessage(chatId: number | string, text: string): Promise<boolean> {
  const res = await fetch(`${API_ROOT}/bot${botToken()}/sendMessage`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      chat_id: chatId,
      text,
      parse_mode: "HTML",
      disable_web_page_preview: true,
    }),
  });
  if (!res.ok) {
    console.error("sendHftAlertMessage failed", res.status, await res.text());
    return false;
  }
  return true;
}

let cachedUsername: string | null = null;

export async function getHftAlertBotUsername(): Promise<string | null> {
  if (cachedUsername) return cachedUsername;
  try {
    const res = await fetch(`${API_ROOT}/bot${botToken()}/getMe`);
    if (!res.ok) {
      console.error("getHftAlertBotUsername: getMe failed", res.status, await res.text());
      return null;
    }
    const data = await res.json();
    cachedUsername = data?.result?.username ?? null;
    return cachedUsername;
  } catch (err) {
    console.error("getHftAlertBotUsername failed", err);
    return null;
  }
}
