import Link from "next/link";
import type { ReactNode } from "react";
import { Logo } from "@/components/logo";

/**
 * The frame of the marketplace for a signed-out visitor (coxwell via marcus, m55542/m55551). The
 * portal's own classes, so the cards and product pages render as they do signed in, but no sidebar:
 * PortalShell's sidebar is built from the account (name, email, tier), and a visitor has none.
 *
 * Server-only, and it takes no data but the Sign in link, so nothing about any account can reach
 * it. The link carries the page the visitor is on, so signing in returns them to it.
 *
 * The main site's header links here, so this header links back to it, from the logo and from a
 * text link (coxwell via marcus, m58346). Signed in, the logo stays the sidebar's /dashboard link.
 */
const MAIN_SITE_URL = "https://www.horizonhft.com";

export function PublicShell({ signInHref, children }: { signInHref: string; children: ReactNode }) {
  return (
    <div className="portal-shell public-shell">
      <div className="app">
        <main className="main">
          <header className="topbar">
            <Logo size="nav" href={MAIN_SITE_URL} />
            <div className="sp" />
            <a href={MAIN_SITE_URL} className="to-main">
              ← horizonhft.com
            </a>
            <Link href={signInHref} className="btn primary sm">
              Sign in
            </Link>
          </header>
          <section className="content">{children}</section>
        </main>
      </div>
    </div>
  );
}
