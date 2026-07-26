const rtf = new Intl.RelativeTimeFormat("en", { numeric: "auto" });

/** "in 2 days" / "47 minutes ago" — picks the coarsest unit that keeps the value readable. */
export function formatRelative(date: Date): string {
  const diffSec = Math.round((date.getTime() - Date.now()) / 1000);
  const abs = Math.abs(diffSec);
  if (abs < 60) return rtf.format(diffSec, "second");
  const diffMin = Math.round(diffSec / 60);
  if (Math.abs(diffMin) < 60) return rtf.format(diffMin, "minute");
  const diffHour = Math.round(diffMin / 60);
  if (Math.abs(diffHour) < 24) return rtf.format(diffHour, "hour");
  const diffDay = Math.round(diffHour / 24);
  return rtf.format(diffDay, "day");
}

/** "2026-07-28 14:22 UTC" */
export function formatAbsoluteUtc(date: Date): string {
  return `${date.toISOString().slice(0, 16).replace("T", " ")} UTC`;
}

/** "23 minutes" / "6 hours" / "3 days" / falls back to an absolute date past a week out —
 * for copy that must stay precise close to expiry (unlike formatRelative's coarser rounding). */
export function humanizeTimeUntil(date: Date, now: Date = new Date()): string {
  const ms = date.getTime() - now.getTime();
  if (ms <= 0) return "0 minutes";
  const minutes = Math.round(ms / 60_000);
  if (minutes < 60) return `${minutes} minute${minutes === 1 ? "" : "s"}`;
  const hours = Math.round(ms / 3_600_000);
  if (hours < 24) return `${hours} hour${hours === 1 ? "" : "s"}`;
  const days = Math.round(ms / 86_400_000);
  if (days < 7) return `${days} day${days === 1 ? "" : "s"}`;
  return formatAbsoluteUtc(date);
}
