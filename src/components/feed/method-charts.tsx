import type { CSSProperties } from "react";
import {
  FEEDS,
  GAP_HISTOGRAM,
  GAP_SUMMARY,
  HEAD_TO_HEAD,
  SPREAD,
  STALL_MS,
  UPDATES_PER_HOUR,
  fmtMs,
  fmtP50Ms,
  fmtPct1,
  fmtUsd2,
  type FeedName,
} from "@/lib/feed-method-charts";

/**
 * The four "How we measure" charts on the feed landing (coxwell via marcus, m62845), drawn natively in
 * the page's colours instead of the method post's matplotlib PNGs. Server-only: marks and axis text
 * are HTML positioned in %, and only the lines are SVG (stretched to the plot box, strokes kept at
 * 2px), so labels stay the same size at 1440 and 390.
 *
 * One colour per feed, the same in every chart, in FEEDS order. The order was checked with the
 * dataviz palette validator against the panel colour (#0a1019, dark): all checks pass. Every chart
 * names its feeds in a legend or row label, so identity never rests on colour alone.
 */
const FEED_COLOUR: Record<FeedName, string> = {
  Black: "#0d9488",
  "London Alpha": "#3987e5",
  "London Ultra": "#d95926",
  "LD Beta 56": "#9085e9",
  "LD Gamma 19": "#c98500",
  "LD Delta 18": "#d55181",
};

const pct = (n: number) => `${n}%`;

function Legend() {
  return (
    <ul className="fl-ch-legend">
      {FEEDS.map((feed) => (
        <li key={feed}>
          <i style={{ background: FEED_COLOUR[feed] }} />
          {feed}
        </li>
      ))}
    </ul>
  );
}

/** Lines in a 1000 x 1000 box that the CSS stretches to the plot; y grows downwards. */
function Lines({ paths }: { paths: { feed: FeedName; d: string }[] }) {
  return (
    <svg className="fl-ch-svg" viewBox="0 0 1000 1000" preserveAspectRatio="none" aria-hidden="true">
      {paths.map(({ feed, d }) => (
        <path
          key={feed}
          d={d}
          fill="none"
          stroke={FEED_COLOUR[feed]}
          strokeWidth={2}
          strokeLinejoin="round"
          strokeLinecap="round"
          vectorEffect="non-scaling-stroke"
        />
      ))}
    </svg>
  );
}

function YTicks({ ticks, max, format }: { ticks: number[]; max: number; format: (n: number) => string }) {
  return (
    <>
      {ticks.map((t) => (
        <div key={t} className="fl-ch-grid-y" style={{ bottom: pct((t / max) * 100) }}>
          <span>{format(t)}</span>
        </div>
      ))}
    </>
  );
}

function XTicks({ ticks }: { ticks: { at: number; label: string }[] }) {
  return (
    <div className="fl-ch-x">
      {ticks.map(({ at, label }) => (
        <span key={label} style={{ left: pct(at * 100) }} className={at <= 0 ? "fl-first" : at >= 1 ? "fl-last" : undefined}>
          {label}
        </span>
      ))}
    </div>
  );
}

const thousands = (n: number) => (n === 0 ? "0" : `${n / 1000}k`);

/** 1) Updates per UTC hour, all six feeds. */
function UpdatesPerHour() {
  const max = 120_000;
  const n = UPDATES_PER_HOUR.length;
  const x = (i: number) => (i / (n - 1)) * 1000;
  const y = (v: number) => 1000 - (v / max) * 1000;
  const paths = FEEDS.map((feed, f) => {
    // Black was recorded from 12:41, so its 11:00 bucket is "not recorded", not "no updates": its
    // line starts at 12:00. The 0 stays in the table below, as the README prints it.
    const rows = UPDATES_PER_HOUR.map((r, i) => ({ i, v: r.counts[f] })).filter(({ i }) => !(feed === "Black" && i === 0));
    return { feed, d: rows.map(({ i, v }, k) => `${k === 0 ? "M" : "L"}${x(i)},${y(v)}`).join(" ") };
  });
  return (
    <figure className="fl-ch">
      <figcaption>
        <b>Updates per hour</b>
        <span>Price updates each feed sent, per UTC hour</span>
      </figcaption>
      <Legend />
      <div className="fl-ch-plot">
        <YTicks ticks={[0, 30_000, 60_000, 90_000, 120_000]} max={max} format={thousands} />
        <Lines paths={paths} />
        {UPDATES_PER_HOUR.map((r, i) => (
          <div
            key={r.hour}
            className="fl-ch-hit"
            style={{ left: pct((i / (n - 1)) * 100) }}
            title={`${r.hour} UTC\n${FEEDS.map((feed, f) => `${feed}: ${r.counts[f].toLocaleString("en-US")}`).join("\n")}`}
          />
        ))}
      </div>
      <XTicks ticks={UPDATES_PER_HOUR.filter((_, i) => i % 3 === 0).map((r) => ({ at: UPDATES_PER_HOUR.indexOf(r) / (n - 1), label: r.hour }))} />
      <p className="fl-ch-cap">The 11:00 hour covers 11:57–12:00 only. Black was recorded from 12:41.</p>
      <details className="fl-ch-data">
        <summary>Show the numbers</summary>
        <div className="fl-ch-tablewrap">
          <table>
            <thead>
              <tr>
                <th>UTC</th>
                {FEEDS.map((feed) => (
                  <th key={feed}>{feed}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {UPDATES_PER_HOUR.map((r) => (
                <tr key={r.hour}>
                  <td>{r.hour}</td>
                  {r.counts.map((c, f) => (
                    <td key={FEEDS[f]}>{c.toLocaleString("en-US")}</td>
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

/** 2) Gaps between updates: the share of gaps per log-spaced bin, with the 500 ms stall line. */
function GapDistribution() {
  const lo = Math.log10(GAP_HISTOGRAM[0][0]);
  const hi = Math.log10(GAP_HISTOGRAM[GAP_HISTOGRAM.length - 1][1]);
  const at = (ms: number) => (Math.log10(ms) - lo) / (hi - lo);
  const max = 12;
  const y = (v: number) => 1000 - (v / max) * 1000;
  // Steps across each bin, as the method chart draws them.
  const paths = FEEDS.map((feed, f) => ({
    feed,
    d: GAP_HISTOGRAM.map(([left, right, ...vals], i) =>
      `${i === 0 ? `M${at(left) * 1000},${y(vals[f])}` : `V${y(vals[f])}`} H${at(right) * 1000}`,
    ).join(" "),
  }));
  return (
    <figure className="fl-ch">
      <figcaption>
        <b>Gaps between updates</b>
        <span>Share of each feed&rsquo;s gaps by length, log scale</span>
      </figcaption>
      <Legend />
      <div className="fl-ch-plot">
        <YTicks ticks={[0, 4, 8, 12]} max={max} format={(t) => `${t}%`} />
        <Lines paths={paths} />
        <div className="fl-ch-stall" style={{ left: pct(at(STALL_MS) * 100) }}>
          <span>{STALL_MS} ms stall</span>
        </div>
      </div>
      <XTicks
        ticks={[0.1, 1, 10, 100, 1000, 10000].map((ms) => ({ at: at(ms), label: ms >= 1000 ? `${ms / 1000}k` : String(ms) }))}
      />
      <p className="fl-ch-cap">Gap between updates, ms. A gap over {STALL_MS} ms counts as a stall.</p>
      <div className="fl-ch-tablewrap">
        <table className="fl-ch-sum">
          <thead>
            <tr>
              <th>Feed</th>
              <th>p50 gap</th>
              <th>p99 gap</th>
              <th>Stalls</th>
            </tr>
          </thead>
          <tbody>
            {GAP_SUMMARY.map((g) => (
              <tr key={g.feed}>
                <td>
                  <i style={{ background: FEED_COLOUR[g.feed] }} />
                  {g.feed}
                </td>
                <td>{fmtP50Ms(g.p50Ms)}</td>
                <td>{fmtMs(g.p99Ms)}</td>
                <td>{fmtPct1(g.stallPct)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </figure>
  );
}

/** 3) Spread per feed: p50 dot, p50-p95 bar, p95-p99 line, on a shared axis. */
function Spread() {
  const lo = 0.14;
  const hi = 0.21;
  const at = (usd: number) => pct(((usd - lo) / (hi - lo)) * 100);
  const span = (a: number, b: number) => pct(((b - a) / (hi - lo)) * 100);
  return (
    <figure className="fl-ch">
      <figcaption>
        <b>Spread shown</b>
        <span>XAUUSD spread, USD per oz: dot p50, bar to p95, line to p99</span>
      </figcaption>
      <ul className="fl-ch-rows">
        {SPREAD.map((s) => {
          const colour = { "--fl-c": FEED_COLOUR[s.feed] } as CSSProperties;
          return (
            <li key={s.feed} style={colour}>
              <span className="fl-ch-rl">{s.feed}</span>
              <span className="fl-ch-track">
                <i className="fl-ch-whisk" style={{ left: at(s.p95), width: span(s.p95, s.p99) }} />
                <i className="fl-ch-range" style={{ left: at(s.p50), width: span(s.p50, s.p95) }} />
                <i className="fl-ch-dot" style={{ left: at(s.p50) }} />
              </span>
              <span className="fl-ch-rv">
                {fmtUsd2(s.p50)} · {fmtUsd2(s.p95)} · {fmtUsd2(s.p99)}
              </span>
            </li>
          );
        })}
      </ul>
      <div className="fl-ch-rows-x">
        <XTicks ticks={[0.14, 0.16, 0.18, 0.2].map((v) => ({ at: (v - lo) / (hi - lo), label: v.toFixed(2) }))} />
      </div>
      <p className="fl-ch-cap">Values per row: p50 · p95 · p99, rounded to 2 dp.</p>
    </figure>
  );
}

/** 4) Head to head: the published share of moves where the first feed showed the new price first. */
function HeadToHead() {
  return (
    <figure className="fl-ch">
      <figcaption>
        <b>Head to head</b>
        <span>Share of price moves where the first feed showed the new price first</span>
      </figcaption>
      <ul className="fl-ch-rows fl-ch-h2h">
        {HEAD_TO_HEAD.map((h) => (
          <li key={`${h.first}-${h.other}`}>
            <span className="fl-ch-rl">
              {h.first} <s>vs</s> {h.other}
            </span>
            <span className="fl-ch-track">
              <i className="fl-ch-bar" style={{ width: pct(h.firstPct), background: FEED_COLOUR[h.first] }} />
              <i className="fl-ch-bar fl-ch-bar-2" style={{ width: pct(h.otherPct), background: FEED_COLOUR[h.other] }} />
              <i className="fl-ch-mid" />
            </span>
            <span className="fl-ch-rv">{`${h.firstPct}% / ${h.otherPct}%`}</span>
          </li>
        ))}
      </ul>
      <p className="fl-ch-cap">The tick marks 50%. Percentages as published in the method post.</p>
    </figure>
  );
}

export function MethodCharts() {
  return (
    <div className="fl-ch-grid">
      <UpdatesPerHour />
      <GapDistribution />
      <Spread />
      <HeadToHead />
    </div>
  );
}
