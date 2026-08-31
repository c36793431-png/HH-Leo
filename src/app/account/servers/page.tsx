import Link from "next/link";
import { redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import { isPaidUser, getLicenseForUser, getActiveLicensesForUser, computePortalTier, type ActiveLicense } from "@/lib/licenses";
import { isAdminUser } from "@/lib/admin-users-panel";
import { PortalShell } from "@/components/portal/portal-shell";
import { ServerRegistrationForm } from "@/components/account/server-registration-form";
import { ServerRegistrationView } from "@/components/account/server-registration-view";
import { getServerRegistration, getLatestConnectionIp, type ServerRegistration } from "@/lib/server-registration";
import { getBlackTrialForLicense, type BlackTrialRow } from "@/lib/black-trials";
import { getPortalConfig } from "@/lib/portal-config";
import { BlackTrialCard } from "@/components/account/black-trial-card";
import { saveServerRegistrationAction, requestBlackTrialAction, requestBlackTrialConvertAction } from "./actions";

interface ServerCardProps {
  license: ActiveLicense;
  registration: ServerRegistration | null;
  blackTrial: BlackTrialRow | null;
  verified: boolean;
  showLicenseLabel: boolean;
}

function ServerCard({ license, registration, blackTrial, verified, showLicenseLabel }: ServerCardProps) {
  return (
    <div className="grid">
      <div className="card full">
        <div className="chead">
          <span className="ic">🖥</span>
          <h3>Server registration{showLicenseLabel ? ` — ${license.licenseKey}` : ""}</h3>
          {registration && (
            <span className={`st ${verified ? "ver" : "reg"}`} style={{ marginLeft: "auto" }}>
              <span className="d" />
              {verified ? "Verified" : "Registered"}
            </span>
          )}
        </div>
        <p style={{ color: "var(--hz-ink-2)", fontSize: 13, marginBottom: 16 }}>
          Tell us where your Horizon client runs. We use this to whitelist your IP with feed
          vendors and confirm the location we already see server-side.
          {!registration && " You can edit this any time."}
        </p>
        {registration ? (
          <ServerRegistrationView registration={registration} action={saveServerRegistrationAction.bind(null, license.id)} />
        ) : (
          <ServerRegistrationForm action={saveServerRegistrationAction.bind(null, license.id)} value={null} />
        )}
      </div>

      {registration && (
        <BlackTrialCard
          status={blackTrial?.status ?? "none"}
          expiresAt={blackTrial?.expiresAt ? blackTrial.expiresAt.toISOString() : null}
          endpoint={blackTrial?.endpoint ?? null}
          credentials={blackTrial?.credentials ?? null}
          requestAction={requestBlackTrialAction.bind(null, license.id)}
          convertAction={requestBlackTrialConvertAction.bind(null, license.id)}
        />
      )}
    </div>
  );
}

export default async function ServersPage() {
  const session = await auth();
  if (!session?.user?.id) redirect("/login");

  const [paid, licenseDetail, licenses, config] = await Promise.all([
    isPaidUser(session.user.id).catch(() => false),
    getLicenseForUser(session.user.id).catch(() => null),
    getActiveLicensesForUser(session.user.id).catch(() => []),
    getPortalConfig(),
  ]);
  const isAdmin = isAdminUser(session.user);
  const tier = computePortalTier(isAdmin, licenseDetail);
  const userName = session.user.name ?? session.user.email ?? "trader";
  const userEmail = session.user.email ?? "";
  const unlocked = paid || isAdmin;

  const cards = unlocked
    ? await Promise.all(
        licenses.map(async (license) => {
          const registration = await getServerRegistration(license.id).catch(() => null);
          const blackTrial = await getBlackTrialForLicense(license.id).catch(() => null);
          const latestIp = registration ? await getLatestConnectionIp(license.id).catch(() => null) : null;
          const verified = !!(registration && latestIp && latestIp === registration.declaredIp);
          return { license, registration, blackTrial, verified };
        })
      )
    : [];

  return (
    <PortalShell tier={tier} isAdmin={isAdmin} userName={userName} userEmail={userEmail}>
      <Link href="/feeds" className="btn ghost sm" style={{ marginBottom: 12, display: "inline-block" }}>
        ← All feeds
      </Link>
      {cards.length > 0 ? (
        cards.map(({ license, registration, blackTrial, verified }) => (
          <ServerCard
            key={license.id}
            license={license}
            registration={registration}
            blackTrial={blackTrial}
            verified={verified}
            showLicenseLabel={cards.length > 1}
          />
        ))
      ) : (
        <div className="grid">
          <div className="card full">
            <div className="chead">
              <span className="ic">🖥</span>
              <h3>Server registration</h3>
            </div>
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
          </div>
        </div>
      )}
    </PortalShell>
  );
}
