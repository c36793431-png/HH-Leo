import { auth } from "@/lib/auth";
import { getReachablePanels } from "@/lib/user-roles";
import { isAdminUser } from "@/lib/admin-users-panel";
import { getActiveLicenseDetailsForUser, computePortalTierFromLicenses } from "@/lib/licenses";
import { PortalShell } from "@/components/portal/portal-shell";
import { Logo } from "@/components/logo";
import { ConsultApplyContent } from "@/components/consult/consult-apply-content";

/** The consultant application page: the consult host's /consult/apply, and the portal's until S1b 308s it there
 * (lib/consult-host.ts). No sign-in needed; a signed-in visitor gets the portal shell, as careers/page.tsx does. The
 * consult home (/consult) renders the same content for a signed-out visitor. */
export default async function ConsultApplyPage() {
  const session = await auth();

  if (!session?.user?.id) {
    return (
      <>
        <header className="flex items-center px-6 py-5">
          <Logo size="nav" />
        </header>
        <main className="flex-1 px-4 pb-20 pt-6">
          <ConsultApplyContent />
        </main>
      </>
    );
  }

  const activeLicenses = await getActiveLicenseDetailsForUser(session.user.id).catch(() => []);
  const isAdmin = isAdminUser(session.user);
  const { tier, hasOtherActiveTiers } = computePortalTierFromLicenses(isAdmin, activeLicenses);
  const userName = session.user.name ?? session.user.email ?? "trader";
  const userEmail = session.user.email ?? "";
  const switchablePanels = getReachablePanels(session.user.roles);

  return (
    <PortalShell tier={tier} isAdmin={isAdmin} userName={userName} userEmail={userEmail} hasOtherActiveTiers={hasOtherActiveTiers} switchablePanels={switchablePanels}>
      <ConsultApplyContent />
      <div className="foot">HORIZON HFT · customer portal</div>
    </PortalShell>
  );
}
