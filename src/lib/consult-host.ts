import { PORTAL_ORIGIN } from "./feed-host-admin";

/**
 * consult.horizonhft.com is the service-provider host (consult host IN for v1, marcus m68993; rulings m69004; scope
 * kai m69020, Fable m69076 ask 4; S2 foc16, marcus m71309): the home (apply, or the dashboard once signed in), the
 * provider dashboard, and sign-in/sign-up. Everything else on the host goes to the portal.
 */
export const CONSULT_HOST = "consult.horizonhft.com";

export const CONSULT_ORIGIN = `https://${CONSULT_HOST}`;

/** The Horizon hub. The consult pages link their logo here, not to the host's own root ("linked to horizon", coxwell via
 * marcus m71335 item 3). */
export const HORIZON_HUB_URL = "https://horizonhft.com";

export const CONSULT_APPLY_PATH = "/consult/apply";
export const CONSULT_HOME_PATH = "/consult";
export const CONSULT_DASHBOARD_PATH = "/consult/dashboard";

/** Case-insensitive, with or without a port (isHorizonOneHost's idiom). */
export function isConsultHost(host: string | null): boolean {
  const h = (host ?? "").toLowerCase();
  return h === CONSULT_HOST || h.startsWith(`${CONSULT_HOST}:`);
}

/** A horizonhft.com host, with or without a port, in any case: the apex or one subdomain label deep. */
function isHorizonHftHost(host: string | null): boolean {
  const h = (host ?? "").toLowerCase().replace(/:\d+$/, "");
  return /^([a-z0-9-]+\.)?horizonhft\.com$/.test(h);
}

/**
 * S1b (marcus m71322): consult.horizonhft.com is the entry point, so /consult/apply on any other horizonhft.com host
 * 308s to the consult host root, where the same page renders. Never on the consult host itself (no loop). Never on a
 * preview or local host, so previews keep the page. The exact path only; the page takes no query.
 */
export function consultApplyRedirect(host: string | null, pathname: string): string | null {
  if (pathname !== CONSULT_APPLY_PATH) return null;
  if (isConsultHost(host) || !isHorizonHftHost(host)) return null;
  return `${CONSULT_ORIGIN}/`;
}

export type ConsultRoute ={ kind: "rewrite"; to: string } | { kind: "redirect"; to: string } | { kind: "pass" };

/**
 * What the consult host does with a path (Fable m69076 ask 4; S2 marcus m71309).
 * - "/" renders the consult home (a rewrite, so the address stays the host root; the home renders the apply form for a
 *   signed-out visitor, whose form posts to "/" too, as the partner host's rewritten forms do, Fable N3).
 * - "/dashboard" and below render the provider dashboard, the feed host's shape (feed.* /dashboard -> /feed/dashboard).
 * - /login and /signup pass, so sign-in renders on this host (as on partner.* and feed.*) and returns to the dashboard
 *   (post-auth-redirect.ts). The consult pages themselves and static files pass. /admin and anything under it is
 *   checked first, so a dotted path such as /admin/x.json goes to the portal too and never reaches the /admin guard on
 *   this host (Fable S1 m69219).
 * - Every other path goes to the portal at the same path and query: the page renders inside PortalShell for a
 *   signed-in visitor, whose nav links are portal paths, so a 404 here would be a dead link. /admin (ruling 1) is one
 *   case of this rule. The target is always PORTAL_ORIGIN, so it is no open redirect.
 */
export function consultRoute(pathname: string, search: string): ConsultRoute {
  if (pathname === "/") return { kind: "rewrite", to: CONSULT_HOME_PATH };
  if (pathname === "/dashboard" || pathname.startsWith("/dashboard/")) {
    return { kind: "rewrite", to: `${CONSULT_DASHBOARD_PATH}${pathname.slice("/dashboard".length)}` };
  }
  if (pathname === "/login" || pathname === "/signup" || pathname === CONSULT_HOME_PATH || pathname === CONSULT_APPLY_PATH) {
    return { kind: "pass" };
  }
  if (pathname === CONSULT_DASHBOARD_PATH || pathname.startsWith(`${CONSULT_DASHBOARD_PATH}/`)) return { kind: "pass" };
  if (pathname === "/admin" || pathname.startsWith("/admin/")) return { kind: "redirect", to: `${PORTAL_ORIGIN}${pathname}${search}` };
  if (/\.[a-zA-Z0-9]+$/.test(pathname)) return { kind: "pass" };
  return { kind: "redirect", to: `${PORTAL_ORIGIN}${pathname}${search}` };
}
