/**
 * Shared provider bot (@HorizonFeedsBot) -- one bot for every feed provider in v1, per
 * coxwell (bus thread provider-telegram-linking-build-2026-08-28), not one bot per
 * provider. Links live in telegram_bot_links (0068) keyed by FEEDS_BOT_KEY, never in
 * users.telegram_user_id -- that column stays the portal bot's and alerts73_bot's shared
 * slot (see 0068's migration comment). Per-provider bots later are just additional
 * bot_key values against the same table and a new token lookup here, not a schema change.
 */

export const FEEDS_BOT_KEY = "horizon_feeds_bot";

const API_ROOT = "https://api.telegram.org";

function botToken(): string {
  const token = process.env.TELEGRAM_FEEDS_BOT_TOKEN;
  if (!token) throw new Error("TELEGRAM_FEEDS_BOT_TOKEN not configured");
  return token;
}

export function feedsBotConfigured(): boolean {
  return !!process.env.TELEGRAM_FEEDS_BOT_TOKEN;
}

/** Returns false on any non-2xx (includes the common "bot was never /start'ed by this
 * user" 403, which the caller treats as an unlinked target rather than a hard error). */
export async function sendFeedsBotMessage(chatId: number | string, text: string): Promise<boolean> {
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
    console.error("sendFeedsBotMessage failed", res.status, await res.text());
    return false;
  }
  return true;
}

let cachedUsername: string | null = null;

export async function getFeedsBotUsername(): Promise<string | null> {
  if (cachedUsername) return cachedUsername;
  try {
    const res = await fetch(`${API_ROOT}/bot${botToken()}/getMe`);
    if (!res.ok) {
      console.error("getFeedsBotUsername: getMe failed", res.status, await res.text());
      return null;
    }
    const data = await res.json();
    cachedUsername = data?.result?.username ?? null;
    return cachedUsername;
  } catch (err) {
    console.error("getFeedsBotUsername failed", err);
    return null;
  }
}
