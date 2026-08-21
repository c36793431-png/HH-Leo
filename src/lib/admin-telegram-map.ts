/**
 * Maps a Telegram user id to the portal admin user id that should show up as
 * `actioned_by` when that admin taps an inline button. Env var format:
 * "123456:coxwell-user-uuid,789012:marcus-user-uuid" (leo-admin-inline-actions-
 * reusable-pattern-2026-08-21) -- an env var is fine for this tiny static admin
 * set; a DB table is unnecessary infra for v1.
 */
let cachedMap: Map<number, string> | null = null;

function parseMap(): Map<number, string> {
  if (cachedMap) return cachedMap;
  const raw = process.env.ADMIN_TELEGRAM_MAP ?? "";
  const map = new Map<number, string>();
  for (const entry of raw.split(",")) {
    const [tgId, userId] = entry.split(":").map((s) => s.trim());
    const parsed = Number(tgId);
    if (tgId && userId && Number.isFinite(parsed)) map.set(parsed, userId);
  }
  cachedMap = map;
  return map;
}

export function resolveAdminUserId(telegramUserId: number): string | null {
  return parseMap().get(telegramUserId) ?? null;
}
