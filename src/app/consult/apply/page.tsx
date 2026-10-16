import { auth } from "@/lib/auth";
import { getReachablePanels } from "@/lib/user-roles";
import { isAdminUser } from "@/lib/admin-users-panel";
import { getActiveLicenseDetailsForUser, computePortalTierFromLicenses } from "@/lib/licenses";
import { CONSULTANT_APPLICATION_LIMITS } from "@/lib/consultant-applications";
import { PortalShell } from "@/components/portal/portal-shell";
import { Logo } from "@/components/logo";
import { ConsultApplyForm } from "@/components/consult/consult-apply-form";

/** The consultant application page: portal.horizonhft.com/consult/apply (spec p2 B) and the root of
 * consult.horizonhft.com (proxy.ts rewrite, lib/consult-host.ts). No sign-in needed; a signed-in visitor gets the
 * portal shell, as careers/page.tsx does. */
function ConsultApplyContent() {
  return (
    <div className="mx-auto max-w-2xl">
      <div className="mb-8">
        <div className="text-xs font-semibold tracking-[0.2em] text-cyan-400">CONSULTING</div>
        <h1 className="mt-2 text-3xl font-bold text-zinc-50">Consult with Horizon HFT</h1>
        <p className="mt-3 text-sm text-zinc-400">
          Apply to offer your expertise as a consultant through Horizon HFT. We review every application and reply by
          email.
        </p>
      </div>
      <ConsultApplyForm limits={CONSULTANT_APPLICATION_LIMITS} />
    </div>
  );
}

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
