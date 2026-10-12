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
import { UnlinkedServersCard } from "@/components/account/unlinked-servers-card";
import {
  getServerRegistration,
  getLatestConnectionIp,
  getUnlinkedServerRegistrationsForUser,
  UNLINKED_SERVER_CAP,
  type ServerRegistration,
} from "@/lib/server-registration";
import { getBlackTrialForUser } from "@/lib/black-trials";
import { getPortalConfig } from "@/lib/portal-config";
import { BlackTrialCard } from "@/components/account/black-trial-card";
import { blackAvailability } from "@/lib/marketplace-catalogue";
import {
  saveServerRegistrationAction,
  saveUserServerRegistrationAction,
  linkServerRegistrationAction,
  updateServerRegistrationAction,
  requestBlackTrialAction,
  requestBlackTrialConvertAction,
} from "./actions";

interface ServerCardProps {
  license: LicenseDetail;
  registration: ServerRegistration | null;
  verified: boolean;
  showLicenseLabel: boolean;
}

function ServerCard({ license, registration, verified, showLicenseLabel }: ServerCardProps) {
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
          <ServerRegistrationView registration={registration} action={updateServerRegistrationAction.bind(null, registration.id)} />
        ) : (
          <ServerRegistrationForm action={saveServerRegistrationAction.bind(null, license.id)} value={null} />
        )}
      </div>
    </div>
  );
}

/** Black trial is one-per-client now (coxwell, 2026-09-10), not one-per-license, so it gets a
 * single card scoped to the user -- not one repeated per license the way it was in the old
 * (pre-08-31) ungrouped layout. Bound to the first registered license as the FK target; which
 * license holds the row doesn't matter to the client, only that a registered server exists. */
function blackTrialCardProps(
  userTrial: Awaited<ReturnType<typeof getBlackTrialForUser>>,
  primaryLicenseId: string
) {
  const now = Date.now();
  const activeNotExpired = userTrial?.status === "active" && (!userTrial.expiresAt || userTrial.expiresAt.getTime() > now);

  if (userTrial?.status === "converted") {
    return { status: "converted" as const, expiresAt: null, spentAt: null, licenseId: userTrial.licenseId };
  }
  if (activeNotExpired) {
    return {
      status: "active" as const,
      expiresAt: userTrial!.expiresAt ? userTrial!.expiresAt.toISOString() : null,
      spentAt: null,
      licenseId: userTrial!.licenseId,
    };
  }
  if (userTrial?.status === "requested") {
    return { status: "requested" as const, expiresAt: null, spentAt: null, licenseId: userTrial.licenseId };
  }
  if (userTrial?.status === "active") {
    // Reaching here means activeNotExpired was false above -- naturally expired. Still a
    // permanent burn (the trial started), even though the eligibility check in
    // requestBlackTrial never does this date comparison itself (marcus, 2026-09-10).
    return {
      status: "spent" as const,
      expiresAt: null,
      spentAt: userTrial.expiresAt ? userTrial.expiresAt.toISOString() : null,
      licenseId: userTrial.licenseId,
    };
  }
  // declined, or no row at all -- neither burns the trial (marcus's 2026-09-10 correction: a
  // declined or abandoned request never started one), so both are eligible to request again.
  return {
    status: "none" as const,
    expiresAt: null,
    spentAt: null,
    licenseId: userTrial?.licenseId ?? primaryLicenseId,
  };
}

export default async function ServersPage() {
  const session = await auth();
  if (!session?.user?.id) redirect("/login");
  const switchablePanels = getReachablePanels(session.user.roles);

  const [paid, licenses, config, userTrial, unlinked] = await Promise.all([
    isPaidUser(session.user.id).catch(() => false),
    getActiveLicenseDetailsForUser(session.user.id).catch(() => []),
    getPortalConfig(),
    getBlackTrialForUser(session.user.id).catch(() => null),
    getUnlinkedServerRegistrationsForUser(session.user.id).catch(() => []),
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
          const latestIp = registration ? await getLatestConnectionIp(license.id).catch(() => null) : null;
          // Verified = the licence's most recent connection came from the declared IP. The IP
          // history behind it is admin-only (/admin/connections), not shown here (m59952).
          const verified = !!(registration && latestIp && latestIp === registration.declaredIp);
          return { license, registration, verified };
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
        registrationId: (registration as ServerRegistration).id,
        licenseId: license.id,
        licenseKey: license.licenseKey,
        registration: registration as ServerRegistration,
        verified,
        action: updateServerRegistrationAction.bind(null, (registration as ServerRegistration).id),
      }))
    : [];
  const availableCard = grouped ? cards.find((c) => !c.registration) : undefined;
  const addTarget = availableCard
    ? { licenseId: availableCard.license.id, action: saveServerRegistrationAction.bind(null, availableCard.license.id) }
    : null;

  const primaryLicenseId = registeredCards[0]?.license.id ?? null;
  const trialProps = primaryLicenseId ? blackTrialCardProps(userTrial, primaryLicenseId) : null;

  // Licence-less servers (marcus m65584). With no licence card they are the whole page, in the
  // same grouped view, editable; with licences they sit in their own card with "Use for
  // licence" for each licence that has no server yet.
  const unlinkedEntries: GroupedServerEntry[] = unlinked.map((registration) => ({
    registrationId: registration.id,
    licenseId: null,
    licenseKey: null,
    registration,
    verified: false,
    action: updateServerRegistrationAction.bind(null, registration.id),
  }));
  const spareLicenses = cards.filter((c) => !c.registration).map((c) => c.license);
  const unlinkedWithLinks = unlinked.map((registration) => ({
    registration,
    links: spareLicenses.map((license) => ({
      licenseKey: license.licenseKey,
      action: linkServerRegistrationAction.bind(null, registration.id, license.id),
    })),
  }));

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
            <ServerRegistrationsGrouped entries={groupedEntries} addTarget={addTarget} upgradeUrl={config.telegramChannelUrl} />
          </div>
          {trialProps && (
            <BlackTrialCard
              status={trialProps.status}
              expiresAt={trialProps.expiresAt}
              spentAt={trialProps.spentAt}
              endpoint={userTrial?.endpoint ?? null}
              credentials={userTrial?.credentials ?? null}
              requestAction={requestBlackTrialAction.bind(null, trialProps.licenseId)}
              convertAction={requestBlackTrialConvertAction.bind(null, trialProps.licenseId)}
              requestable={blackAvailability() === "available"}
            />
          )}
          {unlinkedWithLinks.length > 0 && <UnlinkedServersCard entries={unlinkedWithLinks} />}
        </div>
      ) : cards.length > 0 ? (
        cards.map(({ license, registration, verified }) => (
          <ServerCard
            key={license.id}
            license={license}
            registration={registration}
            verified={verified}
            showLicenseLabel={cards.length > 1}
          />
        ))
      ) : (
        // No licence: the tab is open anyway (coxwell via marcus m65488/m65584), so a client can
        // give us their server when they request a product. The rows are licence-less and unlock
        // nothing; that is said here rather than left for the client to infer.
        <div className="grid">
          <div className="card full">
            <div className="chead">
              <span className="ic">🖥</span>
              <h3>Server registration</h3>
            </div>
            <p style={{ color: "var(--hz-ink-2)", fontSize: 13, marginBottom: 16 }}>
              Tell us where your Horizon client runs. Registering a server doesn&apos;t switch anything on. Feeds need
              a licence and an approved request.
            </p>
            <ServerRegistrationsGrouped
              entries={unlinkedEntries}
              addTarget={
                unlinked.length < UNLINKED_SERVER_CAP ? { licenseId: null, action: saveUserServerRegistrationAction } : null
              }
              upgradeUrl={config.telegramChannelUrl}
              limitNote={`You can register up to ${UNLINKED_SERVER_CAP} servers without a licence. Edit one to change it.`}
            />
          </div>
        </div>
      )}
    </PortalShell>
  );
}
