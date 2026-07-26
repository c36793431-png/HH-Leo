import { auth } from "@/lib/auth";
import { NextResponse } from "next/server";
import { isAdminUsersPanelEmail } from "@/lib/admin-users-panel";

export default auth((req) => {
  if (req.nextUrl.pathname.startsWith("/admin")) {
    if (!req.auth?.user) {
      return NextResponse.redirect(new URL("/login", req.nextUrl));
    }
    if (!isAdminUsersPanelEmail(req.auth.user.email)) {
      return new NextResponse("Forbidden", { status: 403 });
    }
  }
});

export const config = {
  matcher: ["/admin/:path*", "/dashboard/:path*"],
};
