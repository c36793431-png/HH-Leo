/** Roles the admin user editor can write. feed_provider/partner have purpose-built
 * approval flows (provider-applications.ts, partner-applications.ts) and must not be
 * hand-editable here — keep this list as the single source both the server guard in
 * actions.ts and the read-only UI branch in role-select-field.tsx read from. */
export const EDITABLE_USER_ROLES = ["user", "admin"] as const;
export type EditableUserRole = (typeof EDITABLE_USER_ROLES)[number];

/** Every role a user row can carry, in the order the admin filter dropdown should list
 * them. Single source for both the /admin/users list (column + filter) and the detail
 * page's read-only role display, so the two surfaces can't drift on labelling. */
export const ALL_USER_ROLES = ["admin", "feed_provider", "partner", "user"] as const;
export type UserRole = (typeof ALL_USER_ROLES)[number];

export const ROLE_LABELS: Record<UserRole, string> = {
  admin: "Admin",
  feed_provider: "Feed provider",
  partner: "Partner",
  user: "User",
};
