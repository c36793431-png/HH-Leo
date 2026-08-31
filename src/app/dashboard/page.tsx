import Image from "next/image";
import Link from "next/link";
import { redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import {
  isPaidUser,
  getLicenseForUser,
  getActiveLicenseDetailsForUser,
  computeLicenseDisplayStatus,
  computeUserActiveFeeds,
  computePortalTier,
  FEED_TYPES,
  FEED_TYPE_META,
} from "@/lib/licenses";
import { FEED_CATALOGUE, computeFeedCardStatus } from "@/lib/feeds-catalogue";
import { countUserActiveServers } from "@/lib/server-registration";
import { regionForFeedType } from "@/lib/feed-tier-catalogue";
import { getTierCountsByRegion, getBestLatencyByRegion } from "@/lib/feed-tiers";
import { getPortalConfig } from "@/lib/portal-config";
import { getLatestDownloads, type LatestDownloads } from "@/lib/downloads";
import { pool } from "@/lib/db";
import { getBotUsername } from "@/lib/telegram-bot";
import { createOnboardingToken } from "@/lib/telegram-onboarding";
import { LinkTelegramButton } from "@/components/link-telegram-button";
import { RequestInviteButton } from "@/components/request-invite-button";
import { DownloadButton } from "@/components/download-button";
import { LicenseStatusCard } from "@/components/license-status-card";
import { RecentAlertsPanel } from "@/components/recent-alerts-panel";
import { PortalShell } from "@/components/portal/portal-shell";
import { isAdminUser } from "@/lib/admin-users-panel";
import { humanizeTimeUntil } from "@/lib/format-time";
import { getRecentAlertsForUser, countDistinctAlertLicenses } from "@/lib/trading-alerts";

const DASHBOARD_ALERTS_LIMIT = 10;

export default async function DashboardPage() {
  const session = await auth();
  if (!session?.user?.id) redirect("/login");
  if (isAdminUser(session.user)) redirect("/admin/dashboard");

  const [paid, config, telegramStatus, groupMembershipStatus, botUsername, downloads, feedTierCounts, feedBestLatency] =
    await Promise.all([
    isPaidUser(session.user.id).catch(() => false),
    getPortalConfig(),
    pool
      .query<{ telegram_user_id: string | null; telegram_bot_started_at: Date | null }>(
        "select telegram_user_id, telegram_bot_started_at from users where id = $1",
        [session.user.id]
      )
      .then((r) => ({
        linked: r.rows[0]?.telegram_user_id !== null && r.rows[0]?.telegram_user_id !== undefined,
        botStarted: r.rows[0]?.telegram_bot_started_at != null,
      }))
      .catch(() => ({ linked: false, botStarted: false })),
    pool
      .query<{ status: string }>(
        `select status from group_memberships where user_id = $1 and tier = 'paid'
         order by coalesce(joined_at, invited_at) desc limit 1`,
        [session.user.id]
      )
      .then((r): string | null => r.rows[0]?.status ?? null)
      .catch((): string | null => null),
    getBotUsername(),
    getLatestDownloads().catch((): LatestDownloads => ({})),
    getTierCountsByRegion().catch(() => ({}) as Awaited<ReturnType<typeof getTierCountsByRegion>>),
    getBestLatencyByRegion().catch(() => ({}) as Awaited<ReturnType<typeof getBestLatencyByRegion>>),
  ]);
  const { linked: telegramLinked, botStarted: telegramBotStarted } = telegramStatus;
  const onboarding =
    paid && telegramLinked && !telegramBotStarted
      ? await createOnboardingToken(session.user.id).catch(() => null)
      : null;
  const licenseDetail = await getLicenseForUser(session.user.id).catch(() => null);
  const activeLicenses = await getActiveLicenseDetailsForUser(session.user.id).catch(() => []);
  const [activeFeeds, activeServerCount] = await Promise.all([
    computeUserActiveFeeds(session.user.id).catch((): typeof FEED_TYPES => []),
    countUserActiveServers(session.user.id).catch(() => 0),
  ]);
  const isAdmin = isAdminUser(session.user);

  const feedCatalogueByType = new Map(FEED_CATALOGUE.map((entry) => [entry.feedType, entry]));
  const signalFeedCards = FEED_TYPES.map((feedType) => {
    const catalogueEntry = feedCatalogueByType.get(feedType);
    const meta = FEED_TYPE_META[feedType];
    const status = catalogueEntry
      ? computeFeedCardStatus(catalogueEntry, { activeFeeds, licenseTier: licenseDetail?.tier ?? null, isAdmin })
      : "locked";
    const region = regionForFeedType(feedType);
    const tierCount = region ? feedTierCounts[region] ?? 0 : 0;
    const hasTierCatalogue = tierCount >= 1;
    const hasDrillIn = tierCount > 1;
    const isOwned = status === "active" || status === "trial" || status === "included";

    const pill: { color: "green" | "cyan" | "red"; label: string } = isOwned
      ? { color: "green", label: "ACTIVE" }
      : hasTierCatalogue
        ? { color: "cyan", label: `${tierCount} TIER${tierCount === 1 ? "" : "S"}` }
        : { color: "red", label: "LOCKED" };

    const action =
      pill.color === "red"
        ? { label: "Upgrade →", href: config.telegramChannelUrl, external: true }
        : { label: "See tiers →", href: hasDrillIn && region ? `/feeds/${region}/tiers` : "/feeds", external: false };

    const bestLatency = region ? feedBestLatency[region] : undefined;
    const stat = bestLatency != null ? `${bestLatency}µs · ${meta.coloCode} co-lo` : `${meta.coloCode} co-lo`;

    return {
      feedType,
      name: meta.name,
      countryCode: catalogueEntry?.countryCode ?? "US",
      stat,
      pill,
      action,
    };
  });
  const [recentAlerts, distinctAlertLicenses] = await Promise.all([
    getRecentAlertsForUser(session.user.id, DASHBOARD_ALERTS_LIMIT).catch(() => []),
    countDistinctAlertLicenses(session.user.id).catch(() => 0),
  ]);
  // activeLicenses is ordered expires_at desc, issued_at desc — the last entry expires soonest.
  const soonestActiveLicense = activeLicenses.length > 0 ? activeLicenses[activeLicenses.length - 1] : null;
  const hasMultipleActiveLicenses = activeLicenses.length > 1;
  // "Expired"/"none"/"revoked" banners only apply when no other license is still granting access —
  // otherwise the latest-issued license (which getLicenseForUser tracks) can read expired/revoked
  // while a second, still-active license means the account isn't actually locked out.
  const isExpired = activeLicenses.length === 0 && computeLicenseDisplayStatus(licenseDetail) === "expired";
  const isExpiringSoon = soonestActiveLicense !== null && computeLicenseDisplayStatus(soonestActiveLicense) === "expiring";
  // getLicenseForUser tracks the most-recently-*issued* row, which can differ from the user's one
  // active license (e.g. a later license was issued and then revoked) — prefer the active one so the
  // single-license card never shows REVOKED/EXPIRED while real access still exists.
  const singleCardLicense = activeLicenses.length === 1 ? activeLicenses[0] : licenseDetail;

  const tier = computePortalTier(isAdmin, licenseDetail);
  const userName = session.user.name ?? session.user.email ?? "trader";
  const userEmail = session.user.email ?? "";
  // Admin bypass: Downloads/Education render unlocked regardless of license, same as `paid`.
  // Real-paid-only Telegram group invite flow below stays gated on `paid` — no license, no invite side effects.
  const unlocked = paid || isAdmin;

  return (
    <PortalShell tier={tier} isAdmin={isAdmin} userName={userName} userEmail={userEmail}>
      {isExpired && (
        <div className="banner grey">
          <span className="bic">⏱</span>
          <div>
            Your license <b>expired on {licenseDetail!.expiresAt.toLocaleDateString()}</b>. Renew via Telegram to
            restore full access.
          </div>
          <a className="baction" href={config.telegramChannelUrl} target="_blank" rel="noopener noreferrer">
            Renew →
          </a>
        </div>
      )}

      {isExpiringSoon && (
        <div className="banner warn">
          <span className="bic">⏳</span>
          <div>
            {hasMultipleActiveLicenses ? (
              <>
                Your <b>{soonestActiveLicense!.tier}</b> license{" "}
                <b>
                  {soonestActiveLicense!.licenseKey.split("-").slice(0, 2).join("-")} (HH{soonestActiveLicense!.licenseNumber})
                </b>{" "}
                expires in{" "}
                <b>{humanizeTimeUntil(soonestActiveLicense!.expiresAt)}</b>. There&apos;s no auto-renewal for this
                license — message us on Telegram to get it renewed before it lapses. Your other active license is
                unaffected.
              </>
            ) : (
              <>
                Expires in <b>{humanizeTimeUntil(soonestActiveLicense!.expiresAt)}</b>. There&apos;s no auto-renewal —
                message us on Telegram to get a new license issued before it lapses.
              </>
            )}
          </div>
          <a className="baction" href={config.telegramChannelUrl} target="_blank" rel="noopener noreferrer">
            Renew via Telegram →
          </a>
        </div>
      )}

      {!paid && !isAdmin && (
        <div className="hero">
          <div className="hero-content">
            <div className="eyebrow">Free tier</div>
            <h2>Unlock the full Horizon HFT terminal</h2>
            <p>{config.pricingDisplay}</p>
            <div className="row">
              <a className="btn primary" href={config.telegramChannelUrl} target="_blank" rel="noopener noreferrer">
                ⚡ Upgrade to Paid
              </a>
              <Link className="btn ghost" href="/whats-included">
                See what&apos;s included
              </Link>
              <span className="note">Licenses are issued manually · typically &lt; 1h</span>
            </div>
          </div>
          <div className="hero-image">
            <Image src="/hero-terminal-2x.png" alt="Horizon HFT terminal" width={340} height={210} priority />
          </div>
        </div>
      )}

      <div className="grid">
        {hasMultipleActiveLicenses ? (
          activeLicenses.map((license) => (
            <LicenseStatusCard
              key={license.id}
              license={license}
              telegramChannelUrl={config.telegramChannelUrl}
              isAdminAccount={isAdmin}
              adminLabel={userName}
              installedVersion={downloads.windows?.version ?? downloads.macos?.version ?? null}
            />
          ))
        ) : (
          <LicenseStatusCard
            license={singleCardLicense}
            telegramChannelUrl={config.telegramChannelUrl}
            isAdminAccount={isAdmin}
            adminLabel={userName}
            installedVersion={downloads.windows?.version ?? downloads.macos?.version ?? null}
          />
        )}

        <div className="card full">
          <div className="chead">
            <span className="ic">⚡</span>
            <h3>Activated</h3>
            <span className="cap">This account</span>
          </div>
          <div className="grid g2">
            <div className="sf-card act-tile">
              <span className="act-tile-label">
                Feeds — {activeFeeds.length} of {FEED_TYPES.length} active
              </span>
              {activeFeeds.length > 0 && (
                <div className="act-feed-list">
                  {activeFeeds.map((ft) => (
                    <span key={ft} className="act-feed-chip">
                      {FEED_TYPE_META[ft].name.replace(/ Feed$/, "")}
                    </span>
                  ))}
                </div>
              )}
            </div>
            <div className="sf-card act-tile">
              <span className="act-tile-label">Servers</span>
              <div>
                <b className="act-count">{activeServerCount}</b>
                <span className="act-count-label">Registered</span>
              </div>
            </div>
          </div>
        </div>

        <div className="card full" id="feeds">
          <div className="chead">
            <span className="ic">◇</span>
            <h3>Signal Feeds</h3>
            <span className="cap">{activeFeeds.length} of {FEED_TYPES.length} active</span>
          </div>
          <div className="feed-grid">
            {signalFeedCards.map((f) => (
              <div key={f.feedType} className="sf-card">
                <div className="sf-top">
                  <span className={`sf-flag fi fi-${f.countryCode.toLowerCase()}`} role="img" aria-label={`${f.countryCode} flag`} />
                  <b className="sf-name">{f.name.replace(/ Feed$/, "")}</b>
                  <span className={`sf-pill sf-pill-${f.pill.color}`}>● {f.pill.label}</span>
                </div>
                <span className="sf-stat">{f.stat}</span>
                {f.action.external ? (
                  <a className="sf-action" href={f.action.href} target="_blank" rel="noopener noreferrer">
                    {f.action.label}
                  </a>
                ) : (
                  <Link className="sf-action" href={f.action.href}>
                    {f.action.label}
                  </Link>
                )}
              </div>
            ))}
          </div>
        </div>

        {isAdmin && (
          <div className="card admincard full">
            <div className="chead">
              <span className="ic">🛡</span>
              <h3>Admin</h3>
              <span className="cap">v2 · Leo</span>
            </div>
            <div className="rows">
              <Link className="rw zinc" href="/admin/users">
                <div className="ricon">◱</div>
                <div className="rmeta">
                  <b>Users</b>
                  <span>Accounts, roles, Telegram links</span>
                </div>
                <span className="rcta">Open →</span>
              </Link>
              <Link className="rw zinc" href="/admin/licenses">
                <div className="ricon">⬡</div>
                <div className="rmeta">
                  <b>Licenses</b>
                  <span>Issue, extend, revoke keys</span>
                </div>
                <span className="rcta">Open →</span>
              </Link>
              <Link className="rw zinc" href="/admin/history">
                <div className="ricon">↻</div>
                <div className="rmeta">
                  <b>History</b>
                  <span>Audit log of admin actions</span>
                </div>
                <span className="rcta">Open →</span>
              </Link>
            </div>
          </div>
        )}

        <div className="grid g2 full" id="downloads">
          {/* DOWNLOADS */}
          <div className="card">
            <div className="chead">
              <span className="ic">▤</span>
              <h3>Downloads</h3>
              <span className="cap">{unlocked ? "Latest" : "Paid only"}</span>
            </div>
            {unlocked ? (
              <div className="rows">
                <div className="rw">
                  <div className="ricon">⤓</div>
                  <div className="rmeta">
                    <b>Horizon Terminal — Windows</b>
                    <span>
                      {downloads.windows
                        ? `v${downloads.windows.version} · SHA256 ${downloads.windows.sha256.slice(0, 8)}…`
                        : "Not yet published"}
                    </span>
                  </div>
                  {downloads.windows ? (
                    <DownloadButton version={downloads.windows.version} platform="windows" />
                  ) : (
                    <span className="ver">—</span>
                  )}
                </div>
                <div className="rw">
                  <div className="ricon">⤓</div>
                  <div className="rmeta">
                    <b>Horizon Terminal — macOS</b>
                    <span>
                      {downloads.macos
                        ? `v${downloads.macos.version} · SHA256 ${downloads.macos.sha256.slice(0, 8)}…`
                        : "Not yet published"}
                    </span>
                  </div>
                  {downloads.macos ? (
                    <DownloadButton version={downloads.macos.version} platform="macos" />
                  ) : (
                    <span className="ver">—</span>
                  )}
                </div>
                <Link className="rw" href="/downloads">
                  <div className="ricon">≡</div>
                  <div className="rmeta">
                    <b>Changelog &amp; history</b>
                    <span>Full version history</span>
                  </div>
                  <span className="rcta">Open →</span>
                </Link>
              </div>
            ) : (
              <div className="locked-preview">
                <div className="blurbg rows">
                  <div className="rw">
                    <div className="ricon">⤓</div>
                    <div className="rmeta">
                      <b>Horizon Terminal v4.2.1</b>
                      <span>Windows · macOS</span>
                    </div>
                  </div>
                  <div className="rw">
                    <div className="ricon">≡</div>
                    <div className="rmeta">
                      <b>Changelog</b>
                      <span>What&apos;s new</span>
                    </div>
                  </div>
                </div>
                <div className="veil">
                  <div className="lk">🔒</div>
                  <b>Installer locked</b>
                  <a className="up" href={config.telegramChannelUrl} target="_blank" rel="noopener noreferrer">
                    Upgrade to unlock →
                  </a>
                </div>
              </div>
            )}
          </div>

          {/* COMMUNITY */}
          <div className="card" id="community">
            <div className="chead">
              <span className="ic">◍</span>
              <h3>Community</h3>
            </div>
            <div className="rows">
              <a className="rw" href={config.telegramChannelUrl} target="_blank" rel="noopener noreferrer">
                <div className="ricon">#</div>
                <div className="rmeta">
                  <b>Horizon General</b>
                  <span>Open to all members</span>
                </div>
                <span className="join-pill">Join</span>
              </a>
              <a className="rw" href={config.communityGroupUrl} target="_blank" rel="noopener noreferrer">
                <div className="ricon">◔</div>
                <div className="rmeta">
                  <b>Horizon Testers</b>
                  <span>Free group</span>
                </div>
                <span className="join-pill">Join</span>
              </a>
              {!unlocked && (
                <div className="rw lockedrow">
                  <div className="ricon">🔒</div>
                  <div className="rmeta">
                    <b>Horizon Traders</b>
                    <span>Signals · desk support · Telegram</span>
                  </div>
                  <a className="lockcta" href={config.telegramChannelUrl} target="_blank" rel="noopener noreferrer">
                    🔒 Upgrade to join
                  </a>
                </div>
              )}
            </div>
            {paid && !telegramLinked && (
              <div className="tgcta">
                <div className="ricon" style={{ color: "var(--hz-cyan)" }}>
                  ✈
                </div>
                <div className="rmeta">
                  <b>Horizon Traders</b>
                  <span>Link your Telegram to get your invite</span>
                </div>
                {botUsername ? (
                  <LinkTelegramButton botUsername={botUsername} />
                ) : (
                  <span className="rmeta">
                    <span>Telegram linking unavailable — bot not configured.</span>
                  </span>
                )}
              </div>
            )}
            {paid && telegramLinked && !telegramBotStarted && (
              <div className="tgcta">
                <div className="ricon" style={{ color: "var(--hz-cyan)" }}>
                  ✈
                </div>
                <div className="rmeta">
                  <b>Horizon Traders</b>
                  <span>Start the bot to get your invite</span>
                </div>
                {onboarding ? (
                  <a
                    className="rcta"
                    href={onboarding.link}
                    target="_blank"
                    rel="noopener noreferrer"
                  >
                    Start the bot →
                  </a>
                ) : (
                  <span className="rmeta">
                    <span>Telegram linking unavailable — bot not configured.</span>
                  </span>
                )}
              </div>
            )}
            {paid && telegramLinked && telegramBotStarted && (
              <div className="rows">
                <div className="rw">
                  <div className="ricon">★</div>
                  <div className="rmeta">
                    <b>Horizon Traders</b>
                    {groupMembershipStatus === "joined" ? (
                      <span>In the group</span>
                    ) : groupMembershipStatus === "removed_on_lapse" ? (
                      <span>Access removed — renew to rejoin</span>
                    ) : (
                      <span>Ready to join</span>
                    )}
                  </div>
                  {groupMembershipStatus === "joined" ? (
                    <span className="join-pill">Active</span>
                  ) : groupMembershipStatus === "removed_on_lapse" ? (
                    <RequestInviteButton label="Start the bot again →" />
                  ) : (
                    <RequestInviteButton label="Start the bot →" />
                  )}
                </div>
              </div>
            )}
          </div>
        </div>

        {/* EDUCATION */}
        <div className="card full" id="education">
          <div className="chead">
            <span className="ic">◈</span>
            <h3>Education</h3>
            <span className="cap">{paid ? "Full catalogue" : undefined}</span>
          </div>
          <div className={paid ? "courses" : "courses two"}>
            {config.educationPreview.map((doc) => (
              <a className="course" href="#" key={doc.title}>
                <div className="tag free">● Free intro</div>
                <h4>{doc.title}</h4>
                <p>{doc.summary}</p>
              </a>
            ))}
          </div>
          {!paid && (
            <div className="locked-preview" style={{ marginTop: 12 }}>
              <div className="blurbg courses two">
                <div className="course">
                  <div className="tag">Advanced</div>
                  <h4>Signal Construction</h4>
                  <p>Building alpha from microstructure.</p>
                </div>
                <div className="course">
                  <div className="tag">Advanced</div>
                  <h4>Execution Tactics</h4>
                  <p>Minimising slippage at scale.</p>
                </div>
              </div>
              <div className="veil">
                <div className="lk">🔒</div>
                <b>2 advanced courses locked</b>
                <a className="up" href={config.telegramChannelUrl} target="_blank" rel="noopener noreferrer">
                  Upgrade to unlock →
                </a>
              </div>
            </div>
          )}
        </div>

        {unlocked && (
          <RecentAlertsPanel
            alerts={recentAlerts}
            showLicenseTag={distinctAlertLicenses > 1}
            viewAllHref="/alerts"
            emptyStateHref="#community"
          />
        )}

        {unlocked && (
          <div className="grid full">
            {/* DOWNLOAD HISTORY — empty state until per-user download tracking exists */}
            <div className="card">
              <div className="chead">
                <span className="ic">↧</span>
                <h3>Download history</h3>
              </div>
              <div className="empty">
                <div className="eic">▤</div>
                <b>No downloads yet</b>
                <p>Once you grab the terminal installer, your version history shows up here.</p>
              </div>
            </div>
          </div>
        )}
      </div>

      <div className="foot">HORIZON HFT · customer portal</div>
    </PortalShell>
  );
}
