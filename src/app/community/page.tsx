import { redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import { isPaidUser, getLicenseForUser, computePortalTier } from "@/lib/licenses";
import { getPortalConfig } from "@/lib/portal-config";
import { pool } from "@/lib/db";
import { getBotUsername, getChatMemberCount } from "@/lib/telegram-bot";
import { createOnboardingToken } from "@/lib/telegram-onboarding";
import { getHftAlertBotUsername } from "@/lib/telegram-hft-alert-bot";
import { createHftAlertOnboardingToken } from "@/lib/telegram-hft-alert-onboarding";
import { LinkTelegramButton } from "@/components/link-telegram-button";
import { RequestInviteButton } from "@/components/request-invite-button";
import { requestFreeGroupInviteAction } from "@/app/dashboard/actions";
import { PortalShell } from "@/components/portal/portal-shell";
import { isAdminUser } from "@/lib/admin-users-panel";

/** Public channels/supergroups accept "@username" as chat_id; invite-only chats need a
 * numeric chat_id the bot already knows (configured separately per chat). */
function publicUsernameFromUrl(url: string): string | null {
  const match = url.match(/^https?:\/\/t\.me\/([A-Za-z0-9_]+)$/);
  return match ? `@${match[1]}` : null;
}

function formatMemberCount(count: number | null): string | null {
  if (count === null) return null;
  if (count >= 1000) return `${(count / 1000).toFixed(count >= 10000 ? 0 : 1)}k members`;
  return `${count} member${count === 1 ? "" : "s"}`;
}

export default async function CommunityPage() {
  const session = await auth();
  if (!session?.user?.id) redirect("/login");
  if (isAdminUser(session.user)) redirect("/admin/dashboard");

  const [paid, licenseDetail, config, telegramStatus, groupMembershipStatus, freeGroupMembershipStatus, botUsername, hftAlertBotUsername] =
    await Promise.all([
      isPaidUser(session.user.id).catch(() => false),
      getLicenseForUser(session.user.id).catch(() => null),
      getPortalConfig(),
      pool
        .query<{ telegram_user_id: string | null; telegram_bot_started_at: Date | null; telegram_username: string | null }>(
          "select telegram_user_id, telegram_bot_started_at, telegram_username from users where id = $1",
          [session.user.id]
        )
        .then((r) => ({
          linked: r.rows[0]?.telegram_user_id !== null && r.rows[0]?.telegram_user_id !== undefined,
          botStarted: r.rows[0]?.telegram_bot_started_at != null,
          username: r.rows[0]?.telegram_username ?? null,
        }))
        .catch(() => ({ linked: false, botStarted: false, username: null })),
      pool
        .query<{ status: string }>(
          `select status from group_memberships where user_id = $1 and tier = 'paid'
         order by coalesce(joined_at, invited_at) desc limit 1`,
          [session.user.id]
        )
        .then((r): string | null => r.rows[0]?.status ?? null)
        .catch((): string | null => null),
      pool
        .query<{ status: string }>(
          `select status from group_memberships where user_id = $1 and tier = 'free'
         order by coalesce(joined_at, invited_at) desc limit 1`,
          [session.user.id]
        )
        .then((r): string | null => r.rows[0]?.status ?? null)
        .catch((): string | null => null),
      getBotUsername(),
      getHftAlertBotUsername(),
    ]);
  const { linked: telegramLinked, botStarted: telegramBotStarted, username: telegramUsername } = telegramStatus;
  const onboarding =
    telegramLinked && !telegramBotStarted
      ? await createOnboardingToken(session.user.id).catch(() => null)
      : null;
  const hftAlertOnboarding =
    paid && !telegramLinked && hftAlertBotUsername
      ? await createHftAlertOnboardingToken(session.user.id).catch(() => null)
      : null;

  const channelUsername = publicUsernameFromUrl(config.telegramChannelUrl);
  const paidGroupChatId = process.env.TELEGRAM_PAID_GROUP_CHAT_ID ?? null;
  const freeGroupChatId = process.env.TELEGRAM_FREE_GROUP_CHAT_ID ?? null;
  const [channelCount, paidCount, freeCount] = await Promise.all([
    channelUsername ? getChatMemberCount(channelUsername).catch(() => null) : Promise.resolve(null),
    paidGroupChatId ? getChatMemberCount(paidGroupChatId).catch(() => null) : Promise.resolve(null),
    freeGroupChatId ? getChatMemberCount(freeGroupChatId).catch(() => null) : Promise.resolve(null),
  ]);

  const userName = session.user.name ?? session.user.email ?? "trader";
  const userEmail = session.user.email ?? "";
  const tier = computePortalTier(false, licenseDetail);

  return (
    <PortalShell tier={tier} isAdmin={false} userName={userName} userEmail={userEmail}>
      <div className="comm-head">
        <h1>Community</h1>
        <p>Three ways to plug in — pick the one that fits what you&apos;re after.</p>
      </div>

      <div className="comm-stack">
        {/* CHANNEL */}
        <div className="card comm-card">
          <div className="comm-icon channel">📣</div>
          <div className="comm-body">
            <div className="comm-title-row">
              <h3>Horizon Announcements</h3>
              <span className="comm-tag">Channel · one-way</span>
            </div>
            <p className="comm-tagline">Official broadcasts — everyone welcome</p>
            <p className="comm-desc">
              Product updates, license drops, and market-moving alerts straight from the Horizon
              team. No chatter, no noise — just the announcements that actually matter, posted the
              moment they happen.
            </p>
            {formatMemberCount(channelCount) && <span className="comm-count">{formatMemberCount(channelCount)}</span>}
          </div>
          <a className="btn primary comm-cta" href={config.telegramChannelUrl} target="_blank" rel="noopener noreferrer">
            Join channel →
          </a>
        </div>

        {/* FREE GROUP */}
        <div className="card comm-card">
          <div className="comm-icon free">💬</div>
          <div className="comm-body">
            <div className="comm-title-row">
              <h3>Horizon Testers</h3>
              <span className="comm-tag">Free group · open chat</span>
            </div>
            {freeGroupMembershipStatus === "joined" ? (
              <p className="comm-desc">
                ✅ {telegramUsername ? `Member — @${telegramUsername}` : "In Horizon Testers"}
              </p>
            ) : (
              <>
                <p className="comm-tagline">Real-time discussion — free for everyone</p>
                <p className="comm-desc">
                  Trade ideas, market chatter, and community Q&amp;A with fellow Horizon traders. Open
                  to free and paid members alike — start the bot to get your invite.
                </p>
              </>
            )}
            {formatMemberCount(freeCount) && <span className="comm-count">{formatMemberCount(freeCount)}</span>}
          </div>

          {!telegramLinked ? (
            botUsername ? (
              <div className="comm-cta">
                <LinkTelegramButton botUsername={botUsername} />
              </div>
            ) : (
              <span className="comm-unavailable">Telegram linking unavailable — bot not configured.</span>
            )
          ) : !telegramBotStarted ? (
            onboarding ? (
              <a className="btn primary comm-cta" href={onboarding.link} target="_blank" rel="noopener noreferrer">
                Start the bot →
              </a>
            ) : (
              <span className="comm-unavailable">Telegram linking unavailable — bot not configured.</span>
            )
          ) : freeGroupMembershipStatus === "joined" ? (
            <span className="comm-linked-pill comm-cta">Joined</span>
          ) : freeGroupMembershipStatus === "removed_on_lapse" ? (
            <div className="comm-cta">
              <RequestInviteButton label="Start the bot again →" action={requestFreeGroupInviteAction} />
            </div>
          ) : (
            <div className="comm-cta">
              <RequestInviteButton label="Start the bot →" action={requestFreeGroupInviteAction} />
            </div>
          )}
        </div>

        {/* PAID GROUP */}
        <div className="card comm-card">
          <div className="comm-icon paid">⚡</div>
          <div className="comm-body">
            <div className="comm-title-row">
              <h3>Horizon Traders</h3>
              <span className="comm-tag paid">Paid group · subscribers only</span>
            </div>
            <p className="comm-tagline">Signals, desk support, bot-gated invite</p>
            {groupMembershipStatus === "joined" ? (
              <p className="comm-desc">
                ✅ {telegramUsername ? `Member — @${telegramUsername}` : "In Horizon Traders"}
              </p>
            ) : (
              <p className="comm-desc">
                Live signal drops, direct desk support, and the inner circle of active Horizon HFT
                subscribers. Access is tied to your license — start the bot to get your single-use
                invite.
              </p>
            )}
            {formatMemberCount(paidCount) && <span className="comm-count">{formatMemberCount(paidCount)}</span>}
          </div>

          {!paid ? (
            <a className="btn ghost comm-cta lockcta" href={config.telegramChannelUrl} target="_blank" rel="noopener noreferrer">
              🔒 Upgrade to join
            </a>
          ) : !telegramLinked ? (
            botUsername ? (
              <div className="comm-cta">
                <LinkTelegramButton botUsername={botUsername} />
              </div>
            ) : (
              <span className="comm-unavailable">Telegram linking unavailable — bot not configured.</span>
            )
          ) : !telegramBotStarted ? (
            onboarding ? (
              <a className="btn primary comm-cta" href={onboarding.link} target="_blank" rel="noopener noreferrer">
                Start the bot →
              </a>
            ) : (
              <span className="comm-unavailable">Telegram linking unavailable — bot not configured.</span>
            )
          ) : groupMembershipStatus === "joined" ? (
            <span className="comm-linked-pill comm-cta">Joined</span>
          ) : groupMembershipStatus === "removed_on_lapse" ? (
            <div className="comm-cta">
              <RequestInviteButton label="Start the bot again →" />
            </div>
          ) : (
            <div className="comm-cta">
              <RequestInviteButton label="Start the bot →" />
            </div>
          )}
        </div>

        {/* TRADING ALERTS */}
        <div className="card comm-card">
          <div className="comm-icon alerts">🔔</div>
          <div className="comm-body">
            <div className="comm-title-row">
              <h3>Trading Alerts</h3>
              <span className="comm-tag paid">Direct DM · subscribers only</span>
            </div>
            <p className="comm-tagline">Get real-time trade DMs from your Horizon client</p>
            {paid && telegramLinked ? (
              <p className="comm-desc">
                ✅ Linked to {telegramUsername ? `@${telegramUsername}` : "your Telegram"} — alerts active.
              </p>
            ) : (
              <p className="comm-desc">
                Every fill, close, and pnl update from your Horizon HFT client, DM&apos;d to you the moment it
                happens. Start the bot to link your account.
              </p>
            )}
          </div>

          {!paid ? (
            <a className="btn ghost comm-cta lockcta" href={config.telegramChannelUrl} target="_blank" rel="noopener noreferrer">
              🔒 Upgrade to join
            </a>
          ) : telegramLinked ? (
            <span className="comm-linked-pill comm-cta">Alerts active</span>
          ) : hftAlertOnboarding ? (
            <a className="btn primary comm-cta" href={hftAlertOnboarding.link} target="_blank" rel="noopener noreferrer">
              Start the bot →
            </a>
          ) : (
            <span className="comm-unavailable">Telegram alerts unavailable — bot not configured.</span>
          )}
        </div>
      </div>

      <div className="foot">HORIZON HFT · customer portal</div>
    </PortalShell>
  );
}
