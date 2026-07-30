import Link from "next/link";
import { redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import { isPaidUser, getLicenseForUser, computeLicenseDisplayStatus } from "@/lib/licenses";
import { getPortalConfig } from "@/lib/portal-config";
import { getLatestDownloads, type LatestDownloads } from "@/lib/downloads";
import { pool } from "@/lib/db";
import { getBotUsername } from "@/lib/telegram-bot";
import { createOnboardingToken } from "@/lib/telegram-onboarding";
import { LinkTelegramButton } from "@/components/link-telegram-button";
import { DownloadButton } from "@/components/download-button";
import { LicenseStatusCard } from "@/components/license-status-card";
import { PortalShell } from "@/components/portal/portal-shell";
import { isAdminUsersPanelEmail } from "@/lib/admin-users-panel";
import { humanizeTimeUntil } from "@/lib/format-time";

export default async function DashboardPage() {
  const session = await auth();
  if (!session?.user?.id) redirect("/login");

  const [paid, config, telegramStatus, groupMembershipStatus, botUsername, downloads] = await Promise.all([
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
        `select status from group_memberships where user_id = $1
         order by coalesce(joined_at, invited_at) desc limit 1`,
        [session.user.id]
      )
      .then((r): string | null => r.rows[0]?.status ?? null)
      .catch((): string | null => null),
    getBotUsername(),
    getLatestDownloads().catch((): LatestDownloads => ({})),
  ]);
  const { linked: telegramLinked, botStarted: telegramBotStarted } = telegramStatus;
  const onboarding =
    paid && telegramLinked && !telegramBotStarted
      ? await createOnboardingToken(session.user.id).catch(() => null)
      : null;
  const licenseDetail = await getLicenseForUser(session.user.id).catch(() => null);
  const isAdmin = isAdminUsersPanelEmail(session.user.email);
  const displayStatus = computeLicenseDisplayStatus(licenseDetail);
  const isExpired = displayStatus === "expired";
  const isExpiringSoon = displayStatus === "expiring";

  const tier = isAdmin ? "admin" : paid ? "paid" : "free";
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
            Expires in <b>{humanizeTimeUntil(licenseDetail!.expiresAt)}</b>. There&apos;s no auto-renewal —
            message us on Telegram to get a new license issued before it lapses.
          </div>
          <a className="baction" href={config.telegramChannelUrl} target="_blank" rel="noopener noreferrer">
            Renew via Telegram →
          </a>
        </div>
      )}

      {!paid && !isAdmin && (
        <div className="hero">
          <div className="eyebrow">Free tier</div>
          <h2>Unlock the full Horizon HFT terminal</h2>
          <p>{config.pricingDisplay}</p>
          <div className="row">
            <a className="btn primary" href={config.telegramChannelUrl} target="_blank" rel="noopener noreferrer">
              ⚡ Upgrade to Paid
            </a>
            <a className="btn ghost" href={config.telegramChannelUrl} target="_blank" rel="noopener noreferrer">
              See what&apos;s included
            </a>
            <span className="note">Licenses are issued manually · typically &lt; 1h</span>
          </div>
        </div>
      )}

      <div className="grid">
        <LicenseStatusCard
          license={licenseDetail}
          telegramChannelUrl={config.telegramChannelUrl}
          isAdminAccount={isAdmin}
          adminLabel={userName}
        />

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
                  <b>Market Chatter</b>
                  <span>Free group</span>
                </div>
                <span className="join-pill">Join</span>
              </a>
              {!unlocked && (
                <div className="rw lockedrow">
                  <div className="ricon">🔒</div>
                  <div className="rmeta">
                    <b>Paid Users Group</b>
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
                  <b>Paid Users Group</b>
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
                  <b>Paid Users Group</b>
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
                    <b>Paid Users Group</b>
                    {groupMembershipStatus === "joined" ? (
                      <span>✅ Joined · in group</span>
                    ) : groupMembershipStatus === "removed_on_lapse" ? (
                      <span>Removed — resubscribe to rejoin</span>
                    ) : (
                      <span>Linked · invite sent via Telegram</span>
                    )}
                  </div>
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
      </div>

      <div className="foot">HORIZON HFT · customer portal</div>
    </PortalShell>
  );
}
