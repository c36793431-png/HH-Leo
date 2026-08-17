import { FEED_COMPARISON_SCORES } from "@/lib/feed-comparison-scores";

export function FeedComparisonScores() {
  return (
    <div className="card full fcs">
      <h3 className="fp-section-title">Feed Comparison Scores</h3>

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
        {FEED_COMPARISON_SCORES.map((f) => (
          <div key={f.name} className="fcs-row">
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
            {f.note && <span className="fcs-note">{f.note}</span>}
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
        <p className="fcs-caption-footnote">
          Speed/Consistency/Stream splits are confirmed for Black, Alpha, Delta and Epsilon;
          Ultra, Beta and Gamma splits are proportional estimates from their total score pending
          FOC13&apos;s full per-feed breakdown.
        </p>
      </details>
    </div>
  );
}
