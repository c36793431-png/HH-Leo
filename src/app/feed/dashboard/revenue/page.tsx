import { auth } from "@/lib/auth";
import { FeedNavToggle } from "@/components/feed/feed-nav-toggle";
import { listTiersForProvider } from "@/lib/feed-providers";

function money(cents: number): string {
  return `$${(cents / 100).toLocaleString(undefined, { minimumFractionDigits: 0, maximumFractionDigits: 0 })}`;
}

/** No payment ledger tracks feed-provider revenue splits yet, and no subscriber counts
 * exist to weight a total against. Summing price_cents across tiers would double-count
 * London's delta/gamma/beta rows, which are sold together as one Base package rather
 * than three separate $30 sales -- so this page shows per-tier list price and per-tier
 * 50% share only, with no aggregate figure. Flagged to marcus as follow-up scope (real
 * payout pipeline + a package concept to dedupe bundled tiers). */
export default async function FeedRevenuePage() {
  const session = await auth();
  const tiers = await listTiersForProvider(session!.user!.id!);

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
            <span className="ic">◈</span>
            <h3>By tier</h3>
            <span className="cap">list price only</span>
          </div>
          <p style={{ fontSize: 12, color: "var(--pfp-ink-3)", margin: "0 0 14px" }}>
            LD Beta 56, LD Gamma 19 and LD Delta 18 are sold together as one London Base package —
            each shows the $30 a client pays for that package, not a separate $30 each.
          </p>
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
