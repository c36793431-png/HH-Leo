import Link from "next/link";
import { redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import { getReachablePanels } from "@/lib/user-roles";
import { isPaidUser, getActiveLicenseDetailsForUser, computePortalTierFromLicenses, type LicenseDetail } from "@/lib/licenses";
import { isAdminUser } from "@/lib/admin-users-panel";
import { PortalShell } from "@/components/portal/portal-shell";
import { ServerRegistrationForm } from "@/components/account/server-registration-form";
import { ServerRegistrationView } from "@/components/account/server-registration-view";
import { ServerRegistrationsGrouped, type GroupedServerEntry } from "@/components/account/server-registrations-grouped";
import { getServerRegistration, getLatestConnectionIp, type ServerRegistration } from "@/lib/server-registration";
import { getBlackTrialForLicense, type BlackTrialRow } from "@/lib/black-trials";
import { getPortalConfig } from "@/lib/portal-config";
import { BlackTrialCard } from "@/components/account/black-trial-card";
import { saveServerRegistrationAction, requestBlackTrialAction, requestBlackTrialConvertAction } from "./actions";

interface ServerCardProps {
  license: LicenseDetail;
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
  const switchablePanels = getReachablePanels(session.user.roles);

  const [paid, licenses, config] = await Promise.all([
    isPaidUser(session.user.id).catch(() => false),
    getActiveLicenseDetailsForUser(session.user.id).catch(() => []),
    getPortalConfig(),
  ]);
  const isAdmin = isAdminUser(session.user);
  const { tier, hasOtherActiveTiers } = computePortalTierFromLicenses(isAdmin, licenses);
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

  // Grouped chrome renders at every count -- 0, 1, and 2+ -- with all four regions
  // always present (empty ones dashed, "No server registered here yet"). coxwell hit
  // n=1 in prod and asked why the other regions weren't there: his 08-29 instruction
  // ("New york can be visible but 0 added if not there and other locations also")
  // outranks the State 2 mockup that only covered n=0/n>=2. No per-count special case.
  const registeredCards = cards.filter((c) => c.registration);
  const grouped = cards.length > 0;

  const groupedEntries: GroupedServerEntry[] = grouped
    ? registeredCards.map(({ license, registration, verified }) => ({
        licenseId: license.id,
        licenseKey: license.licenseKey,
        registration: registration as ServerRegistration,
        verified,
        action: saveServerRegistrationAction.bind(null, license.id),
      }))
    : [];
  const availableCard = grouped ? cards.find((c) => !c.registration) : undefined;
  const addTarget = availableCard
    ? { licenseId: availableCard.license.id, action: saveServerRegistrationAction.bind(null, availableCard.license.id) }
    : null;

  return (
    <PortalShell tier={tier} isAdmin={isAdmin} userName={userName} userEmail={userEmail} hasOtherActiveTiers={hasOtherActiveTiers} switchablePanels={switchablePanels}>
      <Link href="/feeds" className="btn ghost sm" style={{ marginBottom: 12, display: "inline-block" }}>
        ← All feeds
      </Link>
      {grouped ? (
        <div className="grid">
          <div className="card full">
            <div className="chead">
              <span className="ic">🖥</span>
              <h3>Server registration</h3>
            </div>
            <p style={{ color: "var(--hz-ink-2)", fontSize: 13, marginBottom: 16 }}>
              Tell us where your Horizon client runs. Servers are grouped by location — expand a
              location to view or edit each machine.
            </p>
            <ServerRegistrationsGrouped entries={groupedEntries} addTarget={addTarget} />
          </div>
        </div>
      ) : cards.length > 0 ? (
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
