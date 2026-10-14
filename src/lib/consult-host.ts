import { PORTAL_ORIGIN } from "./feed-host-admin";

/**
 * consult.horizonhft.com serves the consultant application page, and nothing else (consult host IN for v1, marcus
 * m68993; rulings m69004; scope kai m69020, Fable m69076 ask 4). Everything else on the host goes to the portal.
 */
export const CONSULT_HOST = "consult.horizonhft.com";

export const CONSULT_APPLY_PATH = "/consult/apply";

/** Case-insensitive, with or without a port (isHorizonOneHost's idiom). */
export function isConsultHost(host: string | null): boolean {
  const h = (host ?? "").toLowerCase();
  return h === CONSULT_HOST || h.startsWith(`${CONSULT_HOST}:`);
}

export type ConsultRoute = { kind: "rewrite"; to: string } | { kind: "redirect"; to: string } | { kind: "pass" };

/**
 * What the consult host does with a path (Fable m69076 ask 4).
 * - "/" renders the apply page (a rewrite, so the address stays the host root; its form posts to "/" too, as the
 *   partner host's rewritten forms do, Fable N3).
 * - The apply page itself and static files pass.
 * - Every other path goes to the portal at the same path and query: the page renders inside PortalShell for a
 *   signed-in visitor, whose nav links are portal paths, so a 404 here would be a dead link. /admin (ruling 1) and
 *   /login are two cases of this rule. The target is always PORTAL_ORIGIN, so it is no open redirect.
 */
export function consultRoute(pathname: string, search: string): ConsultRoute {
  if (pathname === "/") return { kind: "rewrite", to: CONSULT_APPLY_PATH };
  if (pathname === CONSULT_APPLY_PATH) return { kind: "pass" };
  if (/\.[a-zA-Z0-9]+$/.test(pathname)) return { kind: "pass" };
  return { kind: "redirect", to: `${PORTAL_ORIGIN}${pathname}${search}` };
}
