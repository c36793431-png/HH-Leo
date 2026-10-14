import { PORTAL_ORIGIN } from "./feed-host-admin";

/**
 * horizonone.horizonhft.com serves the Axiom signals page and its ingest route, and nothing else (coxwell 17:39Z
 * 2026-10-14 via marcus m68727; plan kai m68750, PLAN GO with rulings marcus m68767; fable plan read m68780 S1-S3,
 * folded per marcus m68786). Every other host 404s /admin/signals and the ingest route; local dev serves both on
 * any host. The ingest route checks the host in gateSignalIngest, because proxy.ts's matcher skips /api.
 */
export const HORIZONONE_HOST = "horizonone.horizonhft.com";

export const SIGNALS_PATH = "/admin/signals";

type Env = Record<string, string | undefined>;

/** Pure, no env (fable S2 m68780): the dev bypass lives in signalsHostOk only, else under next dev every host
 * would be horizonone and the portal would 404. Case-insensitive, with or without a port (proxy.ts's idiom). */
export function isHorizonOneHost(host: string | null): boolean {
  const h = (host ?? "").toLowerCase();
  return h === HORIZONONE_HOST || h.startsWith(`${HORIZONONE_HOST}:`);
}

/** Whether this host serves /admin/signals and the ingest route. The bypass is NODE_ENV === "development" only,
 * not "anything but production": previews run as production, so a preview 404s both (marcus m68767 Q1, Q2). */
export function signalsHostOk(host: string | null, env: Env): boolean {
  return isHorizonOneHost(host) || env.NODE_ENV === "development";
}

/** /admin/signals and anything under it. Not a bare prefix: /admin/signalsx is not the signals page. */
export function isSignalsPath(pathname: string): boolean {
  return pathname === SIGNALS_PATH || pathname.startsWith(`${SIGNALS_PATH}/`);
}

export type HorizonOneRoute = { kind: "redirect"; to: string } | { kind: "not-found" } | { kind: "pass" };

/**
 * What the horizonone host does with a path, before the /admin session and admin checks in proxy.ts run.
 * - "/" and "/dashboard" go to the page. /dashboard because after a sign-in /login sends everyone on a host it
 *   does not know there (getPostAuthRedirect in post-auth-redirect.ts) (fable S1 m68780).
 * - "/login" goes to the portal's /login, query kept: no login page renders here, so neither the Telegram widget
 *   (wrong bot domain on this host) nor a magic link that lands on /dashboard. The session cookie is
 *   .horizonhft.com, so the admin comes back signed in, but by hand: safeCallbackPath stays portal-only (fable S1,
 *   marcus m68786 (b)).
 * - Any other /admin path goes to the portal at the same path and query, like portalAdminRedirect on the feed
 *   host (marcus m68786 (c)).
 * - The page and static files pass. Every other path 404s.
 */
export function horizonOneRoute(pathname: string, search: string): HorizonOneRoute {
  if (pathname === "/" || pathname === "/dashboard") return { kind: "redirect", to: SIGNALS_PATH };
  if (pathname === "/login") return { kind: "redirect", to: `${PORTAL_ORIGIN}/login${search}` };
  if (isSignalsPath(pathname)) return { kind: "pass" };
  if (pathname === "/admin" || pathname.startsWith("/admin/")) return { kind: "redirect", to: `${PORTAL_ORIGIN}${pathname}${search}` };
  if (/\.[a-zA-Z0-9]+$/.test(pathname)) return { kind: "pass" };
  return { kind: "not-found" };
}
