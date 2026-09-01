import { redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import { getReachablePanels } from "@/lib/user-roles";
import { isPaidUser, getActiveLicenseDetailsForUser, computePortalTierFromLicenses } from "@/lib/licenses";
import { getRecentAlertsForUser, countDistinctAlertLicenses } from "@/lib/trading-alerts";
import { RecentAlertsPanel } from "@/components/recent-alerts-panel";
import { PortalShell } from "@/components/portal/portal-shell";
import { isAdminUser } from "@/lib/admin-users-panel";

const FULL_HISTORY_LIMIT = 100;

export default async function AlertsPage() {
  const session = await auth();
  if (!session?.user?.id) redirect("/login");
  const switchablePanels = getReachablePanels(session.user.roles);

  const paid = await isPaidUser(session.user.id).catch(() => false);
  const isAdmin = isAdminUser(session.user);
  if (!paid && !isAdmin) redirect("/dashboard");

  const [activeLicenses, alerts, distinctAlertLicenses] = await Promise.all([
    getActiveLicenseDetailsForUser(session.user.id).catch(() => []),
    getRecentAlertsForUser(session.user.id, FULL_HISTORY_LIMIT).catch(() => []),
    countDistinctAlertLicenses(session.user.id).catch(() => 0),
  ]);

  const userName = session.user.name ?? session.user.email ?? "trader";
  const userEmail = session.user.email ?? "";
  const { tier, hasOtherActiveTiers } = computePortalTierFromLicenses(isAdmin, activeLicenses);

  return (
    <PortalShell tier={tier} isAdmin={isAdmin} userName={userName} userEmail={userEmail} hasOtherActiveTiers={hasOtherActiveTiers} switchablePanels={switchablePanels}>
      <RecentAlertsPanel
        alerts={alerts}
        showLicenseTag={distinctAlertLicenses > 1}
        emptyStateHref="/dashboard#community"
      />
      <div className="foot">HORIZON HFT · customer portal · last {FULL_HISTORY_LIMIT} alerts, 90-day retention</div>
    </PortalShell>
  );
}
