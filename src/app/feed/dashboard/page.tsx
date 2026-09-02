import Link from "next/link";
import { auth } from "@/lib/auth";
import { FeedNavToggle } from "@/components/feed/feed-nav-toggle";
import { listPendingRequestsForProvider, listActiveTrialsForProvider, listTiersForProvider } from "@/lib/feed-providers";
import type { FeedTierRequestRow } from "@/lib/feed-tier-requests";
import { formatRelative } from "@/lib/format-time";
import { getBotLink } from "@/lib/telegram-bot-links";
import { FEEDS_BOT_KEY } from "@/lib/telegram-feeds-bot";
import { getActiveSubscriberCountForProvider } from "@/lib/feed-subscriptions";
import { packageLabelForTierKey } from "@/lib/feed-provider-packages";

const TYPE_ICON: Record<string, string> = { pending: "🧪", approved: "✓", rejected: "✗", provisioned: "💳" };

/** Collapses pending requests by (client, package) so a client requesting all of London
 * Base's three tiers in one sitting reads as one row, not three -- same defect Revenue and
 * the Feeds tab already had. Package membership comes from feed-provider-packages.ts, the
 * one shared source; this only aggregates requests by it, it doesn't redefine it. */
function groupActivityByClientPackage(rows: FeedTierRequestRow[]) {
  const groups = new Map<string, { key: string; userEmail: string | null; label: string; latest: Date }>();
  for (const r of rows) {
    const label = packageLabelForTierKey(r.tierKey) ?? r.tierName;
    const key = `${r.userId}::${label}`;
    const existing = groups.get(key);
    if (!existing) {
      groups.set(key, { key, userEmail: r.userEmail, label, latest: r.createdAt });
    } else if (r.createdAt > existing.latest) {
      existing.latest = r.createdAt;
    }
  }
  return Array.from(groups.values()).sort((a, b) => b.latest.getTime() - a.latest.getTime());
}

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
              <Link href="/feed/dashboard/feeds" style={{ color: "var(--pfp-cyan)", fontWeight: 600 }}>
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
                {groupActivityByClientPackage(pending)
                  .slice(0, 5)
                  .map((g) => (
                  <div className="ai" key={g.key}>
                    <div className="ic trial">{TYPE_ICON.pending}</div>
                    <div className="txt">
                      <b>
                        {g.userEmail ?? "unknown"} — {g.label}
                      </b>
                      <span>requested {formatRelative(g.latest)}</span>
                    </div>
                    <div className="tm">{formatRelative(g.latest)}</div>
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
