const PARTNER_HOST = "partner.horizonhft.com";
const FEED_HOST = "feed.horizonhft.com";

/** Where to send a user immediately after auth (existing session on /login or /signup,
 * or a fresh sign-in), based on which host served the page. Mirrors the host check in
 * proxy.ts and partner/dashboard/layout.tsx (and feed/dashboard/layout.tsx) — keep in
 * sync if PARTNER_HOST/FEED_HOST change. */
export function getPostAuthRedirect(host: string | null): string {
  const isPartnerHost = host === PARTNER_HOST || (host?.startsWith(`${PARTNER_HOST}:`) ?? false);
  if (isPartnerHost) return "/partner/dashboard";
  const isFeedHost = host === FEED_HOST || (host?.startsWith(`${FEED_HOST}:`) ?? false);
  if (isFeedHost) return "/feed/dashboard";
  return "/dashboard";
}
