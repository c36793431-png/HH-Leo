import { Fragment } from "react";
import type { SignalStats } from "@/lib/signal-stats";
import type { SignalCallRow } from "@/lib/signal-calls";
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
 * Section 4 (S5, per-pair price line with call markers) is SignalPriceCharts at the bottom of this file.
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

/** Round-number ticks covering [lo, hi], including 0 unless withZero is false (a price axis). */
function ticks(lo: number, hi: number, withZero = true): number[] {
  if (withZero) {
    lo = Math.min(lo, 0);
    hi = Math.max(hi, 0);
    if (lo === hi) hi = 1;
  } else if (lo === hi) {
    // One price: a band of 0.1% around it, so it sits mid-plot.
    const pad = Math.abs(lo) / 1000 || 1;
    lo -= pad;
    hi += pad;
  }
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
      <NumbersTable head={head} rows={rows} />
    </figure>
  );
}

/** The "Show the numbers" table under every chart; rows are keyed on their first cell (a session date). */
function NumbersTable({ head, rows }: { head: string[]; rows: string[][] }) {
  return (
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

/* Section 4 (S5, marcus GO m67677; plan section 8 at 69a89b0, :498-501): per pair, a price line through each call's
 * own entry_px and exit_px, no bars (R6 m67429), and a marker at each entry. Each price sits at its own instant:
 * entry = the OPEN of the bar starting entry_bar_ts, exit = the CLOSE of the bar starting exit_bar_ts, so exit_bar_ts
 * + 1 h (1 h bars, axiom via marcus m67464, track_record.py :84-87, not read by me). A fallback bar therefore plots
 * where its price was, not at 06:00 / 21:00. One segment per session and nothing between sessions: no price was
 * sent for the hours in between, so a line across them would draw a move nobody measured.
 * Marker: the glyph points the call's direction, its colour AND its fill give the outcome (right filled green,
 * wrong outlined red, flat filled grey, not scored outlined grey), so colour is never the only signal (plan :499);
 * a neutral call is a grey circle on the plot floor, at its window start, as is an up/down call with no price yet. */
const BAR_MS = 60 * 60 * 1000;

// Code points, so the source stays ASCII: U+25B2 / U+25B3 up filled / outlined, U+25BC / U+25BD down, U+25CB circle.
const ch = String.fromCharCode;
const GLYPH = { up: [ch(0x25b2), ch(0x25b3)], down: [ch(0x25bc), ch(0x25bd)] } as const; // [filled, outlined]
const CIRCLE = ch(0x25cb);

function callMark(r: SignalCallRow): { glyph: string; cls: string; word: string } {
  if (r.direction === "neutral") return { glyph: CIRCLE, cls: "sg-mk-none", word: "neutral, no price" };
  const [filled, outlined] = GLYPH[r.direction];
  if (r.outcome === "right") return { glyph: filled, cls: "sg-mk-right", word: "right" };
  if (r.outcome === "wrong") return { glyph: outlined, cls: "sg-mk-wrong", word: "wrong" };
  if (r.outcome === "flat") return { glyph: filled, cls: "sg-mk-none", word: "flat" };
  return r.entryPx === null
    ? { glyph: CIRCLE, cls: "sg-mk-none", word: "no price yet" }
    : { glyph: outlined, cls: "sg-mk-none", word: "not scored yet" };
}

const LEGEND: [string, string, string][] = [
  [`${GLYPH.up[0]}${GLYPH.down[0]}`, "sg-mk-right", "right"],
  [`${GLYPH.up[1]}${GLYPH.down[1]}`, "sg-mk-wrong", "wrong"],
  [`${GLYPH.up[0]}${GLYPH.down[0]}`, "sg-mk-none", "flat"],
  [`${GLYPH.up[1]}${GLYPH.down[1]}`, "sg-mk-none", "not scored yet"],
  [CIRCLE, "sg-mk-none", "neutral, or no price yet (on the floor)"],
];

const fmtPx = (n: number) => n.toLocaleString("en-US", { maximumFractionDigits: 6 });

function PriceChart({ symbol, rows }: { symbol: string; rows: SignalCallRow[] }) {
  const inst = signalInstrument(symbol);
  const label = inst?.label ?? "units";
  const futures = inst?.yahooTicker.endsWith("=F") ? `, ${inst.yahooTicker} futures` : "";
  // A price implies its bar start (0110's signal_calls_entry_stamp / signal_calls_scored_stamp CHECKs).
  const entry = (r: SignalCallRow) => (r.entryPx === null ? null : { t: r.entryBarTs!.getTime(), v: Number(r.entryPx) });
  const exit = (r: SignalCallRow) => (r.exitPx === null ? null : { t: r.exitBarTs!.getTime() + BAR_MS, v: Number(r.exitPx) });
  const points = rows.flatMap((r) => [entry(r), exit(r)]).flatMap((p) => (p ? [p] : []));
  const prices = points.map((p) => p.v);
  const yTicks = prices.length ? ticks(Math.min(...prices), Math.max(...prices), false) : [];
  const lo = yTicks[0];
  const hi = yTicks[yTicks.length - 1];
  // x spans the windows and every plotted instant; t1 > t0 because exit_ts > entry_ts (0110 signal_calls_window).
  const t0 = Math.min(...rows.map((r) => r.entryTs.getTime()), ...points.map((p) => p.t));
  const t1 = Math.max(...rows.map((r) => r.exitTs.getTime()), ...points.map((p) => p.t));
  const xAt = (t: number) => (t - t0) / (t1 - t0);
  const yAt = (v: number) => (v - lo) / (hi - lo);
  const at = (p: { t: number; v: number }) => `${xAt(p.t) * 1000},${1000 - yAt(p.v) * 1000}`;
  const d = rows
    .map((r) => [entry(r), exit(r)] as const)
    .filter((s): s is readonly [{ t: number; v: number }, { t: number; v: number }] => s[0] !== null && s[1] !== null)
    .map(([a, b]) => `M${at(a)} L${at(b)}`)
    .join(" ");
  const first = rows[0].sessionDate;
  const last = rows[rows.length - 1].sessionDate;
  const tip = (r: SignalCallRow, word: string) =>
    `${r.sessionDate}\n${symbol} ${r.direction}, ${word}\nentry ${r.entryPx ?? "none"}, exit ${r.exitPx ?? "none"}` +
    (r.move === null ? "" : `\nmove ${fmtMove(Number(r.move), label)}`);
  return (
    <figure className="sg-ch">
      <figcaption>
        <b>{`${symbol}: price at each call`}</b>
        <span>{`Entry open to exit close, per session${futures}`}</span>
      </figcaption>
      {prices.length === 0 ? (
        <p className="sg-ch-cap">No priced calls in this range.</p>
      ) : (
        <>
          <div className="sg-ch-plot">
            {yTicks.map((t) => (
              <div key={t} className="sg-ch-grid-y" style={{ bottom: pct(yAt(t) * 100) }}>
                <span>{fmtPx(t)}</span>
              </div>
            ))}
            <svg className="sg-ch-svg" viewBox="0 0 1000 1000" preserveAspectRatio="none" aria-hidden="true">
              <path d={d} fill="none" strokeWidth={2} strokeLinecap="round" vectorEffect="non-scaling-stroke" />
            </svg>
            {rows.map((r) => {
              const p = exit(r);
              return p && <div key={r.sessionDate} className="sg-ch-pt" style={{ left: pct(xAt(p.t) * 100), bottom: pct(yAt(p.v) * 100) }} />;
            })}
            {rows.map((r) => {
              const m = callMark(r);
              const p = entry(r);
              const left = pct(xAt(p ? p.t : r.entryTs.getTime()) * 100);
              return (
                <Fragment key={r.sessionDate}>
                  <span className={`sg-mk ${m.cls}${p ? "" : " sg-mk-floor"}`} style={{ left, bottom: p ? pct(yAt(p.v) * 100) : "0%" }}>
                    {m.glyph}
                  </span>
                  <div className="sg-ch-hit" style={{ left }} title={tip(r, m.word)} />
                </Fragment>
              );
            })}
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
      <NumbersTable
        head={["Session", "Call", "Entry", "Exit", "Move", "Outcome"]}
        rows={rows.map((r) => [
          r.sessionDate,
          r.direction,
          r.entryPx ?? "none",
          r.exitPx ?? "none",
          r.move === null ? "n/a" : fmtMove(Number(r.move), label),
          callMark(r).word,
        ])}
      />
    </figure>
  );
}

/** Section 4: one price chart per pair, in `symbols` order (the page passes section 3's), under one shared legend. */
export function SignalPriceCharts({ rows, symbols }: { rows: SignalCallRow[]; symbols: string[] }) {
  return (
    <>
      <ul className="sg-ch-legend" aria-label="Call markers">
        {LEGEND.map(([g, cls, word]) => (
          <li key={word}>
            <span className={cls}>{g}</span>
            {word}
          </li>
        ))}
      </ul>
      <div className="sg-ch-grid">
        {symbols.map((s) => (
          <PriceChart key={s} symbol={s} rows={rows.filter((r) => r.symbol === s)} />
        ))}
      </div>
    </>
  );
}
