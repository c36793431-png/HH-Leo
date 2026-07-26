import { auth } from "@/lib/auth";
import { NextResponse } from "next/server";
import { isAdminUsersPanelEmail } from "@/lib/admin-users-panel";

export default auth((req) => {
  if (req.nextUrl.pathname.startsWith("/admin/users")) {
    if (!req.auth?.user) {
      return NextResponse.redirect(new URL("/login", req.nextUrl));
    }
    console.log("[admin/users] proxy check session.user.email =", JSON.stringify(req.auth.user.email));
    if (!isAdminUsersPanelEmail(req.auth.user.email)) {
      return new NextResponse("Forbidden", { status: 403 });
    }
    return;
  }
  if (req.nextUrl.pathname.startsWith("/admin")) {
    if (!req.auth?.user) {
      return NextResponse.redirect(new URL("/login", req.nextUrl));
    }
    if (req.auth.user.role !== "admin") {
      return new NextResponse("Forbidden", { status: 403 });
    }
  }
});

export const config = {
  matcher: ["/admin/:path*", "/dashboard/:path*"],
};
