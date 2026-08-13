import { redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import { isPaidUser, getLicenseForUser, computePortalTier } from "@/lib/licenses";
import { getRecentAlertsForUser, countDistinctAlertLicenses } from "@/lib/trading-alerts";
import { RecentAlertsPanel } from "@/components/recent-alerts-panel";
import { PortalShell } from "@/components/portal/portal-shell";
import { isAdminUser } from "@/lib/admin-users-panel";

const FULL_HISTORY_LIMIT = 100;

export default async function AlertsPage() {
  const session = await auth();
  if (!session?.user?.id) redirect("/login");

  const paid = await isPaidUser(session.user.id).catch(() => false);
  const isAdmin = isAdminUser(session.user);
  if (!paid && !isAdmin) redirect("/dashboard");

  const [licenseDetail, alerts, distinctAlertLicenses] = await Promise.all([
    getLicenseForUser(session.user.id).catch(() => null),
    getRecentAlertsForUser(session.user.id, FULL_HISTORY_LIMIT).catch(() => []),
    countDistinctAlertLicenses(session.user.id).catch(() => 0),
  ]);

  const userName = session.user.name ?? session.user.email ?? "trader";
  const userEmail = session.user.email ?? "";
  const tier = computePortalTier(isAdmin, licenseDetail);

  return (
    <PortalShell tier={tier} isAdmin={isAdmin} userName={userName} userEmail={userEmail}>
      <RecentAlertsPanel
        alerts={alerts}
        showLicenseTag={distinctAlertLicenses > 1}
        emptyStateHref="/dashboard#community"
      />
      <div className="foot">HORIZON HFT · customer portal · last {FULL_HISTORY_LIMIT} alerts, 90-day retention</div>
    </PortalShell>
  );
}
