import { FeedNavToggle } from "@/components/feed/feed-nav-toggle";
import { TelegramDeliveryControl } from "@/components/feed/telegram-delivery-control";
import { auth } from "@/lib/auth";
import { getBotLink } from "@/lib/telegram-bot-links";
import { FEEDS_BOT_KEY } from "@/lib/telegram-feeds-bot";
import { createFeedsOnboardingToken } from "@/lib/telegram-feeds-onboarding";

/** Static UI port of mockups/horizon-providers/notifications.html. Telegram delivery
 * (bus thread provider-telegram-linking-build-2026-08-28) is now real via the shared
 * @horizonfbot -- see the delivery control card below. The per-event toggles below
 * that remain inert display only: no notification-prefs table exists yet to store which
 * events a provider wants, so there's nothing for delivery to read from. */
export default async function FeedNotificationsPage() {
  const session = await auth();
  const providerId = session!.user!.id!;

  const link = await getBotLink(providerId, FEEDS_BOT_KEY);
  const onboarding = !link ? await createFeedsOnboardingToken(providerId).catch(() => null) : null;

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
            <b>Toggle prefs preview only</b> — Telegram delivery below is real (linking, unlinking, and sending a
            test message all work). The per-event toggles further down don&apos;t have a notification-prefs table
            behind them yet, so they show the intended design without controlling what actually gets sent.
          </div>
        </div>

        <div className="card full" style={{ marginBottom: 18 }}>
          <div className="chead">
            <span className="ic">✈</span>
            <h3>Delivery</h3>
            <span className="cap">where events get sent</span>
          </div>
          <div className="nlist">
            <TelegramDeliveryControl
              linked={!!link}
              telegramUsername={link?.telegramUsername ?? null}
              linkHref={onboarding?.link ?? null}
            />
          </div>
        </div>

        <div className="card full">
          <div className="chead">
            <span className="ic">✦</span>
            <h3>Account &amp; subscription events</h3>
            <span className="cap">4 events · toggle prefs not yet wired</span>
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
