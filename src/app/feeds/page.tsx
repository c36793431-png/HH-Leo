import { redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import { isPaidUser, getLicenseForUser, computeUserActiveFeeds, computePortalTier } from "@/lib/licenses";
import { getPortalConfig } from "@/lib/portal-config";
import { PortalShell } from "@/components/portal/portal-shell";
import { isAdminUser } from "@/lib/admin-users-panel";
import { FEED_CATALOGUE, computeFeedCardStatus, type FeedCardStatus } from "@/lib/feeds-catalogue";

const STATUS_LABEL: Record<FeedCardStatus, string> = {
  active: "Active",
  trial: "Trial",
  included: "Included",
  locked: "Locked",
  coming_soon: "Coming soon",
};

export default async function FeedsPage() {
  const session = await auth();
  if (!session?.user?.id) redirect("/login");
  if (isAdminUser(session.user)) redirect("/admin/dashboard");

  const [paid, licenseDetail, config] = await Promise.all([
    isPaidUser(session.user.id).catch(() => false),
    getLicenseForUser(session.user.id).catch(() => null),
    getPortalConfig(),
  ]);
  const activeFeeds = await computeUserActiveFeeds(session.user.id).catch(() => []);
  const isAdmin = isAdminUser(session.user);
  const tier = computePortalTier(isAdmin, licenseDetail);
  const userName = session.user.name ?? session.user.email ?? "trader";
  const userEmail = session.user.email ?? "";

  return (
    <PortalShell tier={tier} isAdmin={isAdmin} userName={userName} userEmail={userEmail}>
      <div className="comm-head">
        <h1>Feeds</h1>
        <p>Every signal feed we run — what you have, what&apos;s included, and what&apos;s next.</p>
      </div>

      <div className="fp-grid">
        {FEED_CATALOGUE.map((entry) => {
          const status = computeFeedCardStatus(entry, {
            activeFeeds,
            licenseTier: licenseDetail?.tier ?? null,
            isAdmin,
          });

          return (
            <div key={entry.slug} className={`card fp-card fp-${status}`}>
              <div className="fp-top">
                <span className="fp-flag">{entry.countryFlag}</span>
                <span className={`fp-pill fp-pill-${status}`}>{STATUS_LABEL[status]}</span>
              </div>
              <h3 className="fp-name">{entry.name}</h3>
              <p className="fp-desc">{entry.description}</p>
              <span className="fp-latency">{entry.latencyBand}</span>

              {(status === "active" || status === "trial") && licenseDetail && (
                <span className="fp-expiry">
                  {status === "trial" ? "Trial · expires " : "Active until "}
                  {licenseDetail.expiresAt.toLocaleDateString()}
                </span>
              )}

              {(status === "active" || status === "trial") && (
                <a className="btn ghost sm fp-cta" href={config.telegramChannelUrl} target="_blank" rel="noopener noreferrer">
                  Manage via Telegram →
                </a>
              )}
              {status === "included" && <span className="fp-note">Admin access</span>}
              {status === "locked" && (
                <a className="btn primary sm fp-cta" href={config.telegramChannelUrl} target="_blank" rel="noopener noreferrer">
                  🔒 Upgrade to unlock
                </a>
              )}
              {status === "coming_soon" && <span className="fp-note">Planned — not live yet</span>}
            </div>
          );
        })}
      </div>

      {!paid && !isAdmin && (
        <p className="fp-footnote">
          Feeds are bundled with your license. Message us on Telegram to talk through which feeds fit your setup.
        </p>
      )}

      <div className="foot">HORIZON HFT · customer portal</div>
    </PortalShell>
  );
}
