import { auth } from "@/lib/auth";
import { NextResponse, type NextRequest } from "next/server";
import { isAdminUser } from "@/lib/admin-users-panel";
import { REFERRAL_COOKIE, REFERRAL_COOKIE_MAX_AGE_DAYS } from "@/lib/referrals";
import { getActivePartnerReferralCode } from "@/lib/partners";

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
    // Feed-ops admin (provider applications review + register-provider) also lives here,
    // unrewritten, same /admin/* route files as portal.horizonhft.com
    // (decision_split_portal_admin_and_feed_admin_surfaces_2026-08-23).
    // Every other /admin/* route stays portal-only to avoid leaking unrelated admin surfaces.
    const ADMIN_FEED_ROUTE_PREFIXES = ["/admin/provider-applications", "/admin/register-provider"];
    const isAdminFeedRoute = ADMIN_FEED_ROUTE_PREFIXES.some((prefix) => pathname.startsWith(prefix));
    if (pathname.startsWith("/admin") && !isAdminFeedRoute) {
      return new NextResponse("Not Found", { status: 404 });
    }
    const isStaticAsset = /\.[a-zA-Z0-9]+$/.test(pathname);
    const passthrough =
      pathname === "/login" ||
      pathname === "/signup" ||
      pathname.startsWith("/feed") ||
      isAdminFeedRoute ||
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
  }

  // Captures ?ref=<code> on signup/login into a 30-day cookie, ahead of whichever auth path
  // (Telegram widget or email magic link) actually creates the users row — see
  // lib/referrals.ts attributeReferralFromCookie for where it's resolved and consumed.
  const ref = req.nextUrl.searchParams.get("ref");
  if (ref && (pathname === "/signup" || pathname === "/login")) {
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
