/**
 * Hardcoded gate for the coxwell-only license lifecycle test buttons on /dashboard
 * (bus thread horizon-portal-license-status-widget-2026-07-26). Same shape as
 * ADMIN_USERS_PANEL_EMAIL in admin-users-panel.ts — email is the stable identifier
 * (a fresh users.id can't be hardcoded before the account exists), not a real
 * role/permission check. Replace once proper admin roles land.
 */
export const COXWELL_TEST_USER_EMAIL = "c36793431@gmail.com";

export function isCoxwellTestUserEmail(email: string | null | undefined): boolean {
  return email?.trim().toLowerCase() === COXWELL_TEST_USER_EMAIL;
}
