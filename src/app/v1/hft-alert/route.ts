import { NextRequest, NextResponse } from "next/server";
import { verifyLicenseKey, getAlertTargetForLicense } from "@/lib/licenses";
import { checkHftAlertRateLimit } from "@/lib/rate-limit";
import { httpsViolation, clientIp } from "@/lib/client-endpoints";
import { sendHftAlertMessage, hftAlertBotConfigured, getHftAlertBotUsername } from "@/lib/telegram-hft-alert-bot";

/**
 * /v1/hft-alert — desktop-client alert relay (spec: horizon-portal-tg-relay-endpoint-2026-08-12).
 * Client sends the raw trade alert here instead of holding a Telegram bot token in
 * AppConfig.cs (decompilable, per FOC12's v2.0.4 client). No client-supplied chat_id —
 * the server always resolves the DM target from license_key -> user ->
 * users.telegram_user_id, so a leaked key can only spam the linked account's own DM.
 *
 * Auth: Authorization: Bearer <license_key> (same key the client already holds from
 * /v1/validate). Request body: { alert_type, message, metadata: { symbol, pnl, strategy } }.
 *
 * "Linked" here means the user has both (a) a Horizon account with telegram_user_id set
 * (via portal Telegram login or the /start webhook) and (b) actually opened this specific
 * bot and hit Start — Telegram only allows a bot to DM users who've done that, regardless
 * of what other bots they've linked. A 403 from sendMessage is the signal for "hasn't
 * started this bot yet" and is treated the same as "no telegram_user_id at all."
 */

const MAX_MESSAGE_LENGTH = 1000;
const MAX_METADATA_STRING_LENGTH = 200;

interface AlertBody {
  alert_type?: unknown;
  message?: unknown;
  metadata?: {
    symbol?: unknown;
    pnl?: unknown;
    strategy?: unknown;
  };
}

function htmlEscape(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

function truncate(s: string, max: number): string {
  return s.length > max ? s.slice(0, max) : s;
}

export async function POST(req: NextRequest) {
  const httpErr = httpsViolation(req);
  if (httpErr) return httpErr;

  const auth = req.headers.get("authorization");
  const licenseKey = auth?.startsWith("Bearer ") ? auth.slice("Bearer ".length).trim() : null;
  if (!licenseKey) {
    return NextResponse.json({ error: "authorization required" }, { status: 401 });
  }

  let body: AlertBody;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "invalid json" }, { status: 400 });
  }

  if (typeof body.alert_type !== "string" || !body.alert_type) {
    return NextResponse.json({ error: "alert_type required" }, { status: 400 });
  }
  if (typeof body.message !== "string" || !body.message) {
    return NextResponse.json({ error: "message required" }, { status: 400 });
  }

  const ip = clientIp(req);
  if (!(await checkHftAlertRateLimit(licenseKey, ip))) {
    return NextResponse.json({ error: "rate limited" }, { status: 429 });
  }

  const result = await verifyLicenseKey(licenseKey);
  if (result.status === "not_found") {
    return NextResponse.json({ error: "not_found" }, { status: 404 });
  }
  if (result.status !== "active") {
    return NextResponse.json({ error: result.status }, { status: 403 });
  }

  const target = result.licenseId ? await getAlertTargetForLicense(result.licenseId) : null;
  if (!target || !target.telegramUserId || !hftAlertBotConfigured()) {
    console.log(
      `hft-alert: not_linked license=…${licenseKey.slice(-4)} user=${target?.userId ?? "unknown"}`
    );
    return NextResponse.json({ status: "not_linked" });
  }

  const alertType = truncate(body.alert_type, 100);
  const message = truncate(body.message, MAX_MESSAGE_LENGTH);
  const symbol = typeof body.metadata?.symbol === "string" ? truncate(body.metadata.symbol, MAX_METADATA_STRING_LENGTH) : null;
  const strategy =
    typeof body.metadata?.strategy === "string" ? truncate(body.metadata.strategy, MAX_METADATA_STRING_LENGTH) : null;
  const pnl =
    typeof body.metadata?.pnl === "number" || typeof body.metadata?.pnl === "string" ? String(body.metadata.pnl) : null;

  const lines = [`<b>⚡ ${htmlEscape(alertType)}</b>`, htmlEscape(message)];
  const metaParts: string[] = [];
  if (symbol) metaParts.push(`sym ${htmlEscape(symbol)}`);
  if (pnl !== null) metaParts.push(`pnl ${htmlEscape(pnl)}`);
  if (strategy) metaParts.push(`strat ${htmlEscape(strategy)}`);
  if (metaParts.length) lines.push(metaParts.join(" · "));
  const text = lines.join("\n");

  const sent = await sendHftAlertMessage(target.telegramUserId, text);
  console.log(
    `hft-alert: ${sent ? "sent" : "send_failed"} license=…${licenseKey.slice(-4)} user=${target.userId} type=${alertType}`
  );

  if (!sent) {
    // Most likely cause: user has telegram_user_id linked (via login) but never opened
    // *this* bot, so Telegram refuses the DM. Same client-facing shape as "not linked."
    return NextResponse.json({ status: "not_linked" });
  }

  return NextResponse.json({ status: "sent" });
}

/** Convenience for support/ops — not part of the client contract. */
export async function GET() {
  const username = hftAlertBotConfigured() ? await getHftAlertBotUsername() : null;
  return NextResponse.json({ bot_username: username });
}
