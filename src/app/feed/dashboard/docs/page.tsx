import { FeedNavToggle } from "@/components/feed/feed-nav-toggle";

/** Static reference port of mockups/horizon-providers/docs.html -- the mockup itself is
 * "mostly static reference" (its own header comment), so this ships as generic protocol/
 * connection docs rather than per-provider live credentials (no per-tier API key /
 * credential storage exists yet -- that section is omitted rather than faked). */
export default function FeedDocsPage() {
  return (
    <>
      <header className="fp-topbar">
        <FeedNavToggle />
        <div>
          <h1>Docs / Integration</h1>
          <div className="crumb">feed.horizonhft.com / docs</div>
        </div>
        <div className="sp" />
      </header>

      <section className="fp-content">
        <div className="grid" style={{ gridTemplateColumns: "1fr", gap: 18 }}>
          <div className="card">
            <div className="chead">
              <span className="ic">▤</span>
              <h3>Supported protocols</h3>
              <span className="cap">choose per tier</span>
            </div>
            <div className="proto">
              <div className="pcard rec">
                <div className="pt">
                  <span className="pi">⇄</span> FIX 4.4
                </div>
                <p>Lowest latency. Preferred for high-capability tiers. Ordered, session-based.</p>
                <div className="pk">port 9443 · TLS</div>
              </div>
              <div className="pcard">
                <div className="pt">
                  <span className="pi">≈</span> WebSocket
                </div>
                <p>JSON or binary frames. Good fit for consolidated/entry tiers.</p>
                <div className="pk">wss:// · TLS 1.3</div>
              </div>
              <div className="pcard">
                <div className="pt">
                  <span className="pi">↧</span> REST pull
                </div>
                <p>Snapshot / backfill only — not for live streaming.</p>
                <div className="pk">https:// · polling</div>
              </div>
            </div>
          </div>

          <div className="card">
            <div className="chead">
              <span className="ic">◈</span>
              <h3>Message spec</h3>
            </div>
            <div className="kv">
              <div className="r">
                <div className="k">MDEntryType</div>
                <div className="v">0=Bid 1=Offer</div>
              </div>
              <div className="r">
                <div className="k">Timestamp</div>
                <div className="v">UTC ns since epoch</div>
              </div>
              <div className="r">
                <div className="k">Depth</div>
                <div className="v">up to 10 levels</div>
              </div>
              <div className="r">
                <div className="k">Max rate</div>
                <div className="v">2M msg/s per session</div>
              </div>
            </div>
          </div>

          <div className="card">
            <div className="chead">
              <span className="ic">✦</span>
              <h3>Support</h3>
            </div>
            <p style={{ fontSize: 13, color: "var(--pfp-ink-2)", lineHeight: 1.6 }}>
              Integration questions route to Horizon&apos;s provider engineering desk. Feed-health disputes will
              be settled against the same telemetry shown in Feed Health once that pipeline exists.
            </p>
            <div className="endpoint" style={{ marginTop: 14 }}>
              <span className="lk">email</span> <b>providers@horizonhft.com</b>
            </div>
          </div>
        </div>

        <div className="foot">HORIZON HFT · provider panel · Docs / Integration</div>
      </section>
    </>
  );
}
