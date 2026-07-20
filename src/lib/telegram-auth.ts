import { createHash, createHmac, timingSafeEqual } from "crypto";

export interface TelegramLoginPayload {
  id: number;
  first_name?: string;
  last_name?: string;
  username?: string;
  photo_url?: string;
  auth_date: number;
  hash: string;
  [key: string]: unknown;
}

const AUTH_FRESHNESS_SECONDS = 24 * 60 * 60;

/**
 * Validates a Telegram Login Widget payload per Telegram's documented scheme:
 * https://core.telegram.org/widgets/login#checking-authorization
 */
export function verifyTelegramLogin(
  payload: TelegramLoginPayload,
  botToken: string
): boolean {
  const { hash, ...fields } = payload;
  if (!hash) return false;

  const dataCheckString = Object.keys(fields)
    .sort()
    .map((key) => `${key}=${fields[key]}`)
    .join("\n");

  const secretKey = createHash("sha256").update(botToken).digest();
  const computedHash = createHmac("sha256", secretKey)
    .update(dataCheckString)
    .digest("hex");

  const provided = Buffer.from(hash, "hex");
  const computed = Buffer.from(computedHash, "hex");
  if (provided.length !== computed.length) return false;
  if (!timingSafeEqual(provided, computed)) return false;

  const ageSeconds = Math.floor(Date.now() / 1000) - payload.auth_date;
  if (ageSeconds > AUTH_FRESHNESS_SECONDS || ageSeconds < 0) return false;

  return true;
}
