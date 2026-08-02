/**
 * Original single-admin identity — no longer used for access gating (see isAdminUser
 * below), but kept as the fallback identifier in resolveAdminUserId (lib/admin.ts) for
 * resolving a stale session id to a real users.id on admin_actions/downloads FK writes.
 */
export const ADMIN_USERS_PANEL_EMAIL = "hfthorizon@keemail.me";

/** Admin gate: users.role === 'admin' (present in the JWT/session). */
export function isAdminUser(user: { email?: string | null; role?: string | null } | null | undefined): boolean {
  return user?.role === "admin";
}
