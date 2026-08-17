import { redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import { isPaidUser, getLicenseForUser, computePortalTier } from "@/lib/licenses";
import { isAdminUser } from "@/lib/admin-users-panel";
import { PortalShell } from "@/components/portal/portal-shell";
import { ServerRegistrationForm } from "@/components/account/server-registration-form";
import { getServerRegistration } from "@/lib/server-registration";
import { getBlackTrialForLicense } from "@/lib/black-trials";
import { getPortalConfig } from "@/lib/portal-config";
import { formatAbsoluteUtc } from "@/lib/format-time";
import { BlackTrialCard } from "@/components/account/black-trial-card";
import { saveServerRegistrationAction, requestBlackTrialAction, requestBlackTrialConvertAction } from "./actions";

export default async function ServersPage() {
  const session = await auth();
  if (!session?.user?.id) redirect("/login");

  const [paid, licenseDetail, config] = await Promise.all([
    isPaidUser(session.user.id).catch(() => false),
    getLicenseForUser(session.user.id).catch(() => null),
    getPortalConfig(),
  ]);
  const isAdmin = isAdminUser(session.user);
  const tier = computePortalTier(isAdmin, licenseDetail);
  const userName = session.user.name ?? session.user.email ?? "trader";
  const userEmail = session.user.email ?? "";
  const unlocked = paid || isAdmin;

  const registration = licenseDetail ? await getServerRegistration(licenseDetail.id).catch(() => null) : null;
  const blackTrial = licenseDetail ? await getBlackTrialForLicense(licenseDetail.id).catch(() => null) : null;

  return (
    <PortalShell tier={tier} isAdmin={isAdmin} userName={userName} userEmail={userEmail}>
      <div className="grid">
        <div className="card full">
          <div className="chead">
            <span className="ic">🖥</span>
            <h3>Server registration</h3>
          </div>
          {unlocked && licenseDetail ? (
            <>
              <p style={{ color: "var(--hz-ink-2)", fontSize: 13, marginBottom: 16 }}>
                Tell us where your Horizon client runs. We use this to whitelist your IP with feed
                vendors and confirm the location we already see server-side. You can edit this any
                time.
              </p>
              <ServerRegistrationForm action={saveServerRegistrationAction} value={registration} />
              {registration && (
                <p style={{ marginTop: 16, fontSize: 12, color: "var(--hz-ink-2)" }}>
                  Last updated {formatAbsoluteUtc(registration.updatedAt)}
                </p>
              )}
            </>
          ) : (
            <div className="empty">
              <div className="eic">🔒</div>
              <b>Server registration is available to Horizon HFT users.</b>
              <p>Get a license to register your trading server.</p>
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

        {unlocked && licenseDetail && registration && (
          <BlackTrialCard
            status={blackTrial?.status ?? "none"}
            expiresAt={blackTrial?.expiresAt ? blackTrial.expiresAt.toISOString() : null}
            endpoint={blackTrial?.endpoint ?? null}
            credentials={blackTrial?.credentials ?? null}
            requestAction={requestBlackTrialAction}
            convertAction={requestBlackTrialConvertAction}
          />
        )}
      </div>
    </PortalShell>
  );
}
