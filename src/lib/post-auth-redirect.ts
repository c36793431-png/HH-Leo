const PARTNER_HOST = "partner.horizonhft.com";

/** Where to send a user immediately after auth (existing session on /login or /signup,
 * or a fresh sign-in), based on which host served the page. Mirrors the host check in
 * proxy.ts and partner/dashboard/layout.tsx — keep in sync if PARTNER_HOST changes. */
export function getPostAuthRedirect(host: string | null): string {
  const isPartnerHost = host === PARTNER_HOST || (host?.startsWith(`${PARTNER_HOST}:`) ?? false);
  return isPartnerHost ? "/partner/dashboard" : "/dashboard";
}
