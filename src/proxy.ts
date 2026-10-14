import { auth } from "@/lib/auth";
import { NextResponse, type NextRequest } from "next/server";
import { isAdminUser } from "@/lib/admin-users-panel";
import { REFERRAL_COOKIE, REFERRAL_COOKIE_MAX_AGE_DAYS } from "@/lib/referrals";
import { getActivePartnerReferralCode } from "@/lib/partners";
import { isAdminFeedRoute, portalAdminRedirect } from "@/lib/feed-host-admin";
import { horizonOneRoute, isHorizonOneHost, isSignalsPath, signalsHostOk } from "@/lib/horizonone-host";
import { consultRoute, isConsultHost } from "@/lib/consult-host";

const PARTNER_HOST = "partner.horizonhft.com";
const FEED_HOST = "feed.horizonhft.com";

// Auth.js session/csrf/callback cookies are scoped to this same domain in production
// (see lib/auth.ts) so a signed-in session on one *.horizonhft.com host is visible on
// the other. The ref-attribution cookie needs to match that scope or a partner-derived
// hz_ref set here wouldn't survive a redirect from partner.horizonhft.com to portal's
// /signup. Unset in dev so cookies still work against localhost.
const REFERRAL_COOKIE_DOMAIN = process.env.NODE_ENV === "production" ? ".horizonhft.com" : undefined;

/** Auto-attributes visits to partner.horizonhft.com to that partner's referral_code, so a
 * signup that happens later in the same browser session lands in `referred_by_user_id` via
 * the existing attributeReferralFromCookie flow — no ?ref= param needed. Only sets the cookie
 * once (skips if the request or response already carries one), so an explicit ?ref= param
 * elsewhere always wins and repeat visits don't re-query the DB. */
async function withPartnerRefCookie(req: NextRequest, res: NextResponse): Promise<NextResponse> {
  if (req.cookies.get(REFERRAL_COOKIE) || res.cookies.get(REFERRAL_COOKIE)) return res;
  const code = await getActivePartnerReferralCode();
  if (code) {
    res.cookies.set(REFERRAL_COOKIE, code, {
      httpOnly: true,
      sameSite: "lax",
      maxAge: REFERRAL_COOKIE_MAX_AGE_DAYS * 24 * 60 * 60,
      path: "/",
      domain: REFERRAL_COOKIE_DOMAIN,
    });
  }
  return res;
}

export default auth(async (req) => {
  const host = req.headers.get("host") || "";
  const isPartnerHost = host === PARTNER_HOST || host.startsWith(`${PARTNER_HOST}:`);
  const pathname = req.nextUrl.pathname;

  if (isHorizonOneHost(host)) {
    // horizonone.horizonhft.com serves the Axiom signals page, nothing else (marcus m68767, m68786); sign-in and
    // other admin pages go to the portal. The routing and its reasons live in lib/horizonone-host.ts, with its
    // tests. What passes still goes through the /admin session and admin checks below.
    const route = horizonOneRoute(pathname, req.nextUrl.search);
    if (route.kind === "redirect") return NextResponse.redirect(new URL(route.to, req.nextUrl), 307);
    if (route.kind === "not-found") return new NextResponse("Not Found", { status: 404 });
  }

  if (isConsultHost(host)) {
    // consult.horizonhft.com serves the consultant application page at its root, nothing else (marcus m68993,
    // m69004 ruling 1; Fable m69076 ask 4); every other path, /admin and /login included, goes to the portal at the
    // same path and query. The routing and its reasons live in lib/consult-host.ts, with its tests.
    const route = consultRoute(pathname, req.nextUrl.search);
    if (route.kind === "redirect") return NextResponse.redirect(route.to, 307);
    if (route.kind === "rewrite") {
      const url = req.nextUrl.clone();
      url.pathname = route.to;
      return NextResponse.rewrite(url);
    }
  }

  if (isPartnerHost) {
    // partner.horizonhft.com serves the partner landing/dashboard, rewritten to
    // /partner internally so it lands at the domain root, not /partner/partner.
    // The admin partner-management + partner-applications-review views also live here
    // (same admin as portal.horizonhft.com), but every other /admin/* route stays
    // portal-only to avoid leaking unrelated admin surfaces.
    const isAdminPartnerRoute =
      pathname.startsWith("/admin/partners") ||
      pathname.startsWith("/admin/partner-applications") ||
      pathname.startsWith("/admin/partner-approval-queue");
    if (pathname.startsWith("/admin") && !isAdminPartnerRoute) {
      return new NextResponse("Not Found", { status: 404 });
    }
    // /login and /signup pass through unrewritten so the real NextAuth pages render on this
    // host instead of 404ing against a nonexistent /partner/login or /partner/signup.
    // Static files under public/ (brand/*, careers/*, logo.png, etc.) must also pass through
    // unrewritten — otherwise e.g. /brand/horizon-logo-paid.png becomes /partner/brand/... and
    // 404s, which the _next/image optimizer then surfaces as a broken logo.
    const isStaticAsset = /\.[a-zA-Z0-9]+$/.test(pathname);
    const passthrough =
      pathname === "/login" ||
      pathname === "/signup" ||
      pathname.startsWith("/partner") ||
      isAdminPartnerRoute ||
      isStaticAsset;

    if (!passthrough) {
      const url = req.nextUrl.clone();
      url.pathname = `/partner${pathname === "/" ? "" : pathname}`;
      return withPartnerRefCookie(req, NextResponse.rewrite(url));
    }
  }

  const isFeedHost = host === FEED_HOST || host.startsWith(`${FEED_HOST}:`);
  if (isFeedHost) {
    // feed.horizonhft.com serves the provider self-serve panel, rewritten to /feed
    // internally so it lands at the domain root (mirrors the partner-host block above).
    // Feed-ops admin pages also live here, unrewritten, same /admin/* route files as
    // portal.horizonhft.com, gated by the same isAdminUser check below
    // (decision_split_portal_admin_and_feed_admin_surfaces_2026-08-23; host-rewrite fix
    // 2026-08-24). Exact-match allowlist, not a prefix -- a bare "/admin" prefix would also
    // pass through /admin/users and /admin/finance, which are portal-only and must stay
    // 404 on this host (marcus-approved list, feed-admin-dashboard-build-2026-08-24). The list lives in
    // lib/feed-host-admin.ts (ADMIN_FEED_ROUTES), with its tests.
    const adminFeedRoute = isAdminFeedRoute(pathname);
    const isStaticAsset = /\.[a-zA-Z0-9]+$/.test(pathname);
    const passthrough =
      pathname === "/login" ||
      pathname === "/signup" ||
      pathname === "/account" ||
      pathname.startsWith("/account/") ||
      pathname.startsWith("/feed") ||
      adminFeedRoute ||
      isStaticAsset;

    // Admin has its own page (coxwell, feed-admin-role-collision-fix-2026-08-24): bounce them
    // off the provider dashboard before the /feed rewrite below. Checked against both the raw
    // pathname (feed.horizonhft.com/dashboard) and the rewritten target (/feed/dashboard),
    // since this host rewrites everything under /feed onto the root -- checked independent of
    // `passthrough` so a direct /feed/dashboard request (already passthrough, since it starts
    // with /feed) still gets caught. Scoped to the /feed/dashboard subtree plus the bare host
    // root (widened 2026-08-24, feed-root-admin-redirect) -- /feed/* beyond dashboard, notably
    // /feed/providers/apply, stays public for both audiences, and /admin/* is passthrough
    // (unrewritten) so this never loops.
    const rewrittenPathname = `/feed${pathname === "/" ? "" : pathname}`;
    const isFeedDashboardPath = pathname.startsWith("/feed/dashboard") || rewrittenPathname.startsWith("/feed/dashboard");
    const isFeedRootPath = pathname === "/" || rewrittenPathname === "/feed";
    if ((isFeedDashboardPath || isFeedRootPath) && isAdminUser(req.auth?.user)) {
      return NextResponse.redirect(new URL("/admin/provider-applications", req.nextUrl));
    }

    // A portal admin page typed on this host (e.g. /admin/basket-requests, which the Telegram alert opens on the
    // portal) goes to the portal at the same path and query, before the /feed rewrite below would 404 it (coxwell via
    // marcus m63885 / m63907). The admin stays signed in: the session cookie is scoped to the parent domain.
    const toPortal = portalAdminRedirect(pathname, req.nextUrl.search);
    if (toPortal) return NextResponse.redirect(toPortal, 307);

    if (!passthrough) {
      const url = req.nextUrl.clone();
      url.pathname = `/feed${pathname === "/" ? "" : pathname}`;
      return NextResponse.rewrite(url);
    }
  }

  if (pathname.startsWith("/admin")) {
    if (!req.auth?.user) {
      return NextResponse.redirect(new URL("/login", req.nextUrl));
    }
    if (!isAdminUser(req.auth.user)) {
      return new NextResponse("Forbidden", { status: 403 });
    }
    // Mirrors ADMIN_FEED_ROUTES above (decision_split_portal_admin_and_feed_admin_surfaces_2026-08-23):
    // the feed-host branch already 404s portal-only /admin/* routes there, but the portal host had no
    // equivalent allowlist and would happily render these feed-only routes under portal chrome instead
    // of 404ing -- a one-directional enforcement gap (feed-admin-portal-link-sweep-2026-08-28). Bare
    // "/admin" is excluded: that route file host-branches internally and is legitimately dual-host.
    // Checked after the 403 above so a non-admin still gets Forbidden, not a 404 that leaks which
    // admin routes exist.
    const FEED_ONLY_ADMIN_ROUTES = ["/admin/revenue", "/admin/providers", "/admin/feed-health", "/admin/provider-applications", "/admin/register-provider", "/admin/feed-requests", "/admin/feed-tier-requests", "/admin/feed-tier-trials", "/admin/black-trials", "/admin/feed-boxes", "/admin/feed-connections", "/admin/accounts"];
    const isFeedOnlyAdminRoute =
      FEED_ONLY_ADMIN_ROUTES.includes(pathname) || pathname.startsWith("/admin/provider-applications/");
    if (!isFeedHost && !isPartnerHost && isFeedOnlyAdminRoute) {
      return new NextResponse("Not Found", { status: 404 });
    }
    // The signals page is served on horizonone.horizonhft.com only (and on any host in local dev), so the portal
    // and previews 404 it (marcus m68767 Q1, Q2). After the 403 for the same reason as the check above.
    if (isSignalsPath(pathname) && !signalsHostOk(host, process.env)) {
      return new NextResponse("Not Found", { status: 404 });
    }
  }

  // Captures ?ref=<code> on any route into a 30-day cookie, ahead of whichever auth path
  // (Telegram widget or email magic link) actually creates the users row — see
  // lib/referrals.ts attributeReferralFromCookie for where it's resolved and consumed. First
  // touch wins: skips if a referral cookie is already set, matching attributeReferralFromCookie's
  // own first-touch write (referred_by_user_id only set when null) so the cookie layer and the
  // DB layer never disagree.
  const ref = req.nextUrl.searchParams.get("ref");
  if (ref && !req.cookies.get(REFERRAL_COOKIE)) {
    const res = NextResponse.next();
    res.cookies.set(REFERRAL_COOKIE, ref.trim(), {
      httpOnly: true,
      sameSite: "lax",
      maxAge: REFERRAL_COOKIE_MAX_AGE_DAYS * 24 * 60 * 60,
      path: "/",
      domain: REFERRAL_COOKIE_DOMAIN,
    });
    return res;
  }

  return isPartnerHost ? withPartnerRefCookie(req, NextResponse.next()) : NextResponse.next();
});

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico|api).*)"],
};
