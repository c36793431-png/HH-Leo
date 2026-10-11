import Link from "next/link";
import { money, moneyOrUnpriced } from "@/lib/feed-provider-packages";
import type { ProviderRevenueSummary } from "@/lib/feed-subscriptions";
import type { ThisMonthShare } from "@/lib/provider-overview";

/** The provider Overview's P1 pieces on Iris's dashboard.html layout (marcus m64242; Earnings
 * naming m64316). Pure props, so each renders from fixture rows. Two rules hold throughout: no
 * figure without a source (a missing one reads "—" or "not measured yet", never an invented
 * number), and the platform is "Horizon" wherever the mockup said "Feedverse". */

/** "Feed bot · linked": proves a link row exists, not that any DM was delivered. Nothing renders
 * when there is no link -- the Link Telegram banner already covers that state. */
export function BotChip({ linked }: { linked: boolean }) {
  if (!linked) return null;
  return <div className="botchip">✈ Feed bot · linked</div>;
}

function ChangeVsLastMonth({ pct }: { pct: number | null }) {
  if (pct == null) return <>— vs. last month</>;
  if (pct === 0) return <>0% vs. last month</>;
  return (
    <>
      <span className={pct > 0 ? "up" : "dn"}>
        {pct > 0 ? "▲" : "▼"} {Math.abs(pct)}%
      </span>{" "}
      vs. last month
    </>
  );
}

/** THIS MONTH · YOUR SHARE: this calendar month's contracted share, as the Earnings card's month row
 * prints it. "50% of $gross" only when every client in the month is priced. */
export function ThisMonthShareStat({ share }: { share: ThisMonthShare }) {
  const m = share.month;
  const hasClients = m != null && m.clients > 0;
  return (
    <div className="stat">
      <div className="lab">
        <span className="si">◷</span> This month · your share
      </div>
      <div className="val">{hasClients ? moneyOrUnpriced(m.shareCents, m.pricedClients) : "—"}</div>
      <div className="sub">
        {!hasClients ? (
          <>no paying client this month</>
        ) : (
          <>
            <ChangeVsLastMonth pct={share.changePct} />
            {share.horizonCents != null ? (
              <> · 50% of {money(m.grossCents)}</>
            ) : (
              <>
                {" "}
                · {m.pricedClients} of {m.clients} priced
              </>
            )}
          </>
        )}
      </div>
    </div>
  );
}

/** ACTIVE USERS "N / M trial": N = the Subscribers count the panel already shows
 * (getActiveSubscriberCountForProvider), M = distinct clients with a live trial on this provider's
 * tiers. Two existing readers side by side, not a new headcount; a client paying on one tier and
 * trialling another is in both. */
export function ActiveUsersStat({ subscribers, trialClients, newClients }: { subscribers: number; trialClients: number; newClients: number }) {
  return (
    <div className="stat">
      <div className="lab">
        <span className="si">◉</span> Active users
      </div>
      <div className="val">
        {subscribers} <small>/ {trialClients} trial</small>
      </div>
      <div className="sub">
        {newClients > 0 ? <span className="up">▲ {newClients}</span> : <>0</>} new in 7 days ·{" "}
        <Link href="/feed/dashboard/subscribers" style={{ color: "var(--pfp-cyan)", fontWeight: 600 }}>
          Subscribers →
        </Link>{" "}
        <Link href="/feed/dashboard/active-users" style={{ color: "var(--pfp-cyan)", fontWeight: 600 }}>
          Trials →
        </Link>
      </div>
    </div>
  );
}

/** FEED UPTIME · 30D has no source yet (gap plan row 9 / T1), so it says so. */
export function FeedUptimeStat() {
  return (
    <div className="stat">
      <div className="lab">
        <span className="si">◇</span> Feed uptime · 30d
      </div>
      <div className="val">
        — <small>not measured yet</small>
      </div>
      <div className="sub">
        <Link href="/feed/dashboard/health" style={{ color: "var(--pfp-cyan)", fontWeight: 600 }}>
          See Feed Health →
        </Link>
      </div>
    </div>
  );
}

/** EARNINGS (was "Revenue", m64316). The provider's share at the stages the panel can show:
 * Contracted (this month's split bar and the month rows) and Right now (today's active clients).
 * Received has no source -- there is no payout ledger -- so it is a labelled empty row, not a
 * figure. No next-payout date and no Statements link until those exist (m64316, plan Q1). */
export function EarningsCard({
  revenue,
  share,
  monthsOnCard,
}: {
  revenue: ProviderRevenueSummary;
  share: ThisMonthShare;
  monthsOnCard: number;
}) {
  const m = share.month;
  /** The most recent months exactly as History orders them, newest first -- INCLUDING a month with
   * no paying client, which renders "—" here as it does there. Dropping the empty ones would be a
   * gate the canonical page does not have: a card whose top row was August would read as stale
   * rather than as "September has no contracted client yet". */
  const months = revenue.months.slice(0, monthsOnCard);
  const youPct = m && share.horizonCents != null && m.grossCents > 0 ? Math.round((m.shareCents / m.grossCents) * 100) : null;
  return (
    <div className="card">
      <div className="chead">
        <span className="ic">▦</span>
        <h3>Earnings</h3>
        {m && <span className="cap">{m.label}</span>}
      </div>

      {m != null && youPct != null && share.horizonCents != null ? (
        <div className="splitbar" style={{ marginTop: 2 }}>
          <div className="track">
            <div className="you" style={{ width: `${youPct}%` }} />
            <div className="fv" style={{ width: `${100 - youPct}%` }} />
          </div>
          <div className="lgd">
            <div className="it">
              <span className="sw you" /> Contracted · your share <b style={{ color: "var(--pfp-ink)", marginLeft: 4 }}>{money(m.shareCents)}</b>
            </div>
            <div className="it">
              <span className="sw fv" /> Horizon <span style={{ color: "var(--pfp-ink-3)", marginLeft: 4 }}>{money(share.horizonCents)}</span>
            </div>
          </div>
        </div>
      ) : (
        <div className="splitempty">
          {m == null || m.clients === 0
            ? "The split appears once a client holds a paid subscription this month."
            : "The split appears once every client this month has an agreed price."}
        </div>
      )}

      {/* TWO FIGURES, TWO DIFFERENT QUESTIONS, and each label says which (coxwell 13:58Z via
          marcus). "Right now" vs "in the month" is the whole distinction and it is in the labels,
          not in a footnote; m64316 names them Right now and Contracted. */}
      <div className="stat" style={{ padding: 0, background: "transparent", border: "none", borderRadius: 0, marginTop: 16 }}>
        <div className="lab">Right now · your 50%</div>
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
          <b>Contracted · by month</b>
          <span>your 50% of what was contracted in each month</span>
        </div>
        {months.length === 0 ? (
          <div className="mempty">A month appears here once a client holds a paid subscription during it.</div>
        ) : (
          <>
            {months.map((row) => (
              <div className="mrow" key={row.monthKey}>
                <span className="ml">{row.label}</span>
                <span className="mc">
                  {row.clients === 0 ? "no paying client" : `${row.clients} paying client${row.clients === 1 ? "" : "s"}`}
                </span>
                <span className="mv">{row.clients === 0 ? "—" : moneyOrUnpriced(row.shareCents, row.pricedClients)}</span>
              </div>
            ))}
            {/* m49083's rule, carried with the figures it governs: a client on a one-month term must not
                read as three months of revenue. m50098's second clause: the all-months tile is not the
                sum. Phrased so it holds in every state (no "smaller than" direction). */}
            <div className="mfoot">
              Each month stands alone — these are never added together. The all-months tile above is not their sum: it
              counts each agreement once, however many months it runs across.
            </div>
          </>
        )}
      </div>

      <div className="mrev">
        <div className="mrow">
          <span className="ml">Received</span>
          <span className="mc">not tracked yet — there is no payout ledger</span>
          <span className="mv none">—</span>
        </div>
      </div>

      <div className="scope-note">
        <span className="i">ⓘ</span>
        <span>
          You see your 50% share. No payout ledger exists yet — every money figure on this page, here and in the
          all-months tile above, is a list-price estimate, not money received. The Right now figure is today&apos;s active
          clients; a month counts every client contracted at any point in it, including ones who have since stopped, which
          is why the two rarely match. Trials, and clients with no agreed price, add nothing to any of them. See{" "}
          <Link href="/feed/dashboard/revenue?view=history">Earnings → History</Link> for the months in full.
        </span>
      </div>
    </div>
  );
}

/** FEED HEALTH mini-card: nothing is measured yet (plan rows 2, 15-17), so an honest empty state --
 * no numbers, no bars, no "measured by" chip. */
export function FeedHealthCard() {
  return (
    <div className="card">
      <div className="chead">
        <span className="ic">◇</span>
        <h3>Feed health</h3>
      </div>
      <div className="empty">
        <div className="eic">◇</div>
        <b>Not measured yet</b>
        <p>Uptime and tick rate will show here once your feed reports them.</p>
        <p style={{ marginTop: 8 }}>
          <Link href="/feed/dashboard/health" style={{ color: "var(--pfp-cyan)", fontWeight: 600 }}>
            See Feed Health →
          </Link>
        </p>
      </div>
    </div>
  );
}
