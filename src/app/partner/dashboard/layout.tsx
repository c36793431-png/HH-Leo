import { redirect } from "next/navigation";
import { headers } from "next/headers";
import { auth } from "@/lib/auth";
import { isAdminUser, isPartnerUser } from "@/lib/admin-users-panel";
import { getPendingPartnerApplicationForUser } from "@/lib/partner-applications";
import { getOtherPanels } from "@/lib/user-roles";
import { SignOutButton } from "@/components/sign-out-button";
import { PartnerSidebar } from "@/components/partner/partner-sidebar";
import { PartnerNavToggle, PartnerNavScrim } from "@/components/partner/partner-nav-toggle";
import "./partner-dashboard.css";

const PARTNER_HOST = "partner.horizonhft.com";

/** Auth gate + amber sidebar shell for the partner self-service dashboard, split out from
 * the shared /partner wrapper so partner.horizonhft.com's root can render a public landing
 * page without requiring a session — see src/app/partner/page.tsx.
 *
 * Reskinned from the plain cyan/zinc box to the V3-amber chrome (brief
 * iris-partner-dashboard-design-2026-08-22, mockups/horizon-referral-partner/
 * partner-dashboard.html), then from that top-nav bar to a PartnerSidebar (bus thread
 * partner-sidebar-stage1-2026-09-01, marcus) once the panel grew a second page (Deals) --
 * PortalSidebar couldn't be reused (tier-coupled, hard-coded portal/feed nav arrays, no
 * partner concept), so this forks the same brand/WorkspaceSwitcher/nav/side-foot shape
 * FeedSidebar already forked for the provider panel. Stage 1 ships two nav items only
 * (Overview, Deals) -- see partner-sidebar.tsx for why the rest are left out entirely. */
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
  const isAdmin = isAdminUser(session.user);
  const otherPanels = getOtherPanels(session.user.roles, "partner");

  return (
    <div className="partner-dash">
      <div className="pd-backdrop" aria-hidden="true">
        <div className="glow" />
      </div>
      <PartnerNavScrim />
      <div className="pd-app">
        <PartnerSidebar
          partnerLabel={label}
          partnerEmail={session.user.email ?? null}
          isAdmin={isAdmin}
          otherPanels={otherPanels}
          signOutButton={<SignOutButton className="pd-signout" redirectTo="/" />}
        />
        <main className="pd-main">
          <PartnerNavToggle />
          <section className="pd-content">{children}</section>
        </main>
      </div>
    </div>
  );
}
