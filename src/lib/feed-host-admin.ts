/**
 * /admin on the feed host (feed.horizonhft.com). The feed admin is an exact allowlist of the shared /admin route
 * files (decision_split_portal_admin_and_feed_admin_surfaces_2026-08-23; marcus-approved list,
 * feed-admin-dashboard-build-2026-08-24). Any other /admin URL is a portal admin page: it goes to the portal at the
 * same path and query instead of falling into the provider-panel rewrite, which 404'd it (coxwell via marcus
 * m63885 / m63907, option A: e.g. /admin/basket-requests, which the Telegram alert opens on the portal).
 */
export const ADMIN_FEED_ROUTES: readonly string[] = [
  "/admin",
  "/admin/revenue",
  "/admin/providers",
  "/admin/feed-health",
  "/admin/provider-applications",
  "/admin/register-provider",
  "/admin/feed-requests",
  "/admin/feed-tier-requests",
  "/admin/feed-tier-trials",
  "/admin/black-trials",
  "/admin/feed-boxes",
  "/admin/feed-connections",
  "/admin/accounts",
];

export const PORTAL_ORIGIN = "https://portal.horizonhft.com";

/** Exact match, not a prefix: a bare "/admin" prefix would let portal-only pages through (see the header). */
export function isAdminFeedRoute(pathname: string): boolean {
  return ADMIN_FEED_ROUTES.includes(pathname) || pathname.startsWith("/admin/provider-applications/");
}

/** The portal URL for an /admin path the feed host doesn't serve; null for anything the feed host handles itself. */
export function portalAdminRedirect(pathname: string, search: string): string | null {
  if (pathname !== "/admin" && !pathname.startsWith("/admin/")) return null;
  if (isAdminFeedRoute(pathname)) return null;
  return `${PORTAL_ORIGIN}${pathname}${search}`;
}
