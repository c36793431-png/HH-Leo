import { redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import { getReachablePanels } from "@/lib/user-roles";
import { isPaidUser, getActiveLicenseDetailsForUser, computePortalTierFromLicenses } from "@/lib/licenses";
import { isAdminUser } from "@/lib/admin-users-panel";
import { getPortalConfig } from "@/lib/portal-config";
import { PortalShell } from "@/components/portal/portal-shell";
import { LockedLanding } from "@/components/portal/locked-landing";

export default async function AdvancedEducationPage() {
  const session = await auth();
  if (!session?.user?.id) redirect("/login");
  const switchablePanels = getReachablePanels(session.user.roles);

  const [paid, activeLicenses, config] = await Promise.all([
    isPaidUser(session.user.id).catch(() => false),
    getActiveLicenseDetailsForUser(session.user.id).catch(() => []),
    getPortalConfig(),
  ]);
  const isAdmin = isAdminUser(session.user);
  const unlocked = paid || isAdmin;

  const { tier, hasOtherActiveTiers } = computePortalTierFromLicenses(isAdmin, activeLicenses);
  const userName = session.user.name ?? session.user.email ?? "trader";
  const userEmail = session.user.email ?? "";

  return (
    <PortalShell tier={tier} isAdmin={isAdmin} userName={userName} userEmail={userEmail} hasOtherActiveTiers={hasOtherActiveTiers} switchablePanels={switchablePanels}>
      <div className="grid">
        <div className="card full">
          <div className="chead">
            <span className="ic">◈</span>
            <h3>Advanced Education</h3>
          </div>
          {unlocked ? (
            <>
              <p style={{ fontWeight: 700, marginBottom: 8 }}>Advanced Education — coming soon</p>
              <p style={{ color: "var(--hz-ink-2)", fontSize: 13, lineHeight: 1.6 }}>
                Deeper strategy walkthroughs, execution profile deep-dives, and tuning tutorials for
                licensed traders.
              </p>
            </>
          ) : (
            <LockedLanding
              feature="Advanced Education"
              tease="Deeper strategy walkthroughs and execution profile deep-dives for licensed traders."
              telegramChannelUrl={config.telegramChannelUrl}
            />
          )}
        </div>
      </div>
    </PortalShell>
  );
}
