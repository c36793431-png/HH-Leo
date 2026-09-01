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

type RoleBearer = { role?: string | null; roles?: string[] | null };

// Checks the multi-role user_roles set (session.user.roles) when present,
// falling back to the single display role for any caller that hasn't been
// upgraded to pass roles yet -- see user-roles-migration-2026-09-01 step 2.
function hasRole(user: RoleBearer | null | undefined, role: string): boolean {
  if (user?.roles) return user.roles.includes(role);
  return user?.role === role;
}

/**
 * Real admin gate: admin held in user_roles (present in the JWT/session), with
 * the original hardcoded email kept as a fallback for stale sessions that
 * predate the role column. Use this instead of isAdminUsersPanelEmail for any
 * new access check.
 */
export function isAdminUser(
  user: { email?: string | null; role?: string | null; roles?: string[] | null } | null | undefined
): boolean {
  return hasRole(user, "admin") || isAdminUsersPanelEmail(user?.email);
}

/** Partner gate for the Partner Referral Programme (bus thread
 * leo-partner-referral-programme-build-2026-08-21) — manually-onboarded partners like
 * Legitcashmaker, distinct from the self-serve referral_earnings system. */
export function isPartnerUser(user: RoleBearer | null | undefined): boolean {
  return hasRole(user, "partner");
}

/** Feed Provider gate for the provider self-serve panel at feed.horizonhft.com (bus thread
 * leo-provider-panel-implementation-2026-08-22) — vendors who own one or more feed_tiers
 * rows (via feed_tiers.provider_user_id) and self-serve-approve their own subscriber queue. */
export function isFeedProviderUser(user: RoleBearer | null | undefined): boolean {
  return hasRole(user, "feed_provider");
}
