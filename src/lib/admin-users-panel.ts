/**
 * Original single-admin gate (bus thread
 * horizon-portal-license-status-widget-2026-07-26, scope expansion). Kept as a
 * fallback so this account stays admin even if its users.role row is ever
 * reset — real gating is now users.role === 'admin', see isAdminUser below.
 */
export const ADMIN_USERS_PANEL_EMAIL = "hfthorizon@keemail.me";

// Compare trimmed + lowercased so stray whitespace or case differences
// (e.g. from magic-link email capitalization) don't cause a false 403.
export function isAdminUsersPanelEmail(email: string | null | undefined): boolean {
  return email?.trim().toLowerCase() === ADMIN_USERS_PANEL_EMAIL;
}

/**
 * Real admin gate: users.role === 'admin' (present in the JWT/session), with
 * the original hardcoded email kept as a fallback for stale sessions that
 * predate the role column. Use this instead of isAdminUsersPanelEmail for any
 * new access check.
 */
export function isAdminUser(user: { email?: string | null; role?: string | null } | null | undefined): boolean {
  return user?.role === "admin" || isAdminUsersPanelEmail(user?.email);
}

/** Partner gate for the Partner Referral Programme (bus thread
 * leo-partner-referral-programme-build-2026-08-21) — manually-onboarded partners like
 * Legitcashmaker, distinct from the self-serve referral_earnings system. */
export function isPartnerUser(user: { role?: string | null } | null | undefined): boolean {
  return user?.role === "partner";
}
