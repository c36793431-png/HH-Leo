import { auth } from "@/lib/auth";
import { NextResponse } from "next/server";

export default auth((req) => {
  if (req.nextUrl.pathname.startsWith("/admin")) {
    if (req.auth?.user?.role !== "admin") {
      return NextResponse.redirect(new URL("/login", req.nextUrl));
    }
  }
});

export const config = {
  matcher: ["/admin/:path*", "/dashboard/:path*"],
};
