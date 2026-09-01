import { redirect } from "next/navigation";
import { headers } from "next/headers";
import Image from "next/image";
import Link from "next/link";
import { auth } from "@/lib/auth";
import { isAdminUser, isPartnerUser } from "@/lib/admin-users-panel";
import { getPendingPartnerApplicationForUser } from "@/lib/partner-applications";
import { getOtherPanels } from "@/lib/user-roles";
import { SignOutButton } from "@/components/sign-out-button";
import "./partner-dashboard.css";

const PARTNER_HOST = "partner.horizonhft.com";

function initial(s: string): string {
  return s.trim().charAt(0).toUpperCase() || "?";
}

/** Auth gate + amber top-nav shell for the partner self-service dashboard, split out from
 * the shared /partner wrapper so partner.horizonhft.com's root can render a public landing
 * page without requiring a session — see src/app/partner/page.tsx.
 *
 * Reskinned from the plain cyan/zinc box to the V3-amber chrome (brief
 * iris-partner-dashboard-design-2026-08-22, mockups/horizon-referral-partner/
 * partner-dashboard.html) so landing -> login -> dashboard reads as one continuous amber
 * partner surface, matching partner-landing-v3's nav 1:1. */
export default async function PartnerDashboardLayout({ children }: { children: React.ReactNode }) {
  const session = await auth();
  if (!session?.user?.id) redirect("/login");
  if (!isPartnerUser(session.user) && !isAdminUser(session.user)) {
    // A signed-in user with a pending partner application gets a distinct "under review"
    // message instead of being bounced straight to the landing page (leo-partner-page-
    // broken-auth-buttons-2026-08-22). Reuses /partner/apply's own confirmation UI rather
    // than a whole new route -- see that page's ?status=pending branch.
    const pendingApplication = await getPendingPartnerApplicationForUser(
      session.user.id,
      session.user.email ?? null
    );
    if (pendingApplication) redirect("/partner/apply?status=pending");

    // On partner.horizonhft.com, proxy.ts rewrites every non-/partner path (including
    // /dashboard) into this tree, so redirecting a non-partner user to "/dashboard" here
    // would just loop back through the same gate. Send them to the apply page with an
    // explanatory banner instead of a silent bounce to "/" (leo-partner-page-broken-
    // auth-buttons-2026-08-22, bug 2). On portal.horizonhft.com (reached by visiting
    // /partner directly, unrewritten) "/dashboard" is their real destination, unchanged.
    const host = (await headers()).get("host") || "";
    const isPartnerHost = host === PARTNER_HOST || host.startsWith(`${PARTNER_HOST}:`);
    redirect(isPartnerHost ? "/partner/apply?status=not-a-partner" : "/dashboard");
  }

  const label = session.user.name?.trim() || session.user.email?.trim() || "Partner";
  const otherPanels = getOtherPanels(session.user.roles, "partner");

  return (
    <div className="partner-dash">
      <div className="pd-backdrop" aria-hidden="true">
        <div className="glow" />
      </div>
      <div className="pd-wrap">
        <nav className="pd-nav">
          <Link className="pd-brand" href="/">
            <span className="glyph">
              <Image src="/brand/horizon-logo-partner.png" alt="Horizon HFT" width={42} height={42} priority />
            </span>
            <span className="txt">
              HORIZON
              <small>HFT · PARTNER PROGRAM</small>
            </span>
          </Link>
          <span className="sp" />
          <div className="pd-nav-acct">
            {otherPanels.length > 0 && (
              <div className="pd-panel-switch" role="group" aria-label="Switch panel">
                {otherPanels.map((panel) => (
                  <a key={panel.key} className="pd-panel-switch-link" href={panel.href}>
                    <span className="label">{panel.label}</span>
                    <span className="arrow" aria-hidden="true">↗</span>
                  </a>
                ))}
              </div>
            )}
            <div className="pd-acct-chip">
              <span className="av">{initial(label)}</span>
              <span className="who">
                <b>{label}</b>
                <span className="tag">Partner</span>
              </span>
            </div>
            <SignOutButton className="pd-signout" redirectTo="/" />
          </div>
        </nav>
        <main className="pd-main">
          <section className="pd-content">{children}</section>
        </main>
      </div>
    </div>
  );
}
