import { FeedNavToggle } from "@/components/feed/feed-nav-toggle";

/** Static UI port of mockups/horizon-providers/notifications.html -- no notification-prefs
 * table or Feed Provider Bot exist yet (spec §1 is a new dedicated Telegram bot, unbuilt),
 * so the toggles below are inert display only, not wired to a backend. Flagged to marcus as
 * follow-up scope, not silently faked as live. */
export default function FeedNotificationsPage() {
  return (
    <>
      <header className="fp-topbar">
        <FeedNavToggle />
        <div>
          <h1>Notifications</h1>
          <div className="crumb">feed.horizonhft.com / notifications</div>
        </div>
        <div className="sp" />
      </header>

      <section className="fp-content">
        <div className="banner info">
          <span className="bic">✈</span>
          <div>
            <b>Preview only</b> — the dedicated Feed Provider Bot (spec §1) and a per-event notification-prefs
            table don&apos;t exist yet. These toggles show the intended design and aren&apos;t wired to a backend.
          </div>
        </div>

        <div className="card full">
          <div className="chead">
            <span className="ic">✦</span>
            <h3>Account &amp; subscription events</h3>
            <span className="cap">4 events · not yet wired</span>
          </div>
          <div className="nlist">
            {[
              { ic: "signup", g: "🔔", b: "New signup", s: "A user creates an account interested in one of your tiers." },
              { ic: "trial", g: "🧪", b: "Trial requested", s: "A user requests a trial — lands in your approval queue." },
              { ic: "paid", g: "💳", b: "Paid subscription", s: "A user subscribes to a paid tier — needs your approval to activate." },
              { ic: "expired", g: "⏰", b: "Trial expired", s: "A trial ended without converting — a re-offer opportunity." },
            ].map((row) => (
              <div className="nrow" key={row.b}>
                <div className={`nic ${row.ic}`}>{row.g}</div>
                <div className="ntxt">
                  <b>{row.b}</b>
                  <span>{row.s}</span>
                </div>
                <div className="tog on" />
              </div>
            ))}
          </div>
        </div>

        <div className="grid g2" style={{ marginTop: 18 }}>
          <div className="card">
            <div className="chead">
              <span className="ic">◇</span>
              <h3>Feed health alerts</h3>
              <span className="cap">measured by Feedverse</span>
            </div>
            <div className="nlist">
              {[
                { g: "◇", b: "Tick gap detected", s: "A measured gap in your stream — time-sensitive." },
                { g: "▼", b: "Uptime below 99.9%", s: "Rolling 24h uptime dips under target." },
                { g: "◷", b: "Latency drift", s: "Median tick latency rises above your baseline." },
              ].map((row) => (
                <div className="nrow" key={row.b}>
                  <div className="nic health">{row.g}</div>
                  <div className="ntxt">
                    <b>{row.b}</b>
                    <span>{row.s}</span>
                  </div>
                  <div className="tog on" />
                </div>
              ))}
            </div>
          </div>

          <div className="card">
            <div className="chead">
              <span className="ic">▦</span>
              <h3>Business &amp; delivery</h3>
              <span className="cap">where &amp; when</span>
            </div>
            <div className="nlist">
              {[
                { ic: "paid", g: "↧", b: "Payout sent", s: "Your 50% share is disbursed each month." },
                { ic: "signup", g: "◈", b: "Tier review decision", s: "Horizon approves or returns a submitted tier." },
                { ic: "trial", g: "✉", b: "Daily digest", s: "One rollup at 08:00 — quiet hours 21:00–07:00." },
              ].map((row) => (
                <div className="nrow" key={row.b}>
                  <div className={`nic ${row.ic}`}>{row.g}</div>
                  <div className="ntxt">
                    <b>{row.b}</b>
                    <span>{row.s}</span>
                  </div>
                  <div className="tog on" />
                </div>
              ))}
            </div>
          </div>
        </div>

        <div className="foot">HORIZON HFT · provider panel · Notifications</div>
      </section>
    </>
  );
}
