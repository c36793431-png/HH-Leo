import Link from "next/link";
import { auth } from "@/lib/auth";
import { FeedNavToggle } from "@/components/feed/feed-nav-toggle";
import { listPendingRequestsForProvider, listActiveTrialsForProvider, listTiersForProvider } from "@/lib/feed-providers";
import { formatRelative } from "@/lib/format-time";
import { getBotLink } from "@/lib/telegram-bot-links";
import { FEEDS_BOT_KEY } from "@/lib/telegram-feeds-bot";
import { getActiveSubscriberCountForProvider } from "@/lib/feed-subscriptions";

const TYPE_ICON: Record<string, string> = { pending: "🧪", approved: "✓", rejected: "✗", provisioned: "💳" };

export default async function FeedOverviewPage() {
  const session = await auth();
  const providerId = session!.user!.id!;

  const [pending, trials, tiers, telegramLink, subscriberCount] = await Promise.all([
    listPendingRequestsForProvider(providerId),
    listActiveTrialsForProvider(providerId),
    listTiersForProvider(providerId),
    getBotLink(providerId, FEEDS_BOT_KEY),
    getActiveSubscriberCountForProvider(providerId),
  ]);

  const oldest = pending[pending.length - 1];

  return (
    <>
      <header className="fp-topbar">
        <FeedNavToggle />
        <div>
          <h1>Overview</h1>
          <div className="crumb">feed.horizonhft.com / overview</div>
        </div>
        <div className="sp" />
      </header>

      <section className="fp-content">
        {pending.length > 0 && (
          <div className="banner warn">
            <span className="bic">⚑</span>
            <div>
              <b>{pending.length} request{pending.length === 1 ? "" : "s"}</b> are waiting for your approval.
              Approving is one click and instantly activates the client.
            </div>
            <Link className="baction" href="/feed/dashboard/users">
              Review queue →
            </Link>
          </div>
        )}

        <div className="stats">
          <div className="stat">
            <div className="lab">
              <span className="si">◈</span> Tiers you manage
            </div>
            <div className="val">{tiers.length}</div>
            <div className="sub">
              <Link href="/feed/dashboard/tiers" style={{ color: "var(--pfp-cyan)", fontWeight: 600 }}>
                Manage →
              </Link>
            </div>
          </div>
          <div className="stat">
            <div className="lab">
              <span className="si">◎</span> Subscribers
            </div>
            <div className="val">{subscriberCount}</div>
            <div className="sub">trial + active, across your packages</div>
          </div>
          <div className={`stat${pending.length > 0 ? " hot" : ""}`}>
            <div className="lab">
              <span className="si">⚑</span> Pending approvals
            </div>
            <div className="val">{pending.length}</div>
            <div className="sub">
              {oldest ? (
                <>
                  oldest waiting · {formatRelative(oldest.createdAt)} ·{" "}
                  <Link href="/feed/dashboard/users" style={{ color: "var(--pfp-warn)", fontWeight: 600 }}>
                    Open →
                  </Link>
                </>
              ) : (
                "queue is clear"
              )}
            </div>
          </div>
          <div className="stat">
            <div className="lab">
              <span className="si">◉</span> Active trials
            </div>
            <div className="val">{trials.length}</div>
            <div className="sub">across your managed tiers</div>
          </div>
          <div className="stat">
            <div className="lab">
              <span className="si">◇</span> Feed health
            </div>
            <div className="val">
              — <small>no telemetry yet</small>
            </div>
            <div className="sub">
              <Link href="/feed/dashboard/health" style={{ color: "var(--pfp-cyan)", fontWeight: 600 }}>
                See Feed Health →
              </Link>
            </div>
          </div>
        </div>

        {!telegramLink && (
          <div className="banner info">
            <span className="bic">✈</span>
            <div>
              <b>Get notified on Telegram</b> — link your account to receive signups, trial requests, and payout
              alerts as DMs instead of checking back here.
            </div>
            <Link className="baction" href="/feed/dashboard/notifications">
              Link Telegram →
            </Link>
          </div>
        )}

        <div className="grid g2">
          <div className="card">
            <div className="chead">
              <span className="ic">✈</span>
              <h3>Recent activity</h3>
              <span className="cap">pending requests</span>
            </div>
            {pending.length === 0 ? (
              <div className="empty">
                <div className="eic">✓</div>
                <b>Nothing waiting</b>
                <p>New signups, trial requests, and paid subscriptions for your tiers will show up here.</p>
              </div>
            ) : (
              <div className="act">
                {pending.slice(0, 5).map((r) => (
                  <div className="ai" key={r.id}>
                    <div className="ic trial">{TYPE_ICON[r.status] ?? "🔔"}</div>
                    <div className="txt">
                      <b>
                        {r.userEmail ?? "unknown"} — {r.tierName}
                      </b>
                      <span>requested {formatRelative(r.createdAt)}</span>
                    </div>
                    <div className="tm">{formatRelative(r.createdAt)}</div>
                  </div>
                ))}
              </div>
            )}
          </div>

          <div className="card">
            <div className="chead">
              <span className="ic">▦</span>
              <h3>Revenue</h3>
              <span className="cap">placeholder</span>
            </div>
            <div className="scope-note">
              <span className="i">ⓘ</span>
              <span>
                No payment-ledger split exists for feed providers yet — this card will show your 50% share once
                that&apos;s wired up. See <Link href="/feed/dashboard/revenue">Revenue</Link> for the mockup preview.
              </span>
            </div>
          </div>
        </div>

        <div className="foot">HORIZON HFT · provider panel · Overview</div>
      </section>
    </>
  );
}
