const API_ROOT = "https://api.telegram.org";

function botToken(): string {
  const token = process.env.HORIZON_PORTAL_BOT_TOKEN;
  if (!token) throw new Error("HORIZON_PORTAL_BOT_TOKEN not configured");
  return token;
}

/** Outbound-only: Vercel serverless can't hold a long-poll connection, so we just POST. */
export async function sendTelegramMessage(chatId: number | string, text: string) {
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
    console.error("sendTelegramMessage failed", await res.text());
  }
}

let cachedUsername: string | null = null;

export async function getBotUsername(): Promise<string | null> {
  if (cachedUsername) return cachedUsername;
  try {
    const res = await fetch(`${API_ROOT}/bot${botToken()}/getMe`, { cache: "force-cache" });
    if (!res.ok) return null;
    const data = await res.json();
    cachedUsername = data?.result?.username ?? null;
    return cachedUsername;
  } catch {
    return null;
  }
}
