import { redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import { isPaidUser, getLicenseForUser, computePortalTier } from "@/lib/licenses";
import { isAdminUser } from "@/lib/admin-users-panel";
import { PortalShell } from "@/components/portal/portal-shell";
import { ConfigSummaryForm } from "@/components/admin/config-summary-form";
import { getConfigSummary } from "@/lib/config-summary";
import { getPortalConfig } from "@/lib/portal-config";
import { formatAbsoluteUtc } from "@/lib/format-time";
import { saveMyConfigSummaryAction, deleteMyConfigSummaryAction } from "./actions";

export default async function MySetupPage() {
  const session = await auth();
  if (!session?.user?.id) redirect("/login");

  const [paid, licenseDetail, configSummary, config] = await Promise.all([
    isPaidUser(session.user.id).catch(() => false),
    getLicenseForUser(session.user.id).catch(() => null),
    getConfigSummary(session.user.id),
    getPortalConfig(),
  ]);
  const isAdmin = isAdminUser(session.user);

  const tier = computePortalTier(isAdmin, licenseDetail);
  const userName = session.user.name ?? session.user.email ?? "trader";
  const userEmail = session.user.email ?? "";
  const unlocked = paid || isAdmin;

  return (
    <PortalShell tier={tier} isAdmin={isAdmin} userName={userName} userEmail={userEmail}>
      <div className="grid">
        <div className="card full">
          <div className="chead">
            <span className="ic">⚙</span>
            <h3>My setup</h3>
          </div>
          {unlocked ? (
            <>
              <p style={{ color: "var(--hz-ink-2)", fontSize: 13, marginBottom: 16 }}>
                Share your Horizon setup with us. This helps us support you faster and helps other
                traders benefit from what works. You can edit or clear this any time — we never
                collect it silently.
              </p>
              <ConfigSummaryForm
                action={saveMyConfigSummaryAction}
                userId={session.user.id}
                value={configSummary}
                deleteAction={configSummary ? deleteMyConfigSummaryAction : undefined}
                savedMessage="Your setup was saved"
              />
              {configSummary && (
                <p style={{ marginTop: 16, fontSize: 12, color: "var(--hz-ink-2)" }}>
                  Last updated by {configSummary.updatedByEmail ?? "you"} on{" "}
                  {formatAbsoluteUtc(configSummary.updatedAt)} —{" "}
                  {configSummary.source === "admin_verified" ? "admin-verified" : "self-reported"}
                </p>
              )}
            </>
          ) : (
            <div className="empty">
              <div className="eic">🔒</div>
              <b>My Setup is available to Horizon HFT users.</b>
              <p>Get a license to save and share your Horizon config with support and the team.</p>
              <a
                className="btn primary sm"
                href={config.telegramChannelUrl}
                target="_blank"
                rel="noopener noreferrer"
                style={{ marginTop: 12 }}
              >
                ⚡ Upgrade to Paid
              </a>
            </div>
          )}
        </div>
      </div>
    </PortalShell>
  );
}
