import { FeedNavToggle } from "@/components/feed/feed-nav-toggle";

/** No feed-health telemetry pipeline exists yet (uptime/tick-rate/gap measurement isn't
 * built for any tier, provider or not) -- static preview of mockups/horizon-providers/
 * feed-health.html, clearly labelled as placeholder. Flagged to marcus as follow-up scope. */
export default function FeedHealthPage() {
  return (
    <>
      <header className="fp-topbar">
        <FeedNavToggle />
        <div>
          <h1>Feed Health</h1>
          <div className="crumb">feed.horizonhft.com / health</div>
        </div>
        <div className="sp" />
      </header>

      <section className="fp-content">
        <div className="banner info">
          <span className="bic">◇</span>
          <div>
            <b>No telemetry pipeline yet</b> — uptime, tick-rate, and gap detection aren&apos;t measured for any
            feed today. Everything below is static preview data from Iris&apos;s mockup, not live.
          </div>
        </div>

        <div className="stats">
          <div className="stat">
            <div className="lab">
              <span className="si">◇</span> Uptime · 30d
            </div>
            <div className="val">
              — <small>no data</small>
            </div>
            <div className="sub">telemetry not built</div>
          </div>
          <div className="stat">
            <div className="lab">
              <span className="si">◷</span> Median tick latency
            </div>
            <div className="val">
              — <small>no data</small>
            </div>
            <div className="sub">telemetry not built</div>
          </div>
          <div className="stat">
            <div className="lab">
              <span className="si">▤</span> Tick rate · now
            </div>
            <div className="val">
              — <small>no data</small>
            </div>
            <div className="sub">telemetry not built</div>
          </div>
          <div className="stat">
            <div className="lab">
              <span className="si">◈</span> Gaps · 30d
            </div>
            <div className="val">
              — <small>no data</small>
            </div>
            <div className="sub">telemetry not built</div>
          </div>
        </div>

        <div className="card full">
          <div className="empty">
            <div className="eic">◇</div>
            <b>No feed-health data source yet</b>
            <p>
              Charts, uptime grid, and per-tier health tables will populate once a telemetry pipeline exists.
              See the design at{" "}
              <span style={{ fontFamily: "var(--pfp-mono)" }}>mockups/horizon-providers/feed-health.html</span>{" "}
              for the target layout.
            </p>
          </div>
        </div>

        <div className="foot">HORIZON HFT · provider panel · Feed Health</div>
      </section>
    </>
  );
}
