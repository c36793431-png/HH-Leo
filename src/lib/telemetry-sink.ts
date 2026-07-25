/**
 * Server-side telemetry sink for /v1/hb.
 *
 * This is the replacement for the previous developer's "bot creds baked into the
 * client binary" design (security finding #3). The bot token lives ONLY here, as a
 * server env var (TELEMETRY_BOT_TOKEN), never in the shipped client. Clients POST
 * their heartbeat to /v1/hb; the server forwards a summary to the operator's private
 * chat (TELEMETRY_CHAT_ID). A leaked client reveals no telegram credentials.
 *
 * Kept deliberately separate from telegram-bot.ts (HORIZON_PORTAL_BOT_TOKEN) so the
 * telemetry bot rotation can't affect the portal's paid-group bot and vice versa.
 */

const API_ROOT = "https://api.telegram.org";

export interface HeartbeatTelemetry {
  key: string;
  hwid: string;
  version?: string;
  // Opaque client-supplied fields — semantics TBD (flagged to Axiom). Forwarded as-is.
  d1?: unknown;
  d2?: unknown;
  d3?: unknown;
  sp?: unknown;
  eh?: unknown;
  ip: string;
}

/** Best-effort, non-blocking: telemetry forwarding must never fail a heartbeat. */
export async function forwardHeartbeat(t: HeartbeatTelemetry): Promise<void> {
  const token = process.env.TELEMETRY_BOT_TOKEN;
  const chatId = process.env.TELEMETRY_CHAT_ID;
  if (!token || !chatId) return; // Not configured yet (awaiting rotated token + /start chat_id).

  // Never log the full license key to the sink — last 4 is enough to correlate.
  const keyTail = t.key.length > 4 ? t.key.slice(-4) : t.key;
  const text =
    `<b>HB</b> …${keyTail} v${t.version ?? "?"}\n` +
    `hwid ${t.hwid.slice(0, 12)}… ip ${t.ip}\n` +
    `d1=${fmt(t.d1)} d2=${fmt(t.d2)} d3=${fmt(t.d3)} sp=${fmt(t.sp)} eh=${fmt(t.eh)}`;

  try {
    const res = await fetch(`${API_ROOT}/bot${token}/sendMessage`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ chat_id: chatId, text, parse_mode: "HTML", disable_web_page_preview: true }),
    });
    if (!res.ok) console.error("forwardHeartbeat: sink send failed", res.status);
  } catch (err) {
    console.error("forwardHeartbeat failed", err);
  }
}

function fmt(v: unknown): string {
  if (v === undefined || v === null) return "-";
  if (typeof v === "object") return JSON.stringify(v);
  return String(v);
}
