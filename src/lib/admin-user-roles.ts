/** Every role a user row can carry, in the order the admin filter dropdown and the
 * role editor should list them. Single source for the /admin/users list (column +
 * filter) and the detail page's role editor, so the surfaces can't drift on labelling. */
export const ALL_USER_ROLES = ["admin", "feed_provider", "partner", "user"] as const;
export type UserRole = (typeof ALL_USER_ROLES)[number];

/** Roles the admin editor can only revoke, never grant. feed_provider/partner have
 * purpose-built approval flows (provider-applications.ts, partner-applications.ts);
 * ticking one on from here would create a user_roles row with no partners/
 * provider_applications row behind it — an account state nothing downstream has
 * ever seen. Held -> revocable. Not held -> the editor must render it inert and
 * point at the approval flow instead of accepting a grant. */
export const REVOKE_ONLY_ROLES = ["feed_provider", "partner"] as const;
export type RevokeOnlyRole = (typeof REVOKE_ONLY_ROLES)[number];

export const ROLE_LABELS: Record<UserRole, string> = {
  admin: "Admin",
  feed_provider: "Feed provider",
  partner: "Partner",
  user: "User",
};
