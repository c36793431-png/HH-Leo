import { redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import { isPaidUser, getLicenseForUser, computePortalTier } from "@/lib/licenses";
import { isAdminUser } from "@/lib/admin-users-panel";
import { getPortalConfig } from "@/lib/portal-config";
import { PortalShell } from "@/components/portal/portal-shell";
import { LockedLanding } from "@/components/portal/locked-landing";

export default async function PropFirmPage() {
  const session = await auth();
  if (!session?.user?.id) redirect("/login");

  const [paid, licenseDetail, config] = await Promise.all([
    isPaidUser(session.user.id).catch(() => false),
    getLicenseForUser(session.user.id).catch(() => null),
    getPortalConfig(),
  ]);
  const isAdmin = isAdminUser(session.user);
  const unlocked = paid || isAdmin;

  const tier = computePortalTier(isAdmin, licenseDetail);
  const userName = session.user.name ?? session.user.email ?? "trader";
  const userEmail = session.user.email ?? "";

  return (
    <PortalShell tier={tier} isAdmin={isAdmin} userName={userName} userEmail={userEmail}>
      <div className="grid">
        <div className="card full">
          <div className="chead">
            <span className="ic">▣</span>
            <h3>Prop Firm</h3>
          </div>
          {unlocked ? (
            <>
              <p style={{ fontWeight: 700, marginBottom: 8 }}>Prop Firm recommendations — coming soon</p>
              <p style={{ color: "var(--hz-ink-2)", fontSize: 13, lineHeight: 1.6 }}>
                Curated list of vetted prop firms that work well with Horizon HFT strategies.
              </p>
            </>
          ) : (
            <LockedLanding
              feature="Prop Firm"
              tease="A curated list of vetted prop firms that pair well with Horizon HFT strategies."
              telegramChannelUrl={config.telegramChannelUrl}
            />
          )}
        </div>
      </div>
    </PortalShell>
  );
}
