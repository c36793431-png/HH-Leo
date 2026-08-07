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

function fmt(v: unknown): string {
  if (v === undefined || v === null) return "-";
  if (typeof v === "object") return JSON.stringify(v);
  return String(v);
}
