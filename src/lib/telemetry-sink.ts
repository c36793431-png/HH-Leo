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
  // Opaque client-supplied fields — semantics TBD. Forwarded as-is.
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

const SIGNUP_NOTIFY_CHAT_ID = "7225949234"; // coxwell, per request — distinct from TELEMETRY_CHAT_ID (heartbeat sink)

// Coxwell DM group's "approvals" topic -- actionable admin pings land here instead of the
// flat signup/activation sink (leo-admin-notify-topic-and-clickable-url-2026-08-21).
const COXWELL_APPROVALS_CHAT_ID = "-1003914182493";
const COXWELL_APPROVALS_THREAD_ID = 28865;

/** Best-effort, non-blocking: a failed notify must never block signup. */
export async function notifyFreeSignup(opts: {
  email: string | null;
  joinedAt: Date;
  source?: string;
}): Promise<void> {
  const token = process.env.TELEMETRY_BOT_TOKEN;
  if (!token) return; // Not configured yet — coxwell sets this in Vercel.

  const text =
    `🌱 new free user\n` +
    `email: ${opts.email ?? "-"}\n` +
    `joined: ${opts.joinedAt.toISOString()}` +
    (opts.source ? `\nsource: ${opts.source}` : "");

  try {
    const res = await fetch(`${API_ROOT}/bot${token}/sendMessage`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ chat_id: SIGNUP_NOTIFY_CHAT_ID, text }),
    });
    if (!res.ok) console.error("notifyFreeSignup: sink send failed", res.status);
  } catch (err) {
    console.error("notifyFreeSignup failed", err);
  }
}

/** Best-effort, non-blocking: a failed notify must never block license issuance. */
export async function notifyPaidActivation(opts: {
  email: string | null;
  licenseKey: string;
  activatedAt: Date;
  tier?: string;
}): Promise<void> {
  const token = process.env.TELEMETRY_BOT_TOKEN;
  if (!token) return; // Not configured yet — coxwell sets this in Vercel.

  const keyTail = opts.licenseKey.length > 4 ? opts.licenseKey.slice(-4) : opts.licenseKey;
  const text =
    `💰 new paid signup\n` +
    `email: ${opts.email ?? "-"}\n` +
    `license: …${keyTail}\n` +
    `activated: ${opts.activatedAt.toISOString()}` +
    (opts.tier ? `\ntier: ${opts.tier}` : "");

  try {
    const res = await fetch(`${API_ROOT}/bot${token}/sendMessage`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ chat_id: SIGNUP_NOTIFY_CHAT_ID, text }),
    });
    if (!res.ok) console.error("notifyPaidActivation: sink send failed", res.status);
  } catch (err) {
    console.error("notifyPaidActivation failed", err);
  }
}

/** Shared low-level send — all lifecycle notify* functions below post to the same
 * coxwell sink chat as notifyFreeSignup/notifyPaidActivation. Best-effort, non-blocking. */
async function sendSinkMessage(text: string): Promise<void> {
  const token = process.env.TELEMETRY_BOT_TOKEN;
  if (!token) return; // Not configured yet — coxwell sets this in Vercel.

  try {
    const res = await fetch(`${API_ROOT}/bot${token}/sendMessage`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ chat_id: SIGNUP_NOTIFY_CHAT_ID, text }),
    });
    if (!res.ok) console.error("telemetry-sink: sink send failed", res.status);
  } catch (err) {
    console.error("telemetry-sink: sink send failed", err);
  }
}

/** Posts to the Coxwell approvals topic; falls back to the flat sink chat on failure so
 * the notification is never silently dropped. Best-effort, non-blocking. */
async function sendApprovalsTopicMessage(text: string): Promise<void> {
  const token = process.env.TELEMETRY_BOT_TOKEN;
  if (!token) return; // Not configured yet — coxwell sets this in Vercel.

  try {
    const res = await fetch(`${API_ROOT}/bot${token}/sendMessage`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        chat_id: COXWELL_APPROVALS_CHAT_ID,
        message_thread_id: COXWELL_APPROVALS_THREAD_ID,
        text,
      }),
    });
    if (!res.ok) {
      console.error("telemetry-sink: approvals topic send failed", res.status);
      await sendSinkMessage(text);
    }
  } catch (err) {
    console.error("telemetry-sink: approvals topic send failed", err);
    await sendSinkMessage(text);
  }
}

function keyTail(licenseKey: string): string {
  return licenseKey.length > 4 ? licenseKey.slice(-4) : licenseKey;
}

export async function notifyTrialIssued(opts: {
  email: string | null;
  licenseKey: string;
  issuedAt: Date;
  expiresAt: Date;
}): Promise<void> {
  await sendSinkMessage(
    `🎁 trial issued\n` +
      `email: ${opts.email ?? "-"}\n` +
      `license: …${keyTail(opts.licenseKey)}\n` +
      `issued: ${opts.issuedAt.toISOString()}\n` +
      `expires: ${opts.expiresAt.toISOString()}`
  );
}

export async function notifyLicenseUpgraded(opts: {
  email: string | null;
  licenseKey: string;
  fromTier: string;
  toTier: string;
}): Promise<void> {
  await sendSinkMessage(
    `⬆️ license upgraded\n` +
      `email: ${opts.email ?? "-"}\n` +
      `license: …${keyTail(opts.licenseKey)}\n` +
      `from: ${opts.fromTier}\n` +
      `to: ${opts.toTier}`
  );
}

export async function notifyLicenseExpiringSoon(opts: {
  email: string | null;
  licenseKey: string;
  expiresAt: Date;
}): Promise<void> {
  await sendSinkMessage(
    `⏰ license expiring soon\n` +
      `email: ${opts.email ?? "-"}\n` +
      `license: …${keyTail(opts.licenseKey)}\n` +
      `expires: ${opts.expiresAt.toISOString()}`
  );
}

export async function notifyLicenseExpired(opts: {
  email: string | null;
  licenseKey: string;
  expiredAt: Date;
}): Promise<void> {
  await sendSinkMessage(
    `⏱️ license expired\n` +
      `email: ${opts.email ?? "-"}\n` +
      `license: …${keyTail(opts.licenseKey)}\n` +
      `expired: ${opts.expiredAt.toISOString()}`
  );
}

export async function notifyLicenseRevoked(opts: {
  email: string | null;
  licenseKey: string;
  revokedAt: Date;
}): Promise<void> {
  await sendSinkMessage(
    `🚫 license revoked\n` +
      `email: ${opts.email ?? "-"}\n` +
      `license: …${keyTail(opts.licenseKey)}\n` +
      `revoked: ${opts.revokedAt.toISOString()}`
  );
}

export async function notifyTelegramLinked(opts: {
  email: string | null;
  telegramUsername: string | null;
  linkedAt: Date;
}): Promise<void> {
  await sendSinkMessage(
    `🔗 telegram linked\n` +
      `email: ${opts.email ?? "-"}\n` +
      `telegram: ${opts.telegramUsername ? "@" + opts.telegramUsername : "-"}\n` +
      `linked: ${opts.linkedAt.toISOString()}`
  );
}

export async function notifyFirstLogin(opts: {
  email: string | null;
  loggedInAt: Date;
  source?: string;
}): Promise<void> {
  await sendSinkMessage(
    `👋 first login\n` +
      `email: ${opts.email ?? "-"}\n` +
      `first login: ${opts.loggedInAt.toISOString()}` +
      (opts.source ? `\nsource: ${opts.source}` : "")
  );
}

export async function notifyServerRegistered(opts: {
  email: string | null;
  serverName: string;
  vpsProvider: string;
  declaredIp: string;
  declaredLocation: string;
  adminUrl: string;
}): Promise<void> {
  await sendSinkMessage(
    `🖥 new server registration\n` +
      `email: ${opts.email ?? "-"}\n` +
      `server: ${opts.serverName}\n` +
      `provider: ${opts.vpsProvider}\n` +
      `declared ip: ${opts.declaredIp}\n` +
      `declared location: ${opts.declaredLocation}\n` +
      `${opts.adminUrl}`
  );
}

export async function notifyIpMismatch(opts: {
  email: string | null;
  serverName: string;
  declaredIp: string;
  actualIp: string;
  actualLocation: string | null;
  adminUrl: string;
}): Promise<void> {
  await sendSinkMessage(
    `🚩 declared/actual IP mismatch\n` +
      `email: ${opts.email ?? "-"}\n` +
      `server: ${opts.serverName}\n` +
      `declared ip: ${opts.declaredIp}\n` +
      `actual ip: ${opts.actualIp}${opts.actualLocation ? ` (${opts.actualLocation})` : ""}\n` +
      `${opts.adminUrl}`
  );
}

export async function notifyCountryChange(opts: {
  email: string | null;
  serverName: string;
  fromCountry: string;
  toCountry: string;
  newIp: string;
  adminUrl: string;
}): Promise<void> {
  await sendSinkMessage(
    `🌍 captured IP changed country\n` +
      `email: ${opts.email ?? "-"}\n` +
      `server: ${opts.serverName}\n` +
      `${opts.fromCountry} -> ${opts.toCountry}\n` +
      `new ip: ${opts.newIp}\n` +
      `${opts.adminUrl}`
  );
}

export async function notifyStrategyRequestSubmitted(opts: {
  email: string | null;
  summary: string;
  adminUrl: string;
}): Promise<void> {
  await sendSinkMessage(
    `🧠 new strategy request\n` +
      `email: ${opts.email ?? "-"}\n` +
      `${opts.summary}\n` +
      `${opts.adminUrl}`
  );
}

export async function notifyStrategySubmissionSubmitted(opts: {
  email: string | null;
  summary: string;
  adminUrl: string;
}): Promise<void> {
  await sendSinkMessage(
    `🧠 new add your strategy submission\n` +
      `email: ${opts.email ?? "-"}\n` +
      `${opts.summary}\n` +
      `${opts.adminUrl}`
  );
}

export async function notifyFeedTierRequestSubmitted(opts: {
  email: string | null;
  tierName: string;
  licenseKey: string;
  serverName: string | null;
  serverIp: string | null;
  serverRegistered: boolean;
  adminUrl: string;
}): Promise<void> {
  let server = "-";
  if (opts.serverRegistered && opts.serverIp) {
    server = opts.serverName ? `${opts.serverName} (${opts.serverIp})` : opts.serverIp;
  } else if (opts.serverIp) {
    server = `${opts.serverIp} (unregistered)`;
  }
  await sendApprovalsTopicMessage(
    `📡 new feed request\n` +
      `email: ${opts.email ?? "-"}\n` +
      `tier: ${opts.tierName}\n` +
      `license: …${keyTail(opts.licenseKey)}\n` +
      `server: ${server}\n` +
      `${opts.adminUrl}`
  );
}

export async function notifyFeedTierTrialStarted(opts: {
  email: string | null;
  tierName: string;
  licenseKey: string;
  trialEndsAt: Date;
  serverName: string | null;
  serverIp: string | null;
  serverRegistered: boolean;
  adminUrl: string;
}): Promise<void> {
  let server = "-";
  if (opts.serverRegistered && opts.serverIp) {
    server = opts.serverName ? `${opts.serverName} (${opts.serverIp})` : opts.serverIp;
  } else if (opts.serverIp) {
    server = `${opts.serverIp} (unregistered)`;
  }
  await sendSinkMessage(
    `🧪 trial started\n` +
      `email: ${opts.email ?? "-"}\n` +
      `tier: ${opts.tierName}\n` +
      `license: …${keyTail(opts.licenseKey)}\n` +
      `server: ${server}\n` +
      `ends: ${opts.trialEndsAt.toISOString()}\n` +
      `${opts.adminUrl}`
  );
}

export async function notifyFeedTierTrialActivated(opts: {
  email: string | null;
  tierName: string;
  licenseKey: string;
  activatedAt: Date;
  trialEndsAt: Date;
  serverName: string | null;
  serverIp: string | null;
  serverRegistered: boolean;
  adminUrl: string;
}): Promise<void> {
  let server = "-";
  if (opts.serverRegistered && opts.serverIp) {
    server = opts.serverName ? `${opts.serverName} (${opts.serverIp})` : opts.serverIp;
  } else if (opts.serverIp) {
    server = `${opts.serverIp} (unregistered)`;
  }
  await sendSinkMessage(
    `✅ trial activated\n` +
      `email: ${opts.email ?? "-"}\n` +
      `tier: ${opts.tierName}\n` +
      `license: …${keyTail(opts.licenseKey)}\n` +
      `server: ${server}\n` +
      `activated: ${opts.activatedAt.toISOString()}\n` +
      `expires: ${opts.trialEndsAt.toISOString()}\n` +
      `${opts.adminUrl}`
  );
}

export async function notifyFeedTierTrialConverted(opts: {
  email: string | null;
  tierName: string;
  licenseKey: string;
}): Promise<void> {
  await sendSinkMessage(
    `💳 trial converted\n` +
      `email: ${opts.email ?? "-"}\n` +
      `tier: ${opts.tierName}\n` +
      `license: …${keyTail(opts.licenseKey)}`
  );
}

export async function notifyBlackTrialRequested(opts: {
  email: string | null;
  licenseKey: string;
  serverName: string | null;
  serverIp: string | null;
  adminUrl: string;
}): Promise<void> {
  await sendSinkMessage(
    `⚫️ Black trial requested\n` +
      `email: ${opts.email ?? "-"}\n` +
      `license: …${keyTail(opts.licenseKey)}\n` +
      `server: ${opts.serverName ?? "-"} (${opts.serverIp ?? "-"})\n` +
      `${opts.adminUrl}`
  );
}

export async function notifyBlackTrialConvertRequested(opts: {
  email: string | null;
  licenseKey: string;
  expiresAt: Date | null;
}): Promise<void> {
  await sendSinkMessage(
    `⬆️ Black trial convert requested\n` +
      `email: ${opts.email ?? "-"}\n` +
      `license: …${keyTail(opts.licenseKey)}` +
      (opts.expiresAt ? `\ntrial expires: ${opts.expiresAt.toISOString()}` : "")
  );
}

function fmt(v: unknown): string {
  if (v === undefined || v === null) return "-";
  if (typeof v === "object") return JSON.stringify(v);
  return String(v);
}
