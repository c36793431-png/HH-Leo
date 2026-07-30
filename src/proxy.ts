import { auth } from "@/lib/auth";
import { NextResponse } from "next/server";
import { isAdminUsersPanelEmail } from "@/lib/admin-users-panel";
import { REFERRAL_COOKIE, REFERRAL_COOKIE_MAX_AGE_DAYS } from "@/lib/referrals";

export default auth((req) => {
  if (req.nextUrl.pathname.startsWith("/admin")) {
    if (!req.auth?.user) {
      return NextResponse.redirect(new URL("/login", req.nextUrl));
    }
    if (!isAdminUsersPanelEmail(req.auth.user.email)) {
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
  matcher: ["/admin/:path*", "/dashboard/:path*", "/signup", "/login"],
};
