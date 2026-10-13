import { redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import { isAdminUser } from "@/lib/admin-users-panel";
import { listSignalCalls, parseSignalCallsFilter } from "@/lib/signal-calls";
import {
  LEAD_BUCKETS,
  LEAD_WITHIN_WINDOW_MS,
  SMALL_SAMPLE_SCORED,
  UNSCORED_AFTER_CLOSE_GRACE_MS,
  signalStats,
  type LeadBucket,
  type SignalTally,
} from "@/lib/signal-stats";
import { SIGNAL_INSTRUMENTS, signalInstrument } from "@/lib/signal-instruments";
import { SignalCharts, SignalPriceCharts, fmtHit, fmtMove } from "@/components/admin/signal-charts";
import "./signals.css";

/** Signal calls dashboard (Axiom signals dashboard S4, marcus GO m67643; plan
 * docs/specs/axiom-signals-dashboard-plan.md section 5 at d52245c, :327-406). Admin only, no nav link (Q8 m67403),
 * reads only. Sections 1-3: headline by lead-time row, per-pair table, cumulative charts. Section 4: per-pair
 * price line with call markers (S5, marcus GO m67677).
 *
 * Gate: proxy.ts and admin/layout.tsx already gate /admin; this page repeats isAdminUser because it is meant to
 * be narrower than admin (plan :330-335, Q5 m67403). ONE new Date() per request is now (fable m67641). */
export const dynamic = "force-dynamic";

const MIN = 60 * 1000;
const LEAD_LABEL: Record<LeadBucket, string> = {
  beforeOpen: "Before open",
  within15Min: `Within ${LEAD_WITHIN_WINDOW_MS / MIN} min after open`,
  laterInWindow: "Later in window",
  afterClose: "After close",
};
const FUTURES = Object.entries(SIGNAL_INSTRUMENTS)
  .filter(([, i]) => i.yahooTicker.endsWith("=F"))
  .map(([s, i]) => `${s} = ${i.yahooTicker}`)
  .join(", ");
const GRACE_H = UNSCORED_AFTER_CLOSE_GRACE_MS / (60 * MIN);

// Prose with numbers in it is built as strings, not JSX text around expressions: SWC (the app's compiler) drops
// the leading space of a multi-line JSX text node that carries an entity (tier-endpoints F2, marcus m54397).
// The method note's first sentence pair is plan :381-383 as written there.
const METHOD_NOTE =
  "Window 06:00-21:00 UTC, fixed all year. Scored with a dead-band (5 pips FX, $2 gold, 20 points US30 = flat); " +
  "Axiom's own track record has none, so its hit % differs. Hit % = right / (right + wrong), with that count in " +
  `brackets; flats and neutrals are counted, not in it. XAUUSD and US30 are futures prices (${FUTURES}), not spot. ` +
  "Moves show at most 2 dp.";
const HEADLINE_NOTE =
  "By when the call reached the portal. Axiom's card goes out about 06:10 UTC, so a live call lands in " +
  `"within ${LEAD_WITHIN_WINDOW_MS / MIN} min after open" at best: those minutes of price are known when the call ` +
  `is made. Pending = window still open or closed less than ${GRACE_H} h ago. Unscored after close = a live ` +
  `up/down call with no outcome ${GRACE_H} h after close. Unpriced = a backfilled up/down call with no outcome ` +
  "past that grace. Entry priced after close = a live call whose entry price reached the portal at or after close.";
const PAIRS_NOTE =
  "Net move = the sum over scored calls if every call was followed, in the pair's own unit. Under " +
  `${SMALL_SAMPLE_SCORED} scored calls a row is tagged n<${SMALL_SAMPLE_SCORED} and its percentages are muted.`;
const PRICES_NOTE =
  "Only the prices each call was scored on: a segment from the entry bar's open to the exit bar's close, each at " +
  "its own hour. Nothing is drawn between sessions, because no price was sent for those hours.";

const TH = "py-1 pr-3 font-medium";
const TD = "py-1 pr-3 tabular-nums";

function TallyCells({ t }: { t: SignalTally }) {
  return (
    <>
      <td className={TD}>{t.calls}</td>
      <td className={TD}>{t.right}</td>
      <td className={TD}>{t.wrong}</td>
      <td className={TD}>{t.flat}</td>
      <td className={TD}>{fmtHit(t.hitPct, t.right + t.wrong)}</td>
      <td className={TD}>{t.neutral}</td>
      <td className={TD}>{t.pending}</td>
      <td className={TD}>{t.unscoredAfterClose}</td>
      <td className={TD}>{t.unpriced}</td>
      <td className={`${TD} text-zinc-500`}>{t.entryPricedAfterClose}</td>
      <td className={`${TD} text-zinc-500`}>{`${t.labels.card} / ${t.labels.backfill} / ${t.labels.none}`}</td>
    </>
  );
}

export default async function AdminSignalsPage({
  searchParams,
}: {
  searchParams: Promise<{ source?: string; from?: string; to?: string }>;
}) {
  const session = await auth();
  if (!session?.user?.id || !isAdminUser(session.user)) redirect("/dashboard");

  const filter = parseSignalCallsFilter(await searchParams);
  const now = new Date();
  const rows = await listSignalCalls(filter);
  const stats = signalStats(rows, now);
  const h = stats.headline;

  return (
    <div className="flex flex-1 flex-col gap-8">
      <header>
        <span className="rounded border border-zinc-700 px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wide text-zinc-400">
          Admin · Signals
        </span>
        <h1 className="mt-2 text-lg font-medium text-zinc-100">Signal calls: {filter.source}</h1>
        <p className="mt-1 text-sm text-zinc-400">{METHOD_NOTE}</p>
        <form className="mt-3 flex flex-wrap items-end gap-3 text-xs text-zinc-400" method="get">
          <label className="flex flex-col gap-1">
            Source
            <input name="source" defaultValue={filter.source} className="rounded border border-zinc-700 bg-transparent px-2 py-1 text-zinc-200" />
          </label>
          <label className="flex flex-col gap-1">
            From
            <input type="date" name="from" defaultValue={filter.from ?? ""} className="rounded border border-zinc-700 bg-transparent px-2 py-1 text-zinc-200" />
          </label>
          <label className="flex flex-col gap-1">
            To
            <input type="date" name="to" defaultValue={filter.to ?? ""} className="rounded border border-zinc-700 bg-transparent px-2 py-1 text-zinc-200" />
          </label>
          <button type="submit" className="rounded border border-zinc-700 px-3 py-1 text-zinc-200">
            Show
          </button>
        </form>
      </header>

      {rows.length === 0 ? (
        <p className="text-sm text-zinc-500">No calls for this source and range.</p>
      ) : (
        <>
          <section className="rounded-xl border border-zinc-800 p-5" data-section="headline">
            <h2 className="text-sm font-medium text-zinc-300">Headline</h2>
            <p className="mt-2 text-2xl font-medium tabular-nums text-zinc-100">
              {fmtHit(h.hitPct, h.right + h.wrong)}
              <span className="ml-3 text-sm font-normal text-zinc-400">
                {`${h.calls} calls, ${h.right} right, ${h.wrong} wrong, ${h.flat} flat, ${h.firstDate} to ${h.lastDate}`}
              </span>
            </p>
            <p className="mt-2 text-xs text-zinc-500">{HEADLINE_NOTE}</p>
            <div className="mt-3 overflow-x-auto">
              <table className="w-full text-left text-xs text-zinc-300">
                <thead className="text-zinc-500">
                  <tr>
                    <th className={TH}>Received</th>
                    <th className={TH}>Calls</th>
                    <th className={TH}>Right</th>
                    <th className={TH}>Wrong</th>
                    <th className={TH}>Flat</th>
                    <th className={TH}>Hit % (n)</th>
                    <th className={TH}>Neutral</th>
                    <th className={TH}>Pending</th>
                    <th className={TH}>Unscored after close</th>
                    <th className={TH}>Unpriced</th>
                    <th className={TH}>Entry priced after close</th>
                    <th className={TH}>Card / backfill / none</th>
                  </tr>
                </thead>
                <tbody>
                  {LEAD_BUCKETS.map((b) => (
                    <tr key={b} className="border-t border-zinc-800" data-lead={b}>
                      <td className={TD}>{LEAD_LABEL[b]}</td>
                      <TallyCells t={stats.leadTime[b]} />
                    </tr>
                  ))}
                  <tr className="border-t border-zinc-700 text-zinc-200" data-lead="live">
                    <td className={TD}>Live (rows 1-3)</td>
                    <TallyCells t={stats.live} />
                  </tr>
                  <tr className="border-t border-zinc-800 text-zinc-200" data-lead="backfilled">
                    <td className={TD}>Backfilled (row 4)</td>
                    <TallyCells t={stats.backfilled} />
                  </tr>
                  <tr className="border-t border-zinc-700 font-medium text-zinc-100" data-lead="all">
                    <td className={TD}>All</td>
                    <TallyCells t={h} />
                  </tr>
                </tbody>
              </table>
            </div>
          </section>

          <section className="rounded-xl border border-zinc-800 p-5" data-section="pairs">
            <h2 className="text-sm font-medium text-zinc-300">Per pair</h2>
            <p className="mt-1 text-xs text-zinc-500">{PAIRS_NOTE}</p>
            <div className="mt-3 overflow-x-auto">
              <table className="w-full text-left text-xs text-zinc-300">
                <thead className="text-zinc-500">
                  <tr>
                    <th className={TH}>Pair</th>
                    <th className={TH}>Calls</th>
                    <th className={TH}>Scored</th>
                    <th className={TH}>Hit % (n)</th>
                    <th className={TH}>Net move</th>
                    <th className={TH}>Avg right</th>
                    <th className={TH}>Avg wrong</th>
                    <th className={TH}>Up hit % (n)</th>
                    <th className={TH}>Down hit % (n)</th>
                    <th className={TH}>Neutral</th>
                    <th className={TH}>Unscored after close</th>
                  </tr>
                </thead>
                <tbody>
                  {stats.pairs.map((p) => {
                    const label = signalInstrument(p.symbol)?.label ?? "units";
                    const muted = p.small ? " text-zinc-500" : "";
                    return (
                      <tr key={p.symbol} className="border-t border-zinc-800" data-pair={p.symbol}>
                        <td className={`${TD} text-zinc-100`}>
                          {p.symbol}
                          {p.small && (
                            <span className="ml-1.5 rounded border border-zinc-700 px-1 text-[10px] text-zinc-500">n&lt;10</span>
                          )}
                        </td>
                        <td className={TD}>{p.calls}</td>
                        <td className={TD}>{p.scored}</td>
                        <td className={TD + muted}>{fmtHit(p.hitPct, p.right + p.wrong)}</td>
                        <td className={TD}>{fmtMove(p.netMove, label)}</td>
                        <td className={TD}>{p.avgRight === null ? "n/a" : fmtMove(p.avgRight, label)}</td>
                        <td className={TD}>{p.avgWrong === null ? "n/a" : fmtMove(p.avgWrong, label)}</td>
                        <td className={TD + muted}>{fmtHit(p.up.hitPct, p.up.right + p.up.wrong)}</td>
                        <td className={TD + muted}>{fmtHit(p.down.hitPct, p.down.right + p.down.wrong)}</td>
                        <td className={TD}>{p.neutral}</td>
                        <td className={TD}>{p.unscoredAfterClose}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </section>

          <section data-section="charts">
            <h2 className="text-sm font-medium text-zinc-300">Over time</h2>
            <SignalCharts stats={stats} />
          </section>

          <section data-section="prices">
            <h2 className="text-sm font-medium text-zinc-300">Price at each call</h2>
            <p className="mt-1 text-xs text-zinc-500">{PRICES_NOTE}</p>
            <SignalPriceCharts rows={rows} symbols={stats.pairs.map((p) => p.symbol)} />
          </section>
        </>
      )}
    </div>
  );
}
