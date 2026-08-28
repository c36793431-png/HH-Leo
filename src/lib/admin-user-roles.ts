/** Roles the admin user editor can write. feed_provider/partner have purpose-built
 * approval flows (provider-applications.ts, partner-applications.ts) and must not be
 * hand-editable here — keep this list as the single source both the server guard in
 * actions.ts and the read-only UI branch in role-select-field.tsx read from. */
export const EDITABLE_USER_ROLES = ["user", "admin"] as const;
export type EditableUserRole = (typeof EDITABLE_USER_ROLES)[number];
