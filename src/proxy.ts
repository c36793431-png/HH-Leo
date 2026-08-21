import { auth } from "@/lib/auth";
import { NextResponse } from "next/server";
import { isAdminUser } from "@/lib/admin-users-panel";
import { REFERRAL_COOKIE, REFERRAL_COOKIE_MAX_AGE_DAYS } from "@/lib/referrals";

const PARTNER_HOST = "partner.horizonhft.com";

export default auth((req) => {
  const host = req.headers.get("host") || "";
  const isPartnerHost = host === PARTNER_HOST || host.startsWith(`${PARTNER_HOST}:`);

  if (isPartnerHost) {
    // partner.horizonhft.com serves the partner dashboard, rewritten to
    // /partner internally so it lands at the domain root, not /partner/partner.
    // The admin partner-management view also lives here (same admin as portal.horizonhft.com),
    // but every other /admin/* route stays portal-only to avoid leaking unrelated admin surfaces.
    if (req.nextUrl.pathname.startsWith("/admin") && !req.nextUrl.pathname.startsWith("/admin/partners")) {
      return new NextResponse("Not Found", { status: 404 });
    }
    if (!req.nextUrl.pathname.startsWith("/partner") && !req.nextUrl.pathname.startsWith("/admin/partners")) {
      const url = req.nextUrl.clone();
      url.pathname = `/partner${req.nextUrl.pathname === "/" ? "" : req.nextUrl.pathname}`;
      return NextResponse.rewrite(url);
    }
  }

  if (req.nextUrl.pathname.startsWith("/admin")) {
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
  if (ref && (req.nextUrl.pathname === "/signup" || req.nextUrl.pathname === "/login")) {
    const res = NextResponse.next();
    res.cookies.set(REFERRAL_COOKIE, ref.trim(), {
      httpOnly: true,
      sameSite: "lax",
      maxAge: REFERRAL_COOKIE_MAX_AGE_DAYS * 24 * 60 * 60,
      path: "/",
    });
    return res;
  }
});

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico|api).*)"],
};
