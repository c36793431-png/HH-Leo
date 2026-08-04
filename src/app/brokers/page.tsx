import { redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import { isPaidUser, getLicenseForUser, computePortalTier } from "@/lib/licenses";
import { isAdminUser } from "@/lib/admin-users-panel";
import { getPortalConfig } from "@/lib/portal-config";
import { PortalShell } from "@/components/portal/portal-shell";
import { LockedLanding } from "@/components/portal/locked-landing";

export default async function BrokersPage() {
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
            <span className="ic">◎</span>
            <h3>Brokers</h3>
          </div>
          {unlocked ? (
            <>
              <p style={{ fontWeight: 700, marginBottom: 8 }}>Personalized broker match</p>
              <p style={{ color: "var(--hz-ink-2)", fontSize: 13, lineHeight: 1.6 }}>
                Broker choice matters — we help pick the right one based on your strategy, region,
                and setup. Message{" "}
                <a href="https://t.me/coxwell2" target="_blank" rel="noopener noreferrer">
                  @coxwell2
                </a>{" "}
                on Telegram for a personalized recommendation.
              </p>
              <p style={{ color: "var(--hz-ink-3)", fontSize: 12, marginTop: 16 }}>Curated broker list coming soon.</p>
            </>
          ) : (
            <LockedLanding
              feature="Brokers"
              tease="Get a broker recommendation matched to your strategy, region, and setup."
              telegramChannelUrl={config.telegramChannelUrl}
            />
          )}
        </div>
      </div>
    </PortalShell>
  );
}
