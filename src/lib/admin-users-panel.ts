/**
 * Hardcoded gate for the /admin/users panel (bus thread
 * horizon-portal-license-status-widget-2026-07-26, scope expansion). Not a real
 * role/permission check — replace with a proper role table once more than one
 * person needs this.
 */
export const ADMIN_USERS_PANEL_EMAIL = "hfthorizon@keemail.me";

// Compare trimmed + lowercased so stray whitespace or case differences
// (e.g. from magic-link email capitalization) don't cause a false 403.
export function isAdminUsersPanelEmail(email: string | null | undefined): boolean {
  return email?.trim().toLowerCase() === ADMIN_USERS_PANEL_EMAIL;
}
