import type { SignalStats } from "@/lib/signal-stats";
import { signalInstrument } from "@/lib/signal-instruments";

/**
 * /admin/signals section 3 (Axiom signals dashboard S4, marcus GO m67643; plan
 * docs/specs/axiom-signals-dashboard-plan.md section 5 at d52245c, :375-377 and :402-406): cumulative hit rate
 * over time (one line, all pairs) and cumulative net move PER PAIR. The per-pair lines are small multiples, one
 * chart per pair on its own axis, never one shared axis: 5 FX pips and 20 US30 points are different units.
 *
 * Built as src/components/feed/method-charts.tsx is: server-only, lines as SVG paths in a 1000 x 1000 box the
 * CSS stretches to the plot (strokes kept at 2px), labels and hover targets as positioned HTML, and a "Show the
 * numbers" table under each chart. Each chart is one series named by its title, so there is no legend and no
 * colour carries identity (dataviz skill: a single series needs no legend). x is time, by session date.
 */

/** A move in the pair's unit, signed, at most 2 dp: "+12.5 pips", "-$3.2", "+40 points". */
export function fmtMove(n: number, label: string): string {
  const s = Math.abs(n).toLocaleString("en-US", { maximumFractionDigits: 2 });
  const sign = s === "0" ? "" : n < 0 ? "-" : "+";
  return label === "$" ? `${sign}$${s}` : `${sign}${s} ${label}`;
}

/** Hit % with its denominator beside it (fable m67641 on S3 call 2: 10 scored with 9 flats is a hit % off one
 * call, and the (n) is what shows it). */
export const fmtHit = (hitPct: number | null, n: number) => `${hitPct === null ? "n/a" : `${hitPct.toFixed(1)}%`} (${n})`;

const pct = (n: number) => `${n}%`;
const dayMs = (d: string) => Date.parse(`${d}T00:00:00Z`);

/** Round-number ticks covering [lo, hi], always including 0. */
function ticks(lo: number, hi: number): number[] {
  lo = Math.min(lo, 0);
  hi = Math.max(hi, 0);
  if (lo === hi) hi = 1;
  const raw = (hi - lo) / 4;
  const mag = 10 ** Math.floor(Math.log10(raw));
  const step = [1, 2, 2.5, 5, 10].map((m) => m * mag).find((s) => s >= raw)!;
  const out: number[] = [];
  const start = Math.floor(lo / step) * step;
  for (let i = 0; ; i++) {
    const t = Number((start + i * step).toPrecision(12));
    out.push(t);
    if (t >= hi) return out;
  }
}

interface Point {
  date: string;
  value: number;
  tip: string;
}

function LineChart({
  title,
  sub,
  points,
  yTicks,
  fmtY,
  refY,
  refLabel,
  head,
  rows,
}: {
  title: string;
  sub: string;
  points: Point[];
  yTicks: number[];
  fmtY: (n: number) => string;
  refY?: number;
  refLabel?: string;
  head: string[];
  rows: string[][];
}) {
  const lo = yTicks[0];
  const hi = yTicks[yTicks.length - 1];
  const t0 = points.length ? dayMs(points[0].date) : 0;
  const t1 = points.length ? dayMs(points[points.length - 1].date) : 0;
  // One date: the point sits mid-plot.
  const xAt = (d: string) => (t1 === t0 ? 0.5 : (dayMs(d) - t0) / (t1 - t0));
  const yAt = (v: number) => (v - lo) / (hi - lo);
  const d = points.map((p, i) => `${i === 0 ? "M" : "L"}${xAt(p.date) * 1000},${1000 - yAt(p.value) * 1000}`).join(" ");
  const first = points[0]?.date;
  const last = points[points.length - 1]?.date;
  return (
    <figure className="sg-ch">
      <figcaption>
        <b>{title}</b>
        <span>{sub}</span>
      </figcaption>
      {points.length === 0 ? (
        <p className="sg-ch-cap">No scored calls in this range.</p>
      ) : (
        <>
          <div className="sg-ch-plot">
            {yTicks.map((t) => (
              <div key={t} className={`sg-ch-grid-y${t === 0 ? " sg-zero" : ""}`} style={{ bottom: pct(yAt(t) * 100) }}>
                <span>{fmtY(t)}</span>
              </div>
            ))}
            {refY !== undefined && (
              <div className="sg-ch-ref" style={{ bottom: pct(yAt(refY) * 100) }}>
                <span>{refLabel}</span>
              </div>
            )}
            <svg className="sg-ch-svg" viewBox="0 0 1000 1000" preserveAspectRatio="none" aria-hidden="true">
              <path d={d} fill="none" strokeWidth={2} strokeLinejoin="round" strokeLinecap="round" vectorEffect="non-scaling-stroke" />
            </svg>
            {points.map((p) => (
              <div key={p.date} className="sg-ch-pt" style={{ left: pct(xAt(p.date) * 100), bottom: pct(yAt(p.value) * 100) }} />
            ))}
            {points.map((p) => (
              <div key={p.date} className="sg-ch-hit" style={{ left: pct(xAt(p.date) * 100) }} title={p.tip} />
            ))}
          </div>
          <div className="sg-ch-x">
            {first === last ? (
              <span style={{ left: "50%" }}>{first}</span>
            ) : (
              <>
                <span className="sg-first" style={{ left: "0%" }}>
                  {first}
                </span>
                <span className="sg-last" style={{ left: "100%" }}>
                  {last}
                </span>
              </>
            )}
          </div>
        </>
      )}
      <details className="sg-ch-data">
        <summary>Show the numbers</summary>
        <div className="sg-ch-tablewrap">
          <table>
            <thead>
              <tr>
                {head.map((h) => (
                  <th key={h}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r[0]}>
                  {r.map((c, i) => (
                    <td key={head[i]}>{c}</td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </details>
    </figure>
  );
}

/** Section 3a: right / (right + wrong) to date, one point per session date with a scored call. A date where
 * every scored call so far is flat has no hit % and no point; the table still lists it. */
function CumulativeHit({ series }: { series: SignalStats["cumulativeHit"] }) {
  const points = series
    .filter((p) => p.hitPct !== null)
    .map((p) => ({ date: p.date, value: p.hitPct!, tip: `${p.date}\nhit % ${fmtHit(p.hitPct, p.right + p.wrong)}\nright ${p.right}, wrong ${p.wrong}` }));
  return (
    <LineChart
      title="Cumulative hit rate"
      sub="All pairs: right / (right + wrong) to date. Flats and neutrals are outside it."
      points={points}
      yTicks={[0, 25, 50, 75, 100]}
      fmtY={(t) => `${t}%`}
      refY={50}
      refLabel="50%"
      head={["Session", "Right", "Wrong", "Hit % (n)"]}
      rows={series.map((p) => [p.date, String(p.right), String(p.wrong), fmtHit(p.hitPct, p.right + p.wrong)])}
    />
  );
}

/** Section 3b: one chart per pair, net move to date in the pair's own unit. */
function CumulativeNet({ pair }: { pair: SignalStats["pairs"][number] }) {
  const label = signalInstrument(pair.symbol)?.label ?? "units";
  const values = pair.cumulativeNet.map((p) => p.net);
  const yTicks = ticks(Math.min(0, ...values), Math.max(0, ...values));
  const fmt = (n: number) => fmtMove(n, label);
  return (
    <LineChart
      title={`${pair.symbol}: cumulative net move`}
      sub={`Net ${label === "$" ? "dollars" : label} to date if every call was followed${pair.small ? " (n<10 scored)" : ""}`}
      points={pair.cumulativeNet.map((p) => ({ date: p.date, value: p.net, tip: `${p.date}\n${pair.symbol} net ${fmt(p.net)}` }))}
      yTicks={yTicks}
      fmtY={fmt}
      head={["Session", "Net to date"]}
      rows={pair.cumulativeNet.map((p) => [p.date, fmt(p.net)])}
    />
  );
}

export function SignalCharts({ stats }: { stats: SignalStats }) {
  return (
    <div className="sg-ch-grid">
      <CumulativeHit series={stats.cumulativeHit} />
      {stats.pairs.map((p) => (
        <CumulativeNet key={p.symbol} pair={p} />
      ))}
    </div>
  );
}
