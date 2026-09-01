import { redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import { getOtherPanels } from "@/lib/user-roles";
import { isPaidUser, getActiveLicenseDetailsForUser, computePortalTierFromLicenses } from "@/lib/licenses";
import { isAdminUser } from "@/lib/admin-users-panel";
import { getPortalConfig } from "@/lib/portal-config";
import { PortalShell } from "@/components/portal/portal-shell";
import { LockedLanding } from "@/components/portal/locked-landing";

export default async function PropFirmPage() {
  const session = await auth();
  if (!session?.user?.id) redirect("/login");
  const switchablePanels = getOtherPanels(session.user.roles, "portal");

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
            <span className="ic">▣</span>
            <h3>Prop Firm</h3>
          </div>
          {unlocked ? (
            <>
              <p style={{ fontWeight: 700, marginBottom: 8 }}>Personalized prop firm match</p>
              <p style={{ color: "var(--hz-ink-2)", fontSize: 13, lineHeight: 1.6 }}>
                Prop firm choice matters — payout terms, HFT rules, and backend execution vary
                widely. We help pick the right one based on your strategy, capital tier, and goals.
                Message{" "}
                <a href="https://t.me/coxwell2" target="_blank" rel="noopener noreferrer">
                  @coxwell2
                </a>{" "}
                on Telegram for a personalized recommendation.
              </p>
              <p style={{ color: "var(--hz-ink-3)", fontSize: 12, marginTop: 16 }}>Curated prop firm list coming soon.</p>
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
