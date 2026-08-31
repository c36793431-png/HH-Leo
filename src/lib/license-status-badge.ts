/** Single source of truth for the license-status badge shown across /admin/users and
 * /admin/dashboard — keeps vocabulary and styling identical everywhere a license's
 * computed status (see licenseStatusCaseSql in ./licenses) is rendered as a badge. */
export const LICENSE_BADGE_STYLES = {
  green: "border-emerald-500/40 bg-emerald-500/15 text-emerald-300",
  amber: "border-amber-500/40 bg-amber-500/15 text-amber-300",
  red: "border-red-500/40 bg-red-500/15 text-red-300",
  grey: "border-zinc-600/40 bg-zinc-600/15 text-zinc-400",
  blue: "border-blue-500/40 bg-blue-500/15 text-blue-300",
} as const;

export type LicenseBadgeColor = keyof typeof LICENSE_BADGE_STYLES;
export type ComputedLicenseStatus = "none" | "revoked" | "expired" | "expiring" | "active";

export const LICENSE_STATUS_BADGES: Record<ComputedLicenseStatus, { label: string; color: LicenseBadgeColor }> = {
  none: { label: "NO LICENSE", color: "grey" },
  revoked: { label: "REVOKED", color: "red" },
  expired: { label: "EXPIRED", color: "red" },
  expiring: { label: "EXPIRING", color: "amber" },
  active: { label: "ACTIVE", color: "green" },
};

export const LICENSE_BADGE_CLASS = "rounded-full border px-2 py-0.5 text-xs font-semibold tracking-wide";
