import { FEED_COMPARISON_SCORES, SCORE_TIER_NAMES } from "@/lib/feed-comparison-scores";

/** Entries that are a Horizon product: every one with a tier_key. Epsilon has none. */
const LISTED_NAMES = new Set(Object.values(SCORE_TIER_NAMES));

/**
 * The London leaderboard. "tiers" is the /feeds/london/tiers board as it has always been.
 * "marketplace" is the product-page embed (marcus, m52875): it hides the rows that are not a
 * Horizon product (Epsilon, "Offline", has no listing) and drops the row notes, because Delta's
 * carries a latency figure and marketplace surfaces carry none. It is a variant, not an edit to
 * FEED_COMPARISON_SCORES, so the tiers page keeps both. The window line and the method caption
 * are the same in both. The estimated-split footnote differs only in not naming Epsilon.
 *
 * highlight: entry names to mark as the page's own product, e.g. Beta, Gamma and Delta on
 * London's Base bundle.
 */
export function FeedComparisonScores({
  variant = "tiers",
  highlight = [],
}: {
  variant?: "tiers" | "marketplace";
  highlight?: string[];
}) {
  const marketplace = variant === "marketplace";
  const entries = marketplace ? FEED_COMPARISON_SCORES.filter((f) => LISTED_NAMES.has(f.name)) : FEED_COMPARISON_SCORES;
  return (
    <div className={`card full fcs${marketplace ? " fcs-embed" : ""}`}>
      <h3 className="fp-section-title">🇬🇧 London Feed Comparison Scores</h3>
      <p className="fcs-measured-on">Measured over 51h, 16 Aug 2026</p>

      <div className="fcs-legend">
        <span className="fcs-legend-item">
          <span className="fcs-swatch fcs-speed" /> Speed /45
        </span>
        <span className="fcs-legend-item">
          <span className="fcs-swatch fcs-consistency" /> Consistency /35
        </span>
        <span className="fcs-legend-item">
          <span className="fcs-swatch fcs-stream" /> Stream quality /20
        </span>
      </div>

      <div className="fcs-rows">
        {entries.map((f) => (
          <div key={f.name} className={`fcs-row${highlight.includes(f.name) ? " fcs-row-own" : ""}`}>
            <span className="fcs-rank">{f.rank}</span>
            <span className="fcs-name">{f.name}</span>
            <div className="fcs-bar-track">
              <div
                className="fcs-bar-seg fcs-speed"
                style={{ width: `${(f.speed / 100) * 100}%` }}
              />
              <div
                className="fcs-bar-seg fcs-consistency"
                style={{ width: `${(f.consistency / 100) * 100}%` }}
              />
              <div
                className="fcs-bar-seg fcs-stream"
                style={{ width: `${(f.streamQuality / 100) * 100}%` }}
              />
            </div>
            <span className="fcs-score">{f.score.toFixed(1)}</span>
            {f.note && !marketplace && <span className="fcs-note">{f.note}</span>}
          </div>
        ))}
      </div>

      <details className="fcs-caption">
        <summary>How this score is built</summary>
        <p>
          Weights are a judgement call, so all three components stay visible. Speed /45 from
          milliseconds behind the leader on a log scale. Consistency /35 from head-to-head
          rating — how reliably a feed is first. Stream quality /20 from how rarely it stalls
          (share of gaps over 500 ms) and its worst-case gap. Note: Alpha edges Black on stream
          quality (15.2 vs 14.8); Black leads because it maxes speed and consistency.
        </p>
        {/* The marketplace variant has no Epsilon row, so its footnote doesn't name it
            (marcus, m52910). */}
        <p className="fcs-caption-footnote">
          Speed/Consistency/Stream splits are confirmed for{" "}
          {marketplace ? "Black, Alpha and Delta" : "Black, Alpha, Delta and Epsilon"};
          Ultra, Beta and Gamma splits are proportional estimates from their total score pending
          FOC13&apos;s full per-feed breakdown.
        </p>
      </details>
    </div>
  );
}
