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

/**
 * `cache: "force-cache"` here previously mixed the fetch static-cache directive with a route
 * that's already dynamically rendered (auth() reads cookies before this runs). That's the
 * "route used fetch(..., { cache: 'force-cache' }) ... dynamic" class of Next.js App Router
 * error. The module-level `cachedUsername` already gives us in-process memoization, which is
 * all we need for a value that changes essentially never — no fetch-level cache directive
 * required, so we drop it rather than fight the framework's caching rules.
 */
export async function getBotUsername(): Promise<string | null> {
  if (cachedUsername) return cachedUsername;
  const token = process.env.HORIZON_PORTAL_BOT_TOKEN;
  console.log(
    `getBotUsername: token ${token ? `present (len=${token.length}, prefix=${token.slice(0, 6)}...)` : "MISSING"}`
  );
  try {
    const res = await fetch(`${API_ROOT}/bot${botToken()}/getMe`);
    if (!res.ok) {
      console.error(`getBotUsername: getMe returned ${res.status}`, await res.text());
      return null;
    }
    const data = await res.json();
    cachedUsername = data?.result?.username ?? null;
    return cachedUsername;
  } catch (err) {
    console.error("getBotUsername failed", err);
    return null;
  }
}

async function callTelegramApi(method: string, body: Record<string, unknown>): Promise<boolean> {
  const res = await fetch(`${API_ROOT}/bot${botToken()}/${method}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    console.error(`${method} failed`, await res.text());
    return false;
  }
  return true;
}

/** Single-use invite link — bots cannot add members directly, so this is the only join path (hard Bot API limit). */
export async function createChatInviteLink(chatId: string, name?: string): Promise<string | null> {
  try {
    const res = await fetch(`${API_ROOT}/bot${botToken()}/createChatInviteLink`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ chat_id: chatId, member_limit: 1, name }),
    });
    if (!res.ok) {
      console.error("createChatInviteLink failed", await res.text());
      return null;
    }
    const data = await res.json();
    return data?.result?.invite_link ?? null;
  } catch (err) {
    console.error("createChatInviteLink failed", err);
    return null;
  }
}

export async function banChatMember(chatId: string, userId: number | string): Promise<boolean> {
  return callTelegramApi("banChatMember", { chat_id: chatId, user_id: userId });
}

/** onlyIfBanned avoids erroring when a member was never actually banned (e.g. already left). */
export async function unbanChatMember(chatId: string, userId: number | string): Promise<boolean> {
  return callTelegramApi("unbanChatMember", { chat_id: chatId, user_id: userId, only_if_banned: true });
}
