import { FeedNavToggle } from "@/components/feed/feed-nav-toggle";
import { TelegramDeliveryControl } from "@/components/feed/telegram-delivery-control";
import { NotificationToggle } from "@/components/feed/notification-toggle";
import { auth } from "@/lib/auth";
import { getBotLink } from "@/lib/telegram-bot-links";
import { FEEDS_BOT_KEY } from "@/lib/telegram-feeds-bot";
import { createFeedsOnboardingToken } from "@/lib/telegram-feeds-onboarding";
import { getNotificationPrefs } from "@/lib/notification-prefs";

/** Static UI port of mockups/horizon-providers/notifications.html, now backed by real
 * state (bus thread provider-notification-prefs-2026-08-29). Telegram delivery is real
 * via the shared @horizonfbot -- see the delivery control card below. The per-event
 * toggles now read/write provider_notification_prefs (0070), but most of the ten events
 * still have no sender behind them at all -- see each card's caption for which ones a
 * toggle here actually changes today. */
export default async function FeedNotificationsPage() {
  const session = await auth();
  const providerId = session!.user!.id!;

  const link = await getBotLink(providerId, FEEDS_BOT_KEY);
  const onboarding = !link ? await createFeedsOnboardingToken(providerId).catch(() => null) : null;
  const prefs = await getNotificationPrefs(providerId);

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
            <b>Your preferences are saved</b> — every toggle below now persists. Telegram delivery is fully live
            (linking, unlinking, and sending a test message all work). Most of the ten events don&apos;t have a
            live sender built yet, so flipping those off won&apos;t change anything until that event type ships —
            see each card for which ones are already real.
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
            <span className="cap">4 events · saved, no live sender yet</span>
          </div>
          <div className="nlist">
            {[
              { ic: "signup", g: "🔔", b: "New signup", s: "A user creates an account interested in one of your tiers.", k: "new_signup" as const },
              { ic: "trial", g: "🧪", b: "Trial requested", s: "A user requests a trial — lands in your approval queue.", k: "trial_requested" as const },
              { ic: "paid", g: "💳", b: "Paid subscription", s: "A user subscribes to a paid tier — needs your approval to activate.", k: "paid_subscription" as const },
              { ic: "expired", g: "⏰", b: "Trial expired", s: "A trial ended without converting — a re-offer opportunity.", k: "trial_expired" as const },
            ].map((row) => (
              <div className="nrow" key={row.b}>
                <div className={`nic ${row.ic}`}>{row.g}</div>
                <div className="ntxt">
                  <b>{row.b}</b>
                  <span>{row.s}</span>
                </div>
                <NotificationToggle eventKey={row.k} initialEnabled={prefs[row.k]} />
              </div>
            ))}
          </div>
        </div>

        <div className="grid g2" style={{ marginTop: 18 }}>
          <div className="card">
            <div className="chead">
              <span className="ic">◇</span>
              <h3>Feed health alerts</h3>
              <span className="cap">measured by Feedverse · no live sender yet</span>
            </div>
            <div className="nlist">
              {[
                { g: "◇", b: "Tick gap detected", s: "A measured gap in your stream — time-sensitive.", k: "tick_gap" as const },
                { g: "▼", b: "Uptime below 99.9%", s: "Rolling 24h uptime dips under target.", k: "uptime_below_threshold" as const },
                { g: "◷", b: "Latency drift", s: "Median tick latency rises above your baseline.", k: "latency_drift" as const },
              ].map((row) => (
                <div className="nrow" key={row.b}>
                  <div className="nic health">{row.g}</div>
                  <div className="ntxt">
                    <b>{row.b}</b>
                    <span>{row.s}</span>
                  </div>
                  <NotificationToggle eventKey={row.k} initialEnabled={prefs[row.k]} />
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
                { ic: "paid", g: "↧", b: "Payout sent", s: "Your 50% share is disbursed each month.", k: "payout_sent" as const },
                { ic: "signup", g: "◈", b: "Tier review decision", s: "Horizon approves or returns a submitted tier — live for declines, approvals don't send yet.", k: "tier_review_decision" as const },
                { ic: "trial", g: "✉", b: "Daily digest", s: "One rollup at 08:00 — quiet hours 21:00–07:00.", k: "daily_digest" as const },
              ].map((row) => (
                <div className="nrow" key={row.b}>
                  <div className={`nic ${row.ic}`}>{row.g}</div>
                  <div className="ntxt">
                    <b>{row.b}</b>
                    <span>{row.s}</span>
                  </div>
                  <NotificationToggle eventKey={row.k} initialEnabled={prefs[row.k]} />
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
