import Link from "next/link";
import { redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import { isPaidUser, getActiveLicenseForUser, getLicenseForUser } from "@/lib/licenses";
import { getPortalConfig } from "@/lib/portal-config";
import { pool } from "@/lib/db";
import { getBotUsername } from "@/lib/telegram-bot";
import { LinkTelegramButton } from "@/components/link-telegram-button";
import { DownloadButton } from "@/components/download-button";
import { LicenseStatusCard } from "@/components/license-status-card";
import { PortalShell } from "@/components/portal/portal-shell";
import { isAdminUsersPanelEmail } from "@/lib/admin-users-panel";

const RENEWAL_WINDOW_MS = 7 * 24 * 60 * 60 * 1000;

function getRenewalState(paid: boolean, license: { expiresAt: Date } | null) {
  if (!paid || !license) return { renewsSoon: false, daysToExpiry: 0 };
  const msRemaining = license.expiresAt.getTime() - Date.now();
  return {
    renewsSoon: msRemaining < RENEWAL_WINDOW_MS,
    daysToExpiry: Math.max(0, Math.ceil(msRemaining / (24 * 60 * 60 * 1000))),
  };
}

export default async function DashboardPage() {
  const session = await auth();
  if (!session?.user?.id) redirect("/login");

  const [paid, config, telegramLinked, botUsername] = await Promise.all([
    isPaidUser(session.user.id).catch(() => false),
    getPortalConfig(),
    pool
      .query<{ telegram_user_id: string | null }>(
        "select telegram_user_id from users where id = $1",
        [session.user.id]
      )
      .then((r) => r.rows[0]?.telegram_user_id !== null && r.rows[0]?.telegram_user_id !== undefined)
      .catch(() => false),
    getBotUsername(),
  ]);
  const license = paid ? await getActiveLicenseForUser(session.user.id).catch(() => null) : null;
  const licenseDetail = await getLicenseForUser(session.user.id).catch(() => null);
  const isAdmin = isAdminUsersPanelEmail(session.user.email);
  const { renewsSoon, daysToExpiry } = getRenewalState(paid, license);
  const isExpired = !paid && licenseDetail !== null && licenseDetail.status !== "revoked";

  const tier = isAdmin ? "admin" : paid ? "paid" : "free";
  const userName = session.user.name ?? session.user.email ?? "trader";
  const userEmail = session.user.email ?? "";

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

      {paid && renewsSoon && (
        <div className="banner warn">
          <span className="bic">⏳</span>
          <div>
            Your license renews in <b>{daysToExpiry} day{daysToExpiry === 1 ? "" : "s"}</b>. Renew early over
            Telegram to avoid any interruption.
          </div>
          <a className="baction" href={config.telegramChannelUrl} target="_blank" rel="noopener noreferrer">
            Renew now →
          </a>
        </div>
      )}

      {!paid && (
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
        <LicenseStatusCard license={licenseDetail} telegramChannelUrl={config.telegramChannelUrl} isAdminAccount={isAdmin} />

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
              <span className="cap">{paid ? "Latest" : "Paid only"}</span>
            </div>
            {paid ? (
              <div className="rows">
                <div className="rw">
                  <div className="ricon">⤓</div>
                  <div className="rmeta">
                    <b>Horizon Terminal — Windows</b>
                    <span>SHA256 verified</span>
                  </div>
                  <span className="ver">{license?.licenseKey ? "Ready" : "—"}</span>
                </div>
                <div className="rw">
                  <div className="ricon">⤓</div>
                  <div className="rmeta">
                    <b>Horizon Terminal — macOS</b>
                    <span>Notarised</span>
                  </div>
                  <span className="ver">{license?.licenseKey ? "Ready" : "—"}</span>
                </div>
                <DownloadButton />
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
                <span className="rcta">Open →</span>
              </a>
              <a className="rw" href={config.communityGroupUrl} target="_blank" rel="noopener noreferrer">
                <div className="ricon">◔</div>
                <div className="rmeta">
                  <b>Market Chatter</b>
                  <span>Free group</span>
                </div>
                <span className="rcta">Open →</span>
              </a>
              {!paid && (
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
            {paid && telegramLinked && (
              <div className="rows">
                <div className="rw">
                  <div className="ricon">★</div>
                  <div className="rmeta">
                    <b>Paid Users Group</b>
                    <span>Linked · invite sent via Telegram</span>
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
