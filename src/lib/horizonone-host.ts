/**
 * horizonone.horizonhft.com serves the Axiom signals page and its ingest route, and nothing else (coxwell 17:39Z
 * 2026-10-14 via marcus m68727; plan kai m68750, PLAN GO with rulings marcus m68767). Every other host 404s
 * /admin/signals; local dev serves it on any host. The ingest route checks the host itself, because proxy.ts's
 * matcher skips /api.
 */
export const HORIZONONE_HOST = "horizonone.horizonhft.com";

export const SIGNALS_PATH = "/admin/signals";

export function isHorizonOneHost(host: string | null): boolean {
  return host === HORIZONONE_HOST || (host?.startsWith(`${HORIZONONE_HOST}:`) ?? false);
}

/** /admin/signals and anything under it. Not a bare prefix: /admin/signalsx is not the signals page. */
export function isSignalsPath(pathname: string): boolean {
  return pathname === SIGNALS_PATH || pathname.startsWith(`${SIGNALS_PATH}/`);
}

/** Whether this host serves /admin/signals. The bypass is NODE_ENV === "development" only, not "anything but
 * production": previews run as production, so a preview 404s the page (marcus m68767 Q1 and Q2). */
export function signalsServedOn(host: string | null, nodeEnv: string | undefined): boolean {
  return nodeEnv === "development" || isHorizonOneHost(host);
}

export type HorizonOneRoute = { kind: "redirect"; to: string } | { kind: "not-found" } | { kind: "pass" };

/**
 * What the horizonone host does with a path, before the /admin session and admin checks in proxy.ts run.
 * "/" goes to the page. So does "/dashboard": after a sign-in, /login sends everyone on a host it does not know to
 * /dashboard (getPostAuthRedirect in post-auth-redirect.ts), and that page is not served here. /login and static
 * files pass so the magic-link sign-in renders. Every other path 404s, other /admin pages included.
 */
export function horizonOneRoute(pathname: string): HorizonOneRoute {
  if (pathname === "/" || pathname === "/dashboard") return { kind: "redirect", to: SIGNALS_PATH };
  if (pathname === "/login" || isSignalsPath(pathname) || /\.[a-zA-Z0-9]+$/.test(pathname)) return { kind: "pass" };
  return { kind: "not-found" };
}
