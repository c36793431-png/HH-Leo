import Link from "next/link";
import { auth } from "@/lib/auth";
import { FeedNavToggle } from "@/components/feed/feed-nav-toggle";
import { listPendingRequestsForProvider, listActiveTrialsForProvider, listTiersForProvider } from "@/lib/feed-providers";
import type { FeedTierRequestRow } from "@/lib/feed-tier-requests";
import { formatRelative } from "@/lib/format-time";
import { getBotLink } from "@/lib/telegram-bot-links";
import { FEEDS_BOT_KEY } from "@/lib/telegram-feeds-bot";
import { getActiveSubscriberCountForProvider, getProviderRevenueSummary } from "@/lib/feed-subscriptions";
import { packageLabelForTierKey, moneyOrUnpriced } from "@/lib/feed-provider-packages";

/** How many months of History the card carries. Three is what fits without the card turning into
 * a table; the Revenue page's History view is the full list and the card links to it. */
const MONTHS_ON_CARD = 3;

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

  const [pending, trials, tiers, telegramLink, subscriberCount, revenue] = await Promise.all([
    listPendingRequestsForProvider(providerId),
    listActiveTrialsForProvider(providerId),
    listTiersForProvider(providerId),
    getBotLink(providerId, FEEDS_BOT_KEY),
    getActiveSubscriberCountForProvider(providerId),
    getProviderRevenueSummary(providerId, new Date()),
  ]);

  const oldest = pending[pending.length - 1];
  /** The three most recent months exactly as History orders them, newest first -- INCLUDING a
   * month with no paying client, which renders "—" here as it does there. Dropping the empty ones
   * would be a gate the canonical page does not have: a card whose top row was August would read
   * as stale rather than as "September has no contracted client yet". */
  const months = revenue.months.slice(0, MONTHS_ON_CARD);

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
            <div className="sub">
              active, across your packages ·{" "}
              <Link href="/feed/dashboard/subscribers" style={{ color: "var(--pfp-cyan)", fontWeight: 600 }}>
                View →
              </Link>
            </div>
          </div>
          <div className={`stat${pending.length > 0 ? " hot" : ""}`}>
            <div className="lab">
              <span className="si">⚑</span> Pending approvals
            </div>
            <div className="val">{pending.length}</div>
            <div className="sub">
              {oldest ? <>oldest waiting · {formatRelative(oldest.createdAt)} · </> : "queue is clear · "}
              <Link href="/feed/dashboard/users" style={{ color: "var(--pfp-warn)", fontWeight: 600 }}>
                Open →
              </Link>
            </div>
          </div>
          <div className="stat">
            <div className="lab">
              <span className="si">◉</span> Active trials
            </div>
            <div className="val">{trials.length}</div>
            <div className="sub">
              across your managed tiers ·{" "}
              <Link href="/feed/dashboard/active-users" style={{ color: "var(--pfp-cyan)", fontWeight: 600 }}>
                View →
              </Link>
            </div>
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
            </div>
            {/* TWO FIGURES, TWO DIFFERENT QUESTIONS, and each label says which (coxwell 13:58Z via
                marcus). The card used to carry the live one alone under the word "Estimated
                monthly" -- which reads like a month's total and is not one, so beside $60 of
                September it would have looked like a contradiction rather than a different
                question. "Right now" vs "in the month" is the whole distinction and it is in the
                labels, not in a footnote. */}
            <div className="stat" style={{ padding: 0, background: "transparent", border: "none", borderRadius: 0 }}>
              <div className="lab">Your 50% · right now</div>
              <div className="val">{moneyOrUnpriced(revenue.liveShareCents, revenue.live.priced)}</div>
              <div className="sub">
                half of what clients who are active today are charged
                {revenue.live.priced < revenue.live.subscribers && (
                  <> · {revenue.live.priced} of {revenue.live.subscribers} priced</>
                )}
              </div>
            </div>

            <div className="mrev">
              <div className="mhead">
                <b>Your 50% · by month</b>
                <span>what was contracted in each month</span>
              </div>
              {months.length === 0 ? (
                <div className="mempty">A month appears here once a client holds a paid subscription during it.</div>
              ) : (
                <>
                  {months.map((m) => (
                    <div className="mrow" key={m.monthKey}>
                      <span className="ml">{m.label}</span>
                      <span className="mc">
                        {m.clients === 0
                          ? "no paying client"
                          : `${m.clients} paying client${m.clients === 1 ? "" : "s"}`}
                      </span>
                      <span className="mv">
                        {m.clients === 0 ? "—" : moneyOrUnpriced(m.shareCents, m.pricedClients)}
                      </span>
                    </div>
                  ))}
                  {/* m49083's rule, carried onto the card with the figures it governs: a client on a
                      one-month term must not read as three months of revenue. */}
                  <div className="mfoot">Each month stands alone — these are never added together.</div>
                </>
              )}
            </div>

            <div className="scope-note">
              <span className="i">ⓘ</span>
              <span>
                No payout ledger exists yet — both figures are list-price estimates, not money received.
                The live figure is today&apos;s active clients; a month counts every client contracted at
                any point in it, including ones who have since stopped, which is why the two rarely match.
                Trials, and clients with no agreed price, add nothing to either. See{" "}
                <Link href="/feed/dashboard/revenue?view=history">Revenue → History</Link> for the months in
                full.
              </span>
            </div>
          </div>
        </div>

        <div className="foot">HORIZON HFT · provider panel · Overview</div>
      </section>
    </>
  );
}
