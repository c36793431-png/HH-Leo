import { MARKETPLACE_LISTINGS, listingDetailHref } from "./marketplace-catalogue";

const PARTNER_HOST = "partner.horizonhft.com";
const FEED_HOST = "feed.horizonhft.com";

function isHost(host: string | null, name: string): boolean {
  return host === name || (host?.startsWith(`${name}:`) ?? false);
}

/** Where to send a user immediately after auth (existing session on /login or /signup,
 * or a fresh sign-in), based on which host served the page. Mirrors the host check in
 * proxy.ts and partner/dashboard/layout.tsx (and feed/dashboard/layout.tsx) — keep in
 * sync if PARTNER_HOST/FEED_HOST change. */
export function getPostAuthRedirect(host: string | null): string {
  if (isHost(host, PARTNER_HOST)) return "/partner/dashboard";
  if (isHost(host, FEED_HOST)) return "/feed/dashboard";
  return "/dashboard";
}

const CALLBACK_PARAM = "callbackUrl";

/** The only places a sign-in may return to: the public marketplace and its product pages
 * (coxwell via marcus, m55542/m55551). Built from the catalogue, so a listing that is removed
 * stops being a destination in the same commit. */
const CALLBACK_ALLOWLIST: readonly string[] = ["/marketplace", ...MARKETPLACE_LISTINGS.map(listingDetailHref)];

/**
 * The `callbackUrl` a signed-out marketplace visitor carries to /login or /signup, or null when
 * it is not one we honour. null means the caller falls back to getPostAuthRedirect.
 *
 * AN ALLOWLIST, NOT A PREFIX TEST (marcus, m55551 condition 1). The login page's
 * `if (session) redirect(redirectTo)` is Next's redirect(), which does no origin check, so a
 * "starts with /" rule would send a signed-in user to //evil.com. The value is compared EXACTLY
 * to the allowlist, and what comes back is the allowlist's own string, never the input.
 *
 * DECODED ONCE, by the URL parser that built searchParams. It is not decoded again: a residual
 * "%" means a second encoding layer and is refused, not unwrapped. The character checks below
 * are redundant with the exact match today. They are here so that loosening the match later
 * (a prefix, a pattern) still cannot let a scheme, a protocol-relative path or a traversal in.
 *
 * Portal host only: the partner and feed hosts keep their fixed destinations.
 */
export function safeCallbackPath(callbackUrl: string | string[] | undefined, host: string | null): string | null {
  if (isHost(host, PARTNER_HOST) || isHost(host, FEED_HOST)) return null;
  // A repeated param arrives as an array. Choosing one copy is a choice we don't need to make.
  if (typeof callbackUrl !== "string") return null;
  if (
    /[\u0000-\u001f\u007f%\\]/.test(callbackUrl) ||
    callbackUrl.includes("//") ||
    callbackUrl.includes("..") ||
    callbackUrl.includes(":")
  ) {
    return null;
  }
  return CALLBACK_ALLOWLIST.find((path) => path === callbackUrl) ?? null;
}

/** /login or /signup, carrying a callback path when there is one. The one spelling of the
 * param, so the marketplace's Sign in links and the login/signup cross-links cannot drift. */
export function authPageHref(page: "/login" | "/signup", callbackPath: string | null): string {
  return callbackPath ? `${page}?${CALLBACK_PARAM}=${encodeURIComponent(callbackPath)}` : page;
}
