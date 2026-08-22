import { auth } from "@/lib/auth";
import { FeedNavToggle } from "@/components/feed/feed-nav-toggle";
import { listTiersForProvider } from "@/lib/feed-providers";

function money(cents: number): string {
  return `$${(cents / 100).toLocaleString(undefined, { minimumFractionDigits: 0, maximumFractionDigits: 0 })}`;
}

/** No payment ledger tracks feed-provider revenue splits yet -- gross figures below are
 * derived from feed_tiers.price_cents x active-subscriber counts where that data exists;
 * everything else (payout history, next-payout date, bank details) is static preview
 * copy from mockups/horizon-providers/revenue.html, clearly labelled. Flagged to marcus
 * as follow-up scope (real payout pipeline). */
export default async function FeedRevenuePage() {
  const session = await auth();
  const tiers = await listTiersForProvider(session!.user!.id!);
  const grossCents = tiers.reduce((sum, t) => sum + (t.priceCents ?? 0), 0);
  const yourShareCents = Math.round(grossCents / 2);

  return (
    <>
      <header className="fp-topbar">
        <FeedNavToggle />
        <div>
          <h1>Revenue</h1>
          <div className="crumb">feed.horizonhft.com / revenue</div>
        </div>
        <div className="sp" />
      </header>

      <section className="fp-content">
        <div className="banner info">
          <span className="bic">▦</span>
          <div>
            <b>No payout ledger yet</b> — figures below are notional (per-tier list price ÷ 2), not a real
            payment split. Payout history and next-payout date are static preview copy.
          </div>
        </div>

        <div className="card full">
          <div className="chead">
            <span className="ic">▦</span>
            <h3>Your tiers · notional 50% share</h3>
            <span className="cap">sum of list price, not actual subscriber revenue</span>
          </div>
          <div className="splitwrap">
            <div className="earn">
              <div className="k">Your 50% share</div>
              <div className="big">{money(yourShareCents)}</div>
              <div className="of">
                of <b>{money(grossCents)}</b> gross list price across {tiers.length} tier{tiers.length === 1 ? "" : "s"}
              </div>
              <div className="splitbar">
                <div className="track">
                  <div className="you" />
                  <div className="fv" />
                </div>
                <div className="lgd">
                  <div className="it">
                    <span className="sw you" /> You <b style={{ color: "var(--pfp-ink)", marginLeft: 4 }}>{money(yourShareCents)}</b>
                  </div>
                  <div className="it">
                    <span className="sw fv" /> Feedverse <span style={{ marginLeft: 4 }}>{money(grossCents - yourShareCents)}</span>
                  </div>
                </div>
              </div>
            </div>
          </div>
          <div className="scope-note">
            <span className="i">ⓘ</span> You see your 50% share only. A real payout pipeline (Stripe/ledger
            integration) isn&apos;t built yet.
          </div>
        </div>

        <div className="card full" style={{ marginTop: 18 }}>
          <div className="chead">
            <span className="ic">◈</span>
            <h3>By tier</h3>
            <span className="cap">list price only</span>
          </div>
          <table className="tbl">
            <thead>
              <tr>
                <th>Tier</th>
                <th className="r">List price</th>
                <th className="r">Your 50%</th>
              </tr>
            </thead>
            <tbody>
              {tiers.map((t) => (
                <tr key={t.id}>
                  <td>
                    <b>{t.name}</b>
                    <br />
                    <span style={{ fontSize: 11, color: "var(--pfp-ink-3)" }}>{money(t.priceCents ?? 0)} / mo</span>
                  </td>
                  <td className="r mono">{money(t.priceCents ?? 0)}</td>
                  <td className="r share">{money(Math.round((t.priceCents ?? 0) / 2))}</td>
                </tr>
              ))}
              {tiers.length === 0 && (
                <tr>
                  <td colSpan={3} style={{ textAlign: "center", color: "var(--pfp-ink-3)", padding: "24px 0" }}>
                    No tiers assigned yet.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>

        <div className="foot">HORIZON HFT · provider panel · Revenue</div>
      </section>
    </>
  );
}
