import Link from "next/link";
import { redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import { getOtherPanels } from "@/lib/user-roles";
import {
  isPaidUser,
  getActiveLicenseDetailsForUser,
  computeUserActiveFeeds,
  computePortalTierFromLicenses,
} from "@/lib/licenses";
import { getPortalConfig } from "@/lib/portal-config";
import { PortalShell } from "@/components/portal/portal-shell";
import { isAdminUser } from "@/lib/admin-users-panel";
import {
  FEED_CATALOGUE,
  COMING_SOON_CATALOGUE,
  computeFeedCardStatus,
  type FeedCardStatus,
} from "@/lib/feeds-catalogue";
import { regionForFeedType } from "@/lib/feed-tier-catalogue";
import { getTierCountsByRegion } from "@/lib/feed-tiers";
import { FeedRequestForm } from "@/components/feeds/feed-request-form";
import { getAnyServerRegistrationForUser } from "@/lib/server-registration";
import { ServerRegistrationBand } from "@/components/feeds/server-registration-band";

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
  const switchablePanels = getOtherPanels(session.user.roles, "portal");
  if (isAdminUser(session.user)) redirect("/admin/dashboard");

  const [paid, config, activeLicenses] = await Promise.all([
    isPaidUser(session.user.id).catch(() => false),
    getPortalConfig(),
    getActiveLicenseDetailsForUser(session.user.id).catch(() => []),
  ]);
  const activeFeeds = await computeUserActiveFeeds(session.user.id).catch(() => []);
  const isAdmin = isAdminUser(session.user);
  // Same aggregation drives the card status below and the sidebar badge (thread
  // multi-license-visibility-2026-08-31, marcus) — a paying client must never see "Trial" on a
  // feed, or a lower-tier sidebar badge, just because an older/newer license sorts differently.
  const { tier, hasOtherActiveTiers } = computePortalTierFromLicenses(isAdmin, activeLicenses);
  const bestLicenseTier = tier === "free" ? null : tier;
  const tierCounts = await getTierCountsByRegion().catch(() => ({} as Awaited<ReturnType<typeof getTierCountsByRegion>>));
  const serverRegistration = await getAnyServerRegistrationForUser(session.user.id).catch(() => null);
  const userName = session.user.name ?? session.user.email ?? "trader";
  const userEmail = session.user.email ?? "";

  return (
    <PortalShell tier={tier} isAdmin={isAdmin} userName={userName} userEmail={userEmail} hasOtherActiveTiers={hasOtherActiveTiers} switchablePanels={switchablePanels}>
      <div className="comm-head">
        <h1>Feeds</h1>
        <p>Every signal feed we run — what you have, what&apos;s included, and what&apos;s next.</p>
      </div>

      <div className="fp-grid">
        {FEED_CATALOGUE.map((entry) => {
          const status = computeFeedCardStatus(entry, {
            activeFeeds,
            licenseTier: bestLicenseTier,
            isAdmin,
          });
          // Furthest expiry among active licenses that actually grant this feed wins — that's
          // when this card's access really ends, not whichever license was issued last.
          const grantingLicense = entry.feedType
            ? activeLicenses.find((l) => l.feedTypes.includes(entry.feedType!))
            : undefined;
          const region = regionForFeedType(entry.feedType);
          const tierCount = region ? tierCounts[region] ?? 0 : 0;
          const hasTiers = tierCount > 1;
          const isActiveOrTrial = status === "active" || status === "trial";
          const seeTiersLink = hasTiers && region && (
            <Link href={`/feeds/${region}/tiers`} className="btn ghost sm fp-see-tiers">
              See tiers →
            </Link>
          );

          return (
            <div key={entry.slug} className={`card fp-card fp-${status}`}>
              <div className="fp-top">
                <span className="fp-flag-group">
                  <span
                    className={`fp-flag fi fi-${entry.countryCode.toLowerCase()}`}
                    role="img"
                    aria-label={`${entry.countryCode} flag`}
                  />
                  <span className="fp-code">{entry.countryCode}</span>
                </span>
                <span>
                  <span className={`fp-pill fp-pill-${status}`}>{STATUS_LABEL[status]}</span>
                  {hasTiers && <span className="fp-pill fp-pill-tiers">{tierCount} tiers</span>}
                </span>
              </div>
              <h3 className="fp-name">{entry.name}</h3>
              <p className="fp-desc">{entry.description}</p>
              <span className="fp-latency">{entry.latencyBand}</span>

              {(status === "active" || status === "trial") && grantingLicense && (
                <span className="fp-expiry">
                  {status === "trial" ? "Trial · expires " : "Active until "}
                  {grantingLicense.expiresAt.toLocaleDateString()}
                </span>
              )}

              {isActiveOrTrial && seeTiersLink}
              {(status === "active" || status === "trial") && (
                <a className="btn ghost sm fp-cta" href={config.telegramChannelUrl} target="_blank" rel="noopener noreferrer">
                  Manage via Telegram →
                </a>
              )}
              {(status === "active" || status === "trial") &&
                (entry.feedType === "futures" || entry.feedType === "crypto") &&
                (serverRegistration ? (
                  <ServerRegistrationBand registration={serverRegistration} />
                ) : (
                  <Link href="/account/servers" className="btn ghost sm fp-cta">
                    🖥 Register your server →
                  </Link>
                ))}
              {status === "included" && <span className="fp-note">Admin access</span>}
              {status === "locked" && !hasTiers && (
                <a className="btn primary sm fp-cta" href={config.telegramChannelUrl} target="_blank" rel="noopener noreferrer">
                  🔒 Upgrade to unlock
                </a>
              )}
              {status === "coming_soon" && <span className="fp-note">Planned — not live yet</span>}

              {!isActiveOrTrial && seeTiersLink}
            </div>
          );
        })}
      </div>

      {!paid && !isAdmin && (
        <p className="fp-footnote">
          Feeds are bundled with your license. Message us on Telegram to talk through which feeds fit your setup.
        </p>
      )}

      <div className="fp-section">
        <h2 className="fp-section-title">What&apos;s coming</h2>
        {COMING_SOON_CATALOGUE.length > 0 ? (
          <div className="fp-grid">
            {COMING_SOON_CATALOGUE.map((entry) => (
              <div key={entry.slug} className="card fp-card fp-coming_soon">
                <div className="fp-top">
                  <span className="fp-flag-group">
                    <span
                      className={`fp-flag fi fi-${entry.countryCode.toLowerCase()}`}
                      role="img"
                      aria-label={`${entry.countryCode} flag`}
                    />
                    <span className="fp-code">{entry.countryCode}</span>
                  </span>
                  <span className="fp-pill fp-pill-coming_soon">{STATUS_LABEL.coming_soon}</span>
                </div>
                <h3 className="fp-name">{entry.name}</h3>
                <p className="fp-desc">{entry.description}</p>
                <span className="fp-latency">{entry.latencyBand}</span>
                <span className="fp-note">Planned — not live yet</span>
              </div>
            ))}
          </div>
        ) : (
          <p className="fp-section-empty">Roadmap coming soon — check back for what&apos;s next.</p>
        )}
      </div>

      <div className="fp-ctas">
        <div className="card fp-cta-card">
          <h3 className="fp-cta-title">Request a feed</h3>
          <p className="fp-cta-copy">
            Need a feed we don&apos;t offer yet? Tell us what you need and we&apos;ll evaluate adding it.
          </p>
          <FeedRequestForm />
        </div>

        <div className="card fp-consult-card">
          <span className="fp-consult-badge">CONSULTING</span>
          <h3 className="fp-cta-title">Faster feed setup, done for you</h3>
          <p className="fp-cta-copy">
            We handle setup end-to-end: server, feed handler, distribution to your MT4/MT5/FIX endpoint, monitoring.
          </p>
          <a className="btn primary sm" href={config.telegramChannelUrl} target="_blank" rel="noopener noreferrer">
            Talk to us →
          </a>
        </div>
      </div>

      <div className="foot">HORIZON HFT · customer portal</div>
    </PortalShell>
  );
}
