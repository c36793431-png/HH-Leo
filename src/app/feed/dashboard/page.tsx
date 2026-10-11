import Link from "next/link";
import { auth } from "@/lib/auth";
import { FeedNavToggle } from "@/components/feed/feed-nav-toggle";
import { listPendingRequestsForProvider, listActiveTrialsForProvider, listTiersForProvider } from "@/lib/feed-providers";
import type { FeedTierRequestRow } from "@/lib/feed-tier-requests";
import { formatRelative } from "@/lib/format-time";
import { getBotLink } from "@/lib/telegram-bot-links";
import { FEEDS_BOT_KEY } from "@/lib/telegram-feeds-bot";
import { getActiveSubscriberCountForProvider, getProviderRevenueSummary } from "@/lib/feed-subscriptions";
import { moneyOrUnpriced } from "@/lib/feed-provider-packages";
import { countRequestGroups, groupRequestsByPackage } from "@/lib/request-package-groups";
import { countNewClientsForProvider, thisMonthShare } from "@/lib/provider-overview";
import {
  ActiveUsersStat,
  BotChip,
  EarningsCard,
  FeedHealthCard,
  FeedUptimeStat,
  ThisMonthShareStat,
} from "@/components/feed/overview-cards";

/** How many months of History the Earnings card carries. Three is what fits without the card turning
 * into a table; the Earnings page's History view is the full list and the card links to it. */
const MONTHS_ON_CARD = 3;

const TYPE_ICON: Record<string, string> = { pending: "🧪", approved: "✓", rejected: "✗", provisioned: "💳" };

/** Recent activity lists the pending requests exactly as the Approvals list renders them: one
 * entry per groupRequestsByPackage group, so a package batch is one entry under the package's
 * name and anything else is one entry per feed (marcus m64242, A1). It used to collapse by
 * (client, package label), a second grouper for the same fact that could disagree with the list
 * and the counters. Pending arrives newest first and the grouper keeps that order. */
function recentRequestActivity(rows: FeedTierRequestRow[]) {
  return groupRequestsByPackage(rows).map((g) => {
    const r = g.kind === "package" ? g.members[0] : g.row;
    return {
      key: g.kind === "package" ? `batch-${g.batchId}` : r.id,
      userEmail: r.userEmail,
      label: g.kind === "package" ? g.label : r.tierName,
      at: r.createdAt,
    };
  });
}

export default async function FeedOverviewPage() {
  const session = await auth();
  const providerId = session!.user!.id!;

  const now = new Date();
  const [pending, trials, tiers, telegramLink, subscriberCount, revenue, newClients] = await Promise.all([
    listPendingRequestsForProvider(providerId),
    listActiveTrialsForProvider(providerId),
    listTiersForProvider(providerId),
    getBotLink(providerId, FEEDS_BOT_KEY),
    getActiveSubscriberCountForProvider(providerId),
    getProviderRevenueSummary(providerId, now),
    countNewClientsForProvider(providerId, now),
  ]);

  const oldest = pending[pending.length - 1];
  const requestCount = countRequestGroups(pending);
  const share = thisMonthShare(revenue.months, now);
  /** People, not trial rows: a NY Base trial is 2 rows for 1 client (the A1 rule, m64242). */
  const trialClients = new Set(trials.map((t) => t.userId)).size;

  return (
    <>
      <header className="fp-topbar">
        <FeedNavToggle />
        <div>
          <h1>Overview</h1>
          <div className="crumb">feed.horizonhft.com / overview</div>
        </div>
        <div className="sp" />
        <BotChip linked={Boolean(telegramLink)} />
      </header>

      <section className="fp-content">
        {requestCount > 0 && (
          <div className="banner warn">
            <span className="bic">⚑</span>
            <div>
              <b>
                {requestCount} request{requestCount === 1 ? "" : "s"}
              </b>{" "}
              {requestCount === 1 ? "is" : "are"} waiting for your approval.
              Approving is one click and instantly activates the client.
            </div>
            <Link className="baction" href="/feed/dashboard/users">
              Review queue →
            </Link>
          </div>
        )}

        {/* Row 1 is Iris's dashboard.html KPI row (P1, m64242): this month's share, pending, active
            users, feed uptime. Row 2 keeps the two tiles the panel had that the mockup has no slot
            for: Tiers you manage, and the all-months total (coxwell's ask, m50098). */}
        <div className="stats">
          <ThisMonthShareStat share={share} />
          <div className={`stat${requestCount > 0 ? " hot" : ""}`}>
            <div className="lab">
              <span className="si">⚑</span> Pending approvals
            </div>
            <div className="val">{requestCount}</div>
            <div className="sub">
              {oldest ? <>oldest waiting · {formatRelative(oldest.createdAt)} · </> : "queue is clear · "}
              <Link href="/feed/dashboard/users" style={{ color: "var(--pfp-warn)", fontWeight: 600 }}>
                Open →
              </Link>
            </div>
          </div>
          <ActiveUsersStat subscribers={subscriberCount} trialClients={trialClients} newClients={newClients} />
          <FeedUptimeStat />
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
          {/* THE ALL-MONTHS TOTAL (coxwell's third ask, marcus m50098). Row 2, column 2, next to
              Tiers you manage. Below the desktop breakpoint the grid is 1fr 1fr; no copy here
              depends on position.

              A TILE CANNOT CARRY THE REASONING, SO IT CARRIES THE WARNING AND A ROUTE TO IT. The
              Earnings card further down this page renders the very month figures a reader would add
              up, so the $105-vs-$120 gap is visible on THIS screen, not only on Earnings -- a bare
              figure here would reproduce the exact failure the Earnings History footer exists to prevent.
              The .sub therefore carries the two things that stop a wrong reading (counted once; NOT
              the months added up) and links to the page that explains why. The full mechanism does
              not fit in a quarter-width tile and is not attempted here. */}
          <div className="stat">
            <div className="lab">
              <span className="si">▦</span> Contracted · all months
            </div>
            <div className="val">
              {revenue.contracted.agreements === 0
                ? "—"
                : moneyOrUnpriced(revenue.contracted.shareCents, revenue.contracted.agreements)}
            </div>
            <div className="sub">
              {revenue.contracted.agreements === 0 ? (
                <>nothing contracted yet · </>
              ) : (
                <>
                  your 50% of {revenue.contracted.agreements} agreement
                  {revenue.contracted.agreements === 1 ? "" : "s"}, each counted once — not the month rows added up ·
                  list price, not money received ·{" "}
                </>
              )}
              <Link href="/feed/dashboard/revenue?view=history" style={{ color: "var(--pfp-cyan)", fontWeight: 600 }}>
                Why →
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
                {recentRequestActivity(pending)
                  .slice(0, 5)
                  .map((g) => (
                  <div className="ai" key={g.key}>
                    <div className="ic trial">{TYPE_ICON.pending}</div>
                    <div className="txt">
                      <b>
                        {g.userEmail ?? "unknown"} — {g.label}
                      </b>
                      <span>requested {formatRelative(g.at)}</span>
                    </div>
                    <div className="tm">{formatRelative(g.at)}</div>
                  </div>
                ))}
              </div>
            )}
          </div>

          <div className="grid" style={{ gap: 18 }}>
            <EarningsCard revenue={revenue} share={share} monthsOnCard={MONTHS_ON_CARD} />
            <FeedHealthCard />
          </div>
        </div>

        <div className="foot">HORIZON HFT · provider panel · Overview</div>
      </section>
    </>
  );
}
