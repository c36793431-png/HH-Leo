import { redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import { isPaidUser, getLicenseForUser, computePortalTier } from "@/lib/licenses";
import { getPortalConfig } from "@/lib/portal-config";
import { pool } from "@/lib/db";
import { getBotUsername, getChatMemberCount } from "@/lib/telegram-bot";
import { createOnboardingToken } from "@/lib/telegram-onboarding";
import { LinkTelegramButton } from "@/components/link-telegram-button";
import { RequestInviteButton } from "@/components/request-invite-button";
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

  const [paid, licenseDetail, config, telegramStatus, groupMembershipStatus, botUsername] = await Promise.all([
    isPaidUser(session.user.id).catch(() => false),
    getLicenseForUser(session.user.id).catch(() => null),
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
  ]);
  const { linked: telegramLinked, botStarted: telegramBotStarted } = telegramStatus;
  const onboarding =
    paid && telegramLinked && !telegramBotStarted
      ? await createOnboardingToken(session.user.id).catch(() => null)
      : null;

  const channelUsername = publicUsernameFromUrl(config.telegramChannelUrl);
  const paidGroupChatId = process.env.TELEGRAM_PAID_GROUP_CHAT_ID ?? null;
  const [channelCount, paidCount] = await Promise.all([
    channelUsername ? getChatMemberCount(channelUsername).catch(() => null) : Promise.resolve(null),
    paidGroupChatId ? getChatMemberCount(paidGroupChatId).catch(() => null) : Promise.resolve(null),
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
              <h3>Market Chatter</h3>
              <span className="comm-tag">Free group · open chat</span>
            </div>
            <p className="comm-tagline">Real-time discussion — free for everyone</p>
            <p className="comm-desc">
              Trade ideas, market chatter, and community Q&amp;A with fellow Horizon traders. Open
              to free and paid members alike — jump in, ask questions, compare notes.
            </p>
          </div>
          <a className="btn primary comm-cta" href={config.communityGroupUrl} target="_blank" rel="noopener noreferrer">
            Join group →
          </a>
        </div>

        {/* PAID GROUP */}
        <div className="card comm-card">
          <div className="comm-icon paid">⚡</div>
          <div className="comm-body">
            <div className="comm-title-row">
              <h3>HH-Traders</h3>
              <span className="comm-tag paid">Paid group · subscribers only</span>
            </div>
            <p className="comm-tagline">Signals, desk support, bot-gated invite</p>
            <p className="comm-desc">
              Live signal drops, direct desk support, and the inner circle of active Horizon HFT
              subscribers. Access is tied to your license — start the bot to get your single-use
              invite.
            </p>
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
            <span className="join-pill comm-cta">Active</span>
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
      </div>

      <div className="foot">HORIZON HFT · customer portal</div>
    </PortalShell>
  );
}
