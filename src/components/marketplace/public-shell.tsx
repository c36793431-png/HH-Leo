import type { ReactNode } from "react";
import { HubNav, type HubNavCurrent } from "@/components/marketplace/hub-nav";

/**
 * The frame of the marketplace for a signed-out visitor (coxwell via marcus, m55542/m55551). The
 * portal's own classes, so the cards and product pages render as they do signed in, but no sidebar:
 * PortalShell's sidebar is built from the account (name, email, tier), and a visitor has none.
 *
 * Server-only, and it takes no data but the Sign in link, so nothing about any account can reach
 * it. The link carries the page the visitor is on, so signing in returns them to it.
 *
 * The main site's header links here, so the header is the main site's own nav, pinned while the
 * page scrolls (coxwell via marcus, m58986); its logo and links go back to the main site. Signed
 * in, the logo stays the sidebar's /dashboard link.
 *
 * Also the frame of the signed-out Academy (m62822), with Education marked current in the nav.
 */
export function PublicShell({
  signInHref,
  current,
  children,
}: {
  signInHref: string;
  current?: HubNavCurrent;
  children: ReactNode;
}) {
  return (
    <div className="portal-shell public-shell">
      <div className="app">
        <main className="main">
          <HubNav signInHref={signInHref} current={current} />
          <section className="content">{children}</section>
        </main>
      </div>
    </div>
  );
}
